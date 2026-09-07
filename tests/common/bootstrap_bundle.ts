import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { configDigest, sha256 } from "../../scripts/lib/bootstrap_io.js";

/** A minimal frozen bundle for an isolated Hardhat chain, using real reviewed artifacts. */
export async function testBootstrapBundle(chain: any) {
  const root = path.join(chain.root, "bundle");
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  const config = structuredClone(chain.config); delete config.artifactsDir; delete config.rpcUrl;
  const golden = JSON.parse(await readFile("security/usdb-contract-golden.json", "utf8"));
  const genesis = { config: { chainId: config.chainId } };
  const genesisHash = (await chain.provider.getBlock(0)).hash;
  const artifacts: Record<string, any> = {};
  async function artifact(key: string, filename: string, data: any) {
    const bytes = `${JSON.stringify(data, null, 2)}\n`;
    await writeFile(path.join(root, "artifacts", filename), bytes);
    artifacts[key] = { path: `artifacts/${filename}`, sha256: sha256(bytes) };
  }
  await artifact("sourcedao_bootstrap", "sourcedao-bootstrap-config.json", config);
  await artifact("sourcedao_contract_golden", "sourcedao-contract-golden.json", golden);
  await artifact("genesis", "genesis.json", genesis);
  await artifact("genesis_manifest", "genesis.manifest.json", { block_hash: genesisHash, sourcedao_config_sha256: artifacts.sourcedao_bootstrap.sha256, file_sha256: artifacts.genesis.sha256 });
  await artifact("sourcedao_bootstrap_freeze", "sourcedao-bootstrap-freeze.json", { schema_version: "usdb-sourcedao-bootstrap-freeze:v1", network_bundle_id: "usdb-testnet-v0", chain_id: config.chainId, config_sha256: artifacts.sourcedao_bootstrap.sha256, config_semantic_sha256: configDigest(config), golden_sha256: configDigest(golden), provenance: {}, overrides: [] });
  await writeFile(path.join(root, "network.json"), JSON.stringify({ schema_version: "usdb-network-bundle:v2", network_bundle_id: "usdb-testnet-v0", chain_id: config.chainId, artifacts }));
  return { root, config, configPath: path.join(root, artifacts.sourcedao_bootstrap.path) };
}
