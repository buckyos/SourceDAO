import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { canonicalJson, readJson, sha256 } from "./bootstrap_io.js";

export const GOLDEN_PATH = fileURLToPath(new URL("../../security/usdb-contract-golden.json", import.meta.url));
export const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const contractNames: Record<string, string> = {
  dao: "SourceDao", dividend: "DividendContract", committee: "SourceDaoCommittee", devToken: "DevToken",
  normalToken: "NormalToken", lockup: "SourceTokenLockup", project: "ProjectManagement", acquired: "Acquired",
};
export type Checkpoint = { number: number; hash: string; state_root: string };
export type Evidence = {
  schema_version: string; checkpoint: Checkpoint; genesis_hash: string; config_sha256: string; golden_sha256: string;
  code: { address: string; keccak256: string }[];
  storage: { address: string; slot: string; value: string }[];
  calls: { to: string; data: string; result: string }[];
};

/** Every contract read uses the same historical state, including nested ethers calls. */
export class CheckpointProvider extends ethers.JsonRpcProvider {
  readonly evidence: Evidence;
  constructor(url: string, evidence: Evidence) {
    super(url, undefined, { cacheTimeout: -1 });
    this.evidence = evidence;
  }
  override async _perform(request: ethers.PerformActionRequest): Promise<any> {
    const pinned = ethers.toQuantity(this.evidence.checkpoint.number);
    let query = request;
    if ("blockTag" in request && ["call", "getCode", "getStorage", "getBalance", "getTransactionCount"].includes(request.method)) {
      query = { ...request, blockTag: pinned } as ethers.PerformActionRequest;
    }
    const result = await super._perform(query);
    const e = this.evidence;
    if (query.method === "call") {
      if (query.transaction.from || query.transaction.value) throw new Error("Validation only records read-only calls without a sender or value");
      e.calls.push({ to: String(query.transaction.to).toLowerCase(), data: String(query.transaction.data ?? "0x").toLowerCase(), result });
    } else if (query.method === "getCode") {
      e.code.push({ address: query.address.toLowerCase(), keccak256: ethers.keccak256(result) });
    } else if (query.method === "getStorage") {
      e.storage.push({ address: query.address.toLowerCase(), slot: ethers.toBeHex(query.position, 32), value: ethers.toBeHex(result, 32) });
    }
    return result;
  }
  async finish(): Promise<void> {
    const block = await this.send("eth_getBlockByNumber", [ethers.toQuantity(this.evidence.checkpoint.number), false]);
    if (!block || block.hash !== this.evidence.checkpoint.hash || block.stateRoot !== this.evidence.checkpoint.state_root) {
      throw new Error("Validation checkpoint changed during inspection; discard the report and retry");
    }
    for (const key of ["code", "storage", "calls"] as const) {
      const values = this.evidence[key];
      (this.evidence as any)[key] = [...new Map(values.map(value => [canonicalJson(value), value] as const)).values()]
        .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b), "en"));
    }
  }
}

/** Match artifacts to the reviewed golden before trusting ABI or storage offsets. */
export class ReviewedArtifacts {
  readonly records = new Map<string, any>();
  readonly artifacts = new Map<string, any>();
  digest = "";
  async load(root: string): Promise<this> {
    const golden = await readJson(GOLDEN_PATH);
    this.digest = sha256(canonicalJson(golden));
    for (const record of golden.contracts) {
      const filename = path.join(root, record.source_name, `${record.contract_name}.json`);
      const bytes = await readFile(filename);
      if (`sha256:${sha256(bytes)}` !== record.artifact_sha256) throw new Error(`Artifact differs from reviewed golden: ${record.contract_name}`);
      this.records.set(record.contract_name, record);
      this.artifacts.set(record.contract_name, await readJson(filename));
    }
    for (const name of [...Object.values(contractNames), "ERC1967Proxy"]) {
      if (!this.records.has(name)) throw new Error(`Golden is missing ${name}`);
    }
    return this;
  }
  runtime(name: string, implementation?: string): string {
    const artifact = this.artifacts.get(name), record = this.records.get(name);
    const bytes = ethers.getBytes(artifact.deployedBytecode);
    if (implementation) {
      for (const refs of Object.values(record.immutable_references) as { start: number; length: number }[][]) {
        for (const ref of refs) {
          if (ref.length !== 32 || ref.start < 0 || ref.start + 32 > bytes.length) throw new Error(`Invalid immutable reference: ${name}`);
          bytes.set(ethers.getBytes(ethers.zeroPadValue(implementation, 32)), ref.start);
        }
      }
    }
    return ethers.hexlify(bytes);
  }
  async checkCode(provider: ethers.JsonRpcProvider, key: string, address: string): Promise<void> {
    const name = contractNames[key];
    const proxied = key !== "dao" && key !== "dividend";
    const code = await provider.getCode(address);
    if (code.toLowerCase() !== this.runtime(proxied ? "ERC1967Proxy" : name).toLowerCase()) throw new Error(`${key} runtime differs from reviewed artifact`);
    const slot = await provider.getStorage(address, IMPLEMENTATION_SLOT);
    if (!proxied) {
      if (BigInt(slot) !== 0n) throw new Error(`${key} predeploy has an unexpected implementation slot`);
      return;
    }
    if (BigInt(slot) === 0n || BigInt(slot) >> 160n !== 0n) throw new Error(`${key} has an invalid ERC1967 implementation`);
    const implementation = ethers.getAddress(ethers.dataSlice(slot, 12));
    const actual = await provider.getCode(implementation);
    if (actual.toLowerCase() !== this.runtime(name, implementation).toLowerCase()) throw new Error(`${key} implementation differs from reviewed artifact`);
  }
  async checkStorage(provider: ethers.JsonRpcProvider, key: string, address: string, label: string, expected: bigint): Promise<void> {
    const record = this.records.get(contractNames[key]);
    const field = record.storage_layout.storage.find((item: any) => item.label === label);
    if (!field) throw new Error(`Golden has no ${key}.${label} storage field`);
    const width = BigInt(record.storage_layout.types[field.type].numberOfBytes);
    const word = BigInt(await provider.getStorage(address, BigInt(field.slot)));
    const actual = (word >> BigInt(field.offset * 8)) & ((1n << (width * 8n)) - 1n);
    if (actual !== expected) throw new Error(`${key}.${label} mismatch: have ${actual}, expected ${expected}`);
  }
}
