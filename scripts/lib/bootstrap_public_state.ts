import { ethers } from "ethers";
import { canonicalJson, configDigest } from "./bootstrap_io.js";

export const PUBLIC_STATE_SCHEMA = "sourcedao-bootstrap-public-state:v1";
const moduleNames = ["committee", "dev_token", "normal_token", "token_lockup", "project", "dividend", "acquired"];
const operationNames = new Set([
  "Dao.initialize", "Dividend.initialize", "Dividend.finalizeBootstrap",
  ...["TokenDividend", "Committee", "DevToken", "NormalToken", "TokenLockup", "Project", "Acquired"].map(name => `Dao.set${name}Address`),
  ...["Committee", "DevToken", "NormalToken", "TokenLockup", "Project", "Acquired"].flatMap(name => [`${name}.deployImplementation`, `${name}.deployProxy`]),
]);
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function address(value: any): string {
  check(typeof value === "string" && ethers.isAddress(value), "Invalid public state address");
  const result = ethers.getAddress(value);
  check(result !== ethers.ZeroAddress, "Zero public state address");
  return result;
}
function hash(value: any, prefix = true): string {
  check(typeof value === "string" && (prefix ? /^0x[0-9a-fA-F]{64}$/ : /^[0-9a-f]{64}$/).test(value), "Invalid public state digest");
  return value.toLowerCase();
}

/** Construct a public record from explicitly typed fields, excluding all local diagnostics. */
export function publicBootstrapState(state: any, config: any) {
  check(state?.state_version === "1" && state.status === "completed" && state.scope === "full", "Only a completed full bootstrap can be exported");
  check(config?.schemaVersion === 1 && Number.isSafeInteger(state.chain_id) && state.chain_id > 0 && state.chain_id === config.chainId, "Public state chain mismatch");
  const identity = state.ceremony_identity;
  check(identity?.chain_id === state.chain_id && identity.config_sha256 === configDigest(config), "Public state configuration identity mismatch");
  const dao = address(state.dao_address), dividend = address(state.dividend_address), admin = address(state.bootstrap_admin);
  check(dao === address(config.daoAddress) && dividend === address(config.dividendAddress) && admin === address(config.bootstrapAdminAddress) && admin === address(identity.signer), "Public state address identity mismatch");
  const wiring: Record<string, string> = {};
  for (const name of moduleNames) wiring[name] = address(state.final_wiring?.[name]);
  check(wiring.dividend === dividend && new Set([dao, ...Object.values(wiring)]).size === 8, "Invalid public state module wiring");
  check(Array.isArray(state.operations) && state.operations.length === operationNames.size, "Public state requires the complete bootstrap operation set");
  const names = new Set<string>(), hashes = new Set<string>();
  let previousBlock = 0;
  const operations = state.operations.map((op: any) => {
    check(operationNames.has(op.name) && !names.has(op.name) && op.status === "completed", "Invalid or duplicate public operation");
    check(Number.isSafeInteger(op.block_number) && op.block_number > 0 && op.block_number >= previousBlock, "Invalid public operation block");
    previousBlock = op.block_number;
    names.add(op.name);
    const txHash = hash(op.tx_hash);
    check(!hashes.has(txHash), "Duplicate public transaction"); hashes.add(txHash);
    return { name: op.name as string, status: "completed", tx_hash: txHash, block_number: op.block_number as number };
  });
  return {
    record_schema: PUBLIC_STATE_SCHEMA, state_version: "1", status: "completed", scope: "full",
    ceremony_identity: { chain_id: state.chain_id as number, genesis_hash: hash(identity.genesis_hash), config_sha256: hash(identity.config_sha256, false), golden_sha256: hash(identity.golden_sha256, false), signer: admin.toLowerCase() },
    chain_id: state.chain_id as number, dao_address: dao, dividend_address: dividend, bootstrap_admin: admin,
    operations, final_wiring: wiring,
  };
}

/** The export must agree with the durable signed journal without needing a private key. */
export function verifyExportJournal(state: ReturnType<typeof publicBootstrapState>, journal: any): void {
  check(journal?.schema_version === "sourcedao-bootstrap-journal:v1" && canonicalJson(journal.identity) === canonicalJson(state.ceremony_identity), "Export journal identity mismatch");
  check(Array.isArray(journal.transactions) && journal.transactions.length === state.operations.length, "Export journal is incomplete or has pending transactions");
  let previousNonce: number | undefined;
  for (let index = 0; index < state.operations.length; index++) {
    const entry = journal.transactions[index], op = state.operations[index];
    const tx = ethers.Transaction.from(entry.raw_transaction);
    check(tx.isSigned() && tx.hash === op.tx_hash && tx.from?.toLowerCase() === state.ceremony_identity.signer && tx.chainId === BigInt(state.chain_id), "Export journal signature mismatch");
    check(entry.tx_hash === tx.hash && entry.name === op.name && entry.block_number === op.block_number && hash(entry.block_hash), "Export journal receipt mismatch");
    check(entry.nonce === tx.nonce && (previousNonce === undefined || tx.nonce === previousNonce + 1), "Export journal nonce mismatch");
    previousNonce = tx.nonce;
  }
}

/** Public inputs reject unknown fields instead of carrying hidden runtime metadata. */
export function assertPublicState(state: any, config: any): void {
  check(state?.record_schema === PUBLIC_STATE_SCHEMA && canonicalJson(publicBootstrapState(state, config)) === canonicalJson(state), "Invalid public state schema or unexpected fields");
}
