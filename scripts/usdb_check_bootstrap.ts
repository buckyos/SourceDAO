import { ethers } from "ethers";
import path from "node:path";
import { readJson, configDigest } from "./lib/bootstrap_io.js";
import { loadBootstrapBundle } from "./lib/bootstrap_release.js";
import { defaultBundleDirectory, DEFAULT_RPC_URL, SOURCE_DAO_ROOT } from "./lib/bootstrap_paths.js";
import { CheckpointProvider, ReviewedArtifacts, type Evidence } from "./lib/bootstrap_validation.js";

/** Inspect the release and live predeploys without loading a signer or writing state. */
async function main() {
  const options: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const name = process.argv[i];
    if (name === "--help") { console.log("Usage: check [--bundle-dir <directory>] [--rpc-url <url>]"); return; }
    const value = process.argv[++i];
    if (!["--bundle-dir", "--rpc-url"].includes(name) || name in options || !value || value.startsWith("--")) throw new Error(`Invalid check argument: ${name}`);
    options[name] = value;
  }
  const bundle = await loadBootstrapBundle(options["--bundle-dir"] || defaultBundleDirectory());
  const config = bundle.config;
  const reviewed = await new ReviewedArtifacts().load(path.join(SOURCE_DAO_ROOT, "artifacts-usdb"));
  if (reviewed.digest !== bundle.goldenDigest) throw new Error("Tool artifacts differ from frozen golden");
  const url = options["--rpc-url"] || process.env.SOURCE_DAO_USDB_RPC_URL || DEFAULT_RPC_URL;
  const provider = new ethers.JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
  let pinned: CheckpointProvider | undefined;
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(config.chainId)) throw new Error("Connected chain ID differs from frozen bundle");
    const genesis = await provider.getBlock(0);
    if (genesis?.hash !== bundle.genesisHash) throw new Error("Connected genesis differs from frozen bundle");
    const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
    if (!block?.hash || !block.stateRoot) throw new Error("Cannot read live checkpoint");
    const evidence: Evidence = { schema_version: "sourcedao-bootstrap-check:v1", checkpoint: { number: Number(BigInt(block.number)), hash: block.hash, state_root: block.stateRoot },
      genesis_hash: bundle.genesisHash, config_sha256: configDigest(config), golden_sha256: reviewed.digest, code: [], storage: [], calls: [] };
    pinned = new CheckpointProvider(url, evidence);
    await reviewed.checkCode(pinned, "dao", config.daoAddress);
    await reviewed.checkCode(pinned, "dividend", config.dividendAddress);
    const dao = new ethers.Contract(config.daoAddress, reviewed.artifacts.get("SourceDao").abi, pinned);
    const dividend = new ethers.Contract(config.dividendAddress, reviewed.artifacts.get("DividendContract").abi, pinned);
    const admin: string = await dao.bootstrapAdmin();
    if (admin !== ethers.ZeroAddress && admin.toLowerCase() !== config.bootstrapAdminAddress.toLowerCase()) throw new Error("On-chain bootstrap admin differs from frozen configuration");
    const finalized: boolean = await dividend.bootstrapFinalized();
    const balance = await pinned.getBalance(config.bootstrapAdminAddress);
    const syncing = await provider.send("eth_syncing", []);
    const genesisConfig = (await readJson(bundle.genesisPath)).config;
    const gate = genesisConfig.dividendFeeSplitBlock ?? null;
    const blockers: string[] = [];
    if (syncing !== false) blockers.push("chain is still syncing");
    if (evidence.checkpoint.number === 0) blockers.push("wait for the first mined block");
    if (!finalized && balance === 0n) blockers.push("bootstrap admin has no gas funds");
    if (!finalized && gate !== null && evidence.checkpoint.number + 1 >= Number(gate)) blockers.push("Dividend fee split gate leaves no block for bootstrap; operator recovery is required");
    await pinned.finish();
    console.log(JSON.stringify({ schema_version: "sourcedao-bootstrap-check:v1", network: bundle.network, chain_id: config.chainId,
      genesis_hash: bundle.genesisHash, config_sha256: evidence.config_sha256, golden_sha256: reviewed.digest,
      checkpoint: evidence.checkpoint, bootstrap_admin: config.bootstrapAdminAddress, admin_balance_wei: balance.toString(),
      initialized: admin !== ethers.ZeroAddress, finalized, fee_split_block: gate, blockers,
      ready_for_bootstrap: !finalized && blockers.length === 0 }, null, 2));
  } finally { pinned?.destroy(); provider.destroy(); }
}

main().catch(error => { console.error(`Bootstrap check failed: ${error.message}`); process.exitCode = 1; });
