import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertSelectedNetwork, ceremonyPaths, defaultBundleDirectory, selectedNetwork, SOURCE_DAO_ROOT } from "./lib/bootstrap_paths.js";
import { loadBootstrapBundle } from "./lib/bootstrap_release.js";

const commands: Record<string, string> = {
  bootstrap: "usdb_bootstrap_full.ts", validate: "usdb_validate_bootstrap.ts",
  "export-state": "usdb_export_bootstrap_state.ts", "import-source": "usdb_import_bootstrap_source.ts",
};
const command = process.argv[2];
if (!command || command === "--help") {
  console.log("Usage: sourcedao-tools <import-source|prepare|freeze|paths|bootstrap|export-state|validate> [arguments]\nprepare/freeze require the sibling USDB checkout and Python 3.10+.");
} else if (command === "paths") {
  try {
    const options: Record<string, string> = {};
    for (let i = 3; i < process.argv.length; i++) {
      const name = process.argv[i];
      if (name === "--help") { console.log("Usage: paths [--network <profile>] [--bundle-dir <directory>]; print resolved paths without RPC or private key"); process.exit(0); }
      const value = process.argv[++i];
      if (!["--network", "--bundle-dir"].includes(name) || name in options || !value || value.startsWith("--")) throw new Error(`Invalid paths argument: ${name}`);
      options[name] = value;
    }
    const network = options["--network"] || (!options["--bundle-dir"] ? selectedNetwork() : undefined);
    const bundleDir = options["--bundle-dir"] || defaultBundleDirectory(network);
    const bundle = await loadBootstrapBundle(bundleDir);
    assertSelectedNetwork(bundle.network, network);
    const paths = ceremonyPaths(bundle.config, bundle.genesisHash);
    console.log(JSON.stringify({ network: bundle.network, bundleDir: path.resolve(bundleDir), config: bundle.configPath, genesis: bundle.genesisPath,
      golden: bundle.goldenPath, ...paths, state: path.resolve(process.env.SOURCE_DAO_USDB_STATE_FILE || paths.state) }, null, 2));
  } catch (error: any) { console.error(`Bootstrap paths failed: ${error.message}`); process.exitCode = 1; }
} else if (!(command in commands) && !["prepare", "freeze"].includes(command)) {
  console.error(`Unknown SourceDAO command: ${command}`); process.exitCode = 1;
} else {
  const preparation = command === "prepare" || command === "freeze";
  const child = preparation ? spawn("python3", [path.resolve(SOURCE_DAO_ROOT, "../usdb/docker/scripts/tools/freeze_sourcedao_bootstrap.py"),
    ...(command === "prepare" ? ["--prepare"] : []), ...process.argv.slice(3)], { stdio: "inherit" }) :
    spawn(process.execPath, ["--import", import.meta.resolve("tsx"), fileURLToPath(new URL(commands[command], import.meta.url)), ...process.argv.slice(3)], { stdio: "inherit" });
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
}
