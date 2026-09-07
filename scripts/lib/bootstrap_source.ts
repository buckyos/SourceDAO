import { ethers } from "ethers";
import { canonicalJson, configDigest, sha256 } from "./bootstrap_io.js";

export interface BootstrapSource {
  schemaVersion: 1;
  chainId: number;
  daoAddress: string;
  modules: Record<string, string>;
  deploymentTransactions: { devToken: string; normalToken: string };
  rpcUrl?: string;
  blockNumber?: number;
  blockHash?: string;
}

/** Transport settings never enter the public source evidence or its identity. */
export function sourceIdentity(source: BootstrapSource): BootstrapSource {
  const { schemaVersion, chainId, daoAddress, modules, deploymentTransactions } = source;
  return { schemaVersion, chainId, daoAddress, modules, deploymentTransactions };
}

/** The shared import contains no destination chain, administrator, names or governance policy. */
export function sharedSourceImport(report: any) {
  return {
    schemaVersion: "sourcedao-bootstrap-import:v1",
    sourceIdentitySha256: report.sourceIdentitySha256,
    checkpoint: report.checkpoint,
    committee: { initialMembers: report.committeeMembers },
    devToken: { totalSupply: report.tokens.devToken.totalSupply,
      initAddresses: report.tokens.devToken.allocations.map((item: any) => item.address),
      initAmounts: report.tokens.devToken.allocations.map((item: any) => item.amount) },
  };
}

/** Apply only the four reviewed source fields to a destination template. */
export function applySourceImport(base: any, imported: ReturnType<typeof sharedSourceImport>) {
  requireCondition(base?.schemaVersion === 1 && base.devToken && base.normalToken && base.committee, "Invalid base bootstrap config");
  requireCondition(!("bootstrapAdminPrivateKey" in base), "Private keys are forbidden in public config");
  const config = structuredClone(base);
  config.committee.initialMembers = [...imported.committee.initialMembers];
  Object.assign(config.devToken, structuredClone(imported.devToken));
  return config;
}

const moduleNames = ["devToken", "normalToken", "committee", "lockup", "dividend", "project", "acquired"];
const transfer = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const transferTopic = ethers.id("Transfer(address,address,uint256)");
const initializedTopics = [ethers.id("Initialized(uint8)"), ethers.id("Initialized(uint64)")];
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Only accept a named network and a complete, operator-selected module identity. */
export function validateSource(source: BootstrapSource): void {
  requireCondition(source.schemaVersion === 1, "Unsupported source schemaVersion");
  requireCondition(Number.isSafeInteger(source.chainId) && source.chainId > 0, "Invalid source chainId");
  const addresses = [source.daoAddress, ...moduleNames.map(name => source.modules?.[name])];
  for (const address of addresses) {
    requireCondition(ethers.isAddress(address) && ethers.getAddress(address) !== ethers.ZeroAddress, `Invalid source address: ${address}`);
  }
  requireCondition(new Set(addresses.map(address => address.toLowerCase())).size === addresses.length, "Duplicate source module address");
  for (const name of ["devToken", "normalToken"] as const) {
    requireCondition(/^0x[0-9a-fA-F]{64}$/.test(source.deploymentTransactions?.[name]), `Missing ${name} deployment transaction`);
  }
}

/** Recover original mints, never current holdings or later treasury transfers. */
export function originalMints(address: string, logs: readonly { address: string; topics: readonly string[]; data: string }[]) {
  const ownLogs = logs.filter(log => log.address.toLowerCase() === address.toLowerCase());
  requireCondition(ownLogs.filter(log => initializedTopics.includes(log.topics[0]) && BigInt(log.data) === 1n).length === 1,
    `Missing unique initialization event: ${address}`);
  const balances = new Map<string, bigint>();
  for (const log of ownLogs.filter(log => log.topics[0] === transferTopic)) {
    const event = transfer.parseLog(log);
    requireCondition(event && event.args.from === ethers.ZeroAddress && event.args.to !== ethers.ZeroAddress,
      `Non-mint Transfer in deployment transaction: ${address}`);
    const recipient = ethers.getAddress(event.args.to);
    balances.set(recipient, (balances.get(recipient) ?? 0n) + BigInt(event.args.value));
  }
  return balances;
}

