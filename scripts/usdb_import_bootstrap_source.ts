import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { ethers } from "ethers";
import { createJson, readJson, lockState } from "./lib/bootstrap_io.js";
import { readBootstrapSource, type BootstrapSource } from "./lib/bootstrap_source.js";

async function main() {
  const options: Record<string, string> = {};
  const names = ["--source-rpc-url", "--source-config", "--block", "--config", "--output", "--report"];
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--help") {
      console.log("Usage: tsx scripts/usdb_import_bootstrap_source.ts --source-rpc-url <url> --source-config <file> --block <height> --config <base> --output <new-config> --report <new-report>");
      return;
    }
    if (!names.includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (arg in options) throw new Error(`Duplicate argument: ${arg}`);
    const value = process.argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value: ${arg}`);
    options[arg] = value;
  }
  for (const name of names) if (!(name in options)) throw new Error(`Required argument: ${name}`);
  if (!/^[1-9][0-9]*$/.test(options["--block"])) throw new Error("--block must be an explicit positive integer");
  const height = Number(options["--block"]);
  if (!Number.isSafeInteger(height)) throw new Error("Unsafe source block height");
  const configPath = await realpath(options["--config"]);
  const sourcePath = await realpath(options["--source-config"]);
  const output = path.resolve(options["--output"]), reportPath = path.resolve(options["--report"]);
  if (new Set([output, reportPath, configPath, sourcePath]).size !== 4) throw new Error("Input and output paths must be distinct");
  // Never rewrite frozen release inputs or an earlier import. Existing symlinks also count as files.
  async function requireNew(filename: string) {
    try { await lstat(filename); } catch (error: any) { if (error.code === "ENOENT") return; throw error; }
    throw new Error(`Output already exists: ${filename}`);
  }
  const base = await readJson(configPath), source = await readJson<BootstrapSource>(sourcePath);
  const unlockOutput = await lockState(output);
  let unlockReport: (() => Promise<void>) | undefined;
  let provider: ethers.JsonRpcProvider | undefined;
  try {
    unlockReport = await lockState(reportPath);
    await requireNew(output); await requireNew(reportPath);
    const request = new ethers.FetchRequest(options["--source-rpc-url"]);
    request.timeout = 30_000;
    provider = new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 10, cacheTimeout: -1 });
    console.error(`Reading source DAO: chain=${source.chainId}, block=${height}, dao=${source.daoAddress}`);
    const result = await readBootstrapSource(provider, source, height, base);
    if (result.config.artifactsDir && !path.isAbsolute(result.config.artifactsDir)) {
      result.config.artifactsDir = path.relative(path.dirname(output), path.resolve(path.dirname(configPath), result.config.artifactsDir)) || ".";
    }
    await createJson(reportPath, result.report);
    await createJson(output, result.config);
    console.log(JSON.stringify({ config: output, report: reportPath, committeeMembers: result.config.committee.initialMembers.length,
      allocations: result.config.devToken.initAddresses.length, totalSupply: result.config.devToken.totalSupply }, null, 2));
  } finally {
    provider?.destroy();
    if (unlockReport) await unlockReport();
    await unlockOutput();
  }
}

main().catch(error => { console.error(`Source import failed: ${error.shortMessage ?? error.message ?? String(error)}`); process.exitCode = 1; });
