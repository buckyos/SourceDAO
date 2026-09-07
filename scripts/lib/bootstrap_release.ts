import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { configDigest, parseJson, sha256, canonicalJson } from "./bootstrap_io.js";

/** Read configuration from an already trusted release bundle and verify its frozen identity. */
export async function loadBootstrapBundle(directory: string) {
  const root = await realpath(directory);
  const network = parseJson(await readFile(path.join(root, "network.json"), "utf8"));
  if (network.schema_version !== "usdb-network-bundle:v2") throw new Error("Unsupported network bundle schema");
  async function artifact(key: string) {
    const entry = network.artifacts?.[key];
    if (!entry || typeof entry.path !== "string" || path.isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes("..") || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error(`Invalid bundle artifact: ${key}`);
    const filename = await realpath(path.join(root, entry.path));
    const relative = path.relative(root, filename);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error(`Bundle artifact escapes root: ${key}`);
    const bytes = await readFile(filename);
    if (sha256(bytes) !== entry.sha256) throw new Error(`Bundle artifact hash mismatch: ${key}`);
    return { path: filename, digest: entry.sha256 as string, value: parseJson(bytes.toString("utf8"), key) };
  }
  const frozen = (await artifact("sourcedao_bootstrap_freeze")).value;
  const config = await artifact("sourcedao_bootstrap"), golden = await artifact("sourcedao_contract_golden");
  const genesis = await artifact("genesis"), manifest = (await artifact("genesis_manifest")).value;
  if (frozen.schema_version !== "usdb-sourcedao-bootstrap-freeze:v1" || frozen.network_bundle_id !== network.network_bundle_id || frozen.chain_id !== network.chain_id || config.value.chainId !== network.chain_id || genesis.value.config?.chainId !== network.chain_id) throw new Error("Frozen bundle network identity mismatch");
  if (frozen.config_sha256 !== config.digest || frozen.config_semantic_sha256 !== configDigest(config.value) || manifest.sourcedao_config_sha256 !== config.digest || manifest.file_sha256 !== genesis.digest) throw new Error("Frozen SourceDAO configuration mismatch");
  for (const key of ["rpcUrl", "artifactsDir", "outputPath", "bootstrapAdminPrivateKey"]) if (key in config.value) throw new Error("Frozen configuration contains runtime fields");
  if (!/^0x[0-9a-f]{64}$/.test(manifest.block_hash) || frozen.golden_sha256 !== sha256(canonicalJson(golden.value))) throw new Error("Frozen genesis or golden identity is invalid");
  if ((network.artifacts?.sourcedao_bootstrap_source !== undefined) !== (network.artifacts?.sourcedao_bootstrap_imported !== undefined)) throw new Error("Incomplete frozen source pair");
  for (const key of ["sourcedao_bootstrap_source", "sourcedao_bootstrap_imported"]) {
    const digest = frozen.provenance?.[key];
    if ((network.artifacts?.[key] !== undefined) !== (digest !== undefined)) throw new Error("Incomplete frozen source provenance");
    if (digest !== undefined && (await artifact(key)).digest !== digest) throw new Error("Frozen source provenance mismatch");
  }
  return { network: network.network_bundle_id as string, configPath: config.path, config: config.value, genesisPath: genesis.path, goldenPath: golden.path,
    genesisHash: manifest.block_hash as string, goldenDigest: frozen.golden_sha256 as string };
}