/** Read one source checkpoint and independently checked original token deployments. No signer is used. */
export async function readBootstrapSource(provider: ethers.JsonRpcProvider, source: BootstrapSource, height: number, base?: any) {
  validateSource(source);
  requireCondition(Number.isSafeInteger(height) && height > 0, "Source block must be an explicit positive integer");
  requireCondition(BigInt(await provider.send("eth_chainId", [])) === BigInt(source.chainId), "Source chain ID mismatch");
  const checkpoint = await provider.getBlock(height);
  requireCondition(checkpoint?.hash, `Source checkpoint is unavailable: ${height}`);
  if (source.blockHash) requireCondition(checkpoint.hash.toLowerCase() === source.blockHash.toLowerCase(), "Source checkpoint hash mismatch");
  const pinned = new Map<number, string>([[height, checkpoint.hash]]);
  const calls: any[] = [];
  const code: any[] = [];
  async function read(address: string, signature: string, block: number, args: any[] = []) {
    const abi = new ethers.Interface([`function ${signature}`]);
    const fn = abi.fragments[0] as ethers.FunctionFragment;
    const data = abi.encodeFunctionData(fn, args);
    const result = await provider.call({ to: address, data, blockTag: block, enableCcipRead: false });
    calls.push({ block, address, data, result });
    return abi.decodeFunctionResult(fn, result)[0];
  }
  async function observeCode(address: string, block: number) {
    const runtime = await provider.getCode(address, block);
    requireCondition(runtime !== "0x", `No source code at ${address}, block ${block}`);
    const slot = await provider.getStorage(address, implementationSlot, block);
    const implementation = ethers.getAddress(`0x${slot.slice(-40)}`);
    let implementationCodeHash: string | null = null;
    if (implementation !== ethers.ZeroAddress) {
      const runtime = await provider.getCode(implementation, block);
      requireCondition(runtime !== "0x", `Missing source implementation code: ${implementation}`);
      implementationCodeHash = ethers.keccak256(runtime);
    }
    code.push({ block, address, codeHash: ethers.keccak256(runtime), implementationSlot: slot, implementation, implementationCodeHash });
  }
  await observeCode(source.daoAddress, height);
  const modules: Record<string, string> = {};
  for (const name of moduleNames) {
    modules[name] = ethers.getAddress(await read(source.daoAddress, `${name}() view returns(address)`, height));
    requireCondition(modules[name] === ethers.getAddress(source.modules[name]), `Source module mismatch: ${name}`);
    await observeCode(modules[name], height);
  }
  const members = Array.from(await read(modules.committee, "members() view returns(address[])", height) as string[], ethers.getAddress);
  requireCondition(members.length > 0 && !members.includes(ethers.ZeroAddress) && new Set(members).size === members.length, "Invalid source committee members");
  for (const member of members) {
    requireCondition(await provider.getCode(member, height) === "0x", `Committee contract wallet requires an explicit destination mapping: ${member}`);
  }

  async function tokenOrigin(kind: "devToken" | "normalToken") {
    const address = modules[kind];
    const hash = source.deploymentTransactions[kind];
    const receipt = await provider.getTransactionReceipt(hash);
    requireCondition(receipt?.status === 1 && receipt.contractAddress && ethers.getAddress(receipt.contractAddress) === address,
      `Not a successful direct CREATE for ${kind}: ${hash}`);
    requireCondition(receipt.blockNumber > 0 && receipt.blockNumber <= height, `Deployment is outside source checkpoint: ${kind}`);
    const block = await provider.getBlock(receipt.blockNumber);
    requireCondition(block?.hash === receipt.blockHash && block.transactions.includes(hash), `Non-canonical deployment: ${kind}`);
    requireCondition(await provider.getCode(address, receipt.blockNumber - 1) === "0x", `Token existed before supplied deployment: ${kind}`);
    pinned.set(receipt.blockNumber, receipt.blockHash);
    await observeCode(address, receipt.blockNumber);
    const mints = originalMints(address, receipt.logs);
    const name = String(await read(address, "name() view returns(string)", receipt.blockNumber));
    const symbol = String(await read(address, "symbol() view returns(string)", receipt.blockNumber));
    const decimals = Number(await read(address, "decimals() view returns(uint8)", receipt.blockNumber));
    const supply = BigInt(await read(address, "totalSupply() view returns(uint256)", receipt.blockNumber));
    requireCondition(decimals === 18, `Unsupported source token decimals: ${kind}=${decimals}`);
    requireCondition([...mints.values()].reduce((a, b) => a + b, 0n) === supply, `Original mint sum differs from deployment supply: ${kind}`);
    for (const [recipient, amount] of mints) {
      requireCondition(BigInt(await read(address, "balanceOf(address) view returns(uint256)", receipt.blockNumber, [recipient])) === amount,
        `Balance changed within deployment block: ${kind}, ${recipient}`);
    }
    const reserve = BigInt(await read(address, "balanceOf(address) view returns(uint256)", receipt.blockNumber, [address]));
    requireCondition(reserve === (mints.get(address) ?? 0n), `Original reserve mismatch: ${kind}`);
    if (kind === "normalToken") requireCondition(supply === 0n && mints.size === 0, "Nonzero original NormalToken allocation is unsupported");
    if (kind === "devToken") requireCondition(supply > 0n, "Original DevToken supply must be positive");
    const allocations = [...mints].filter(([recipient]) => recipient !== address).map(([recipient, amount]) => ({ address: recipient, amount: amount.toString() }));
    // A source contract allocation cannot be blindly assigned to an unrelated destination address.
    for (const allocation of allocations) {
      requireCondition(await provider.getCode(allocation.address, height) === "0x" && await provider.getCode(allocation.address, receipt.blockNumber) === "0x",
        `Original allocation to a contract requires an explicit destination mapping: ${allocation.address}`);
    }
    return { address, deploymentTransaction: hash, deploymentBlock: receipt.blockNumber, deploymentBlockHash: receipt.blockHash,
      name, symbol, decimals, totalSupply: supply.toString(), reserve: reserve.toString(), allocations,
      deploymentLogs: receipt.logs.filter(log => log.address.toLowerCase() === address.toLowerCase()).map(log => ({ index: log.index, address: log.address, topics: [...log.topics], data: log.data })) };
  }
  const devToken = await tokenOrigin("devToken");
  const normalToken = await tokenOrigin("normalToken");
  // Re-read raw block headers to avoid ethers' short-lived cache hiding a reorg.
  for (const [number, hash] of pinned) {
    const current = await provider.send("eth_getBlockByNumber", [ethers.toQuantity(number), false]);
    requireCondition(current?.hash === hash, `Source block changed during import: ${number}`);
  }
  requireCondition(BigInt(await provider.send("eth_chainId", [])) === BigInt(source.chainId), "Source chain changed during import");
  const fields = ["committee.initialMembers", "devToken.totalSupply", "devToken.initAddresses", "devToken.initAmounts"];
  const report: any = {
    schemaVersion: "sourcedao-bootstrap-source:v2", policy: { committee: "members-at-checkpoint", tokenAllocation: "original-deployment-mints", copiedFields: fields },
    source: sourceIdentity(source), sourceIdentitySha256: sha256(canonicalJson(sourceIdentity(source))),
    checkpoint: { number: height, hash: checkpoint.hash, stateRoot: checkpoint.stateRoot },
    committeeMembers: members, tokens: { devToken, normalToken },
    observations: { calls, code },
  };
  const imported = sharedSourceImport(report);
  const config = base === undefined ? imported : applySourceImport(base, imported);
  if (base === undefined) report.importedSha256 = configDigest(imported);
  else {
    // Keep the explicit legacy --config workflow readable during migration.
    report.schemaVersion = "sourcedao-bootstrap-source:v1";
    report.baseConfigSha256 = configDigest(base); report.configSha256 = configDigest(config);
  }
  return { config, report };
}
