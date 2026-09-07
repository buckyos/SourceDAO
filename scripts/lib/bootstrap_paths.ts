import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { configDigest } from "./bootstrap_io.js";

export const SOURCE_DAO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SECURITY_ROOT = path.join(SOURCE_DAO_ROOT, "security");
export const DEFAULT_SOURCE_CONFIG = path.join(SECURITY_ROOT, "sources/optimism/sourcedao-opmain-import-source.json");
export const DEFAULT_RPC_URL = "http://127.0.0.1:8545";

/** Explicit network choices persist through the environment across workflow commands. */
export function selectedNetwork(value = process.env.SOURCE_DAO_NETWORK || "usdb-testnet-v0"): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error("Invalid SourceDAO network name");
  return value;
}

/** Defaults are anchored to the checkout or an explicitly selected installed release, never cwd. */
export function defaultBundleDirectory(network?: string): string {
  const selected = selectedNetwork(network);
  if (process.env.SOURCE_DAO_BUNDLE_DIR) return path.resolve(process.env.SOURCE_DAO_BUNDLE_DIR);
  if (process.env.SOURCE_DAO_RELEASE_DIR) return path.resolve(process.env.SOURCE_DAO_RELEASE_DIR, "docker/networks", selected);
  // A tool container has one release mount. A missing/broken mount must fail in the loader.
  if (existsSync("/release")) return "/release";
  return path.join(SECURITY_ROOT, "candidate", selected, "frozen-network-bundle");
}

/** Isolate recovery by the full target chain and configuration identity. */
export function ceremonyPaths(config: any, genesisHash: string) {
  if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0 || !/^0x[0-9a-fA-F]{64}$/.test(genesisHash)) throw new Error("Invalid bootstrap directory identity");
  const identity = path.join(String(config.chainId), genesisHash.toLowerCase(), configDigest(config));
  const privateRoot = process.env.SOURCE_DAO_BOOTSTRAP_PRIVATE_DIR || path.join(os.homedir(), ".usdb/sourcedao-bootstrap");
  const publicRoot = process.env.SOURCE_DAO_BOOTSTRAP_PUBLIC_DIR || path.join(SECURITY_ROOT, "public");
  const publicDir = path.resolve(publicRoot, identity);
  return { state: path.resolve(privateRoot, identity, "state.json"),
    publicState: path.join(publicDir, "sourcedao-bootstrap-public-state.json"),
    validation: path.join(publicDir, "sourcedao-bootstrap-validation.json") };
}

/** A directory override may select a custom network; an explicit network must still agree. */
export function assertSelectedNetwork(actual: string, explicit?: string): void {
  const expected = explicit || process.env.SOURCE_DAO_NETWORK;
  if (expected && actual !== selectedNetwork(expected)) throw new Error(`Bundle network ${actual} differs from selected network ${expected}`);
}
