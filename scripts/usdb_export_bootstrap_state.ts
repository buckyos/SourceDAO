import path from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { createJson, readJson, lockState } from "./lib/bootstrap_io.js";
import { publicBootstrapState, verifyExportJournal } from "./lib/bootstrap_public_state.js";
import { loadBootstrapBundle } from "./lib/bootstrap_release.js";
import { assertSelectedNetwork, ceremonyPaths, defaultBundleDirectory, selectedNetwork } from "./lib/bootstrap_paths.js";

async function main() {
  const options: Record<string, string> = {};
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];
    if (arg === "--help") { console.log("Usage: export-state [--network <profile>] [--bundle-dir <bundle> | --config <public-config>] [--state-file <private-state>] [--output <public-state>]\nDefaults: selected frozen bundle; private ceremony state; security/public/<chain>/<genesis>/<config>/sourcedao-bootstrap-public-state.json"); return; }
    if (!["--config", "--bundle-dir", "--network", "--state-file", "--output"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (arg in options) throw new Error(`Duplicate argument: ${arg}`);
    const value = process.argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value: ${arg}`);
    options[arg] = value;
  }
  const configured = options["--config"] || process.env.SOURCE_DAO_USDB_CONFIG;
  if (configured && (options["--bundle-dir"] || options["--network"])) throw new Error("Use --bundle-dir/--network or --config, not both");
  const network = options["--network"] || (!options["--bundle-dir"] && !configured ? selectedNetwork() : undefined);
  const bundle = configured ? undefined : await loadBootstrapBundle(options["--bundle-dir"] || defaultBundleDirectory(network));
  if (bundle) assertSelectedNetwork(bundle.network, network);
  const paths = bundle ? ceremonyPaths(bundle.config, bundle.genesisHash) : undefined;
  const stateFile = options["--state-file"] || process.env.SOURCE_DAO_USDB_STATE_FILE || paths?.state;
  const outputFile = options["--output"] || paths?.publicState;
  if (!stateFile || !outputFile) throw new Error("Explicit --config mode requires --state-file and --output");
  const statePath = await realpath(stateFile), configPath = await realpath(configured || bundle!.configPath), output = path.resolve(outputFile);
  if ([statePath, configPath, `${statePath}.transactions.json`].includes(output)) throw new Error("Public output must be separate from private inputs");
  const unlock = await lockState(statePath);
  try {
    const state = publicBootstrapState(await readJson(statePath), await readJson(configPath));
    if (bundle && (state.ceremony_identity.genesis_hash !== bundle.genesisHash || state.ceremony_identity.golden_sha256 !== bundle.goldenDigest)) throw new Error("Private state differs from frozen bundle identity");
    verifyExportJournal(state, await readJson(`${statePath}.transactions.json`));
    try { await createJson(output, state); } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      if (await readFile(output, "utf8") !== `${JSON.stringify(state, null, 2)}\n`) throw new Error("Existing public state differs; refusing to replace accepted evidence");
    }
    console.log(`Exported public bootstrap state: ${output}`);
  } finally { await unlock(); }
}
main().catch(error => { console.error(`Public state export failed: ${error.message ?? String(error)}`); process.exitCode = 1; });
