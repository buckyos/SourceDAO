import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { ethers } from "ethers";
import { createJson, readJson, lockState, configDigest, canonicalJson, sha256 } from "./lib/bootstrap_io.js";
import { readBootstrapSource, sharedSourceImport, sourceIdentity, validateSource, type BootstrapSource } from "./lib/bootstrap_source.js";
import { DEFAULT_SOURCE_CONFIG } from "./lib/bootstrap_paths.js";

async function main() {
  const options: Record<string, string> = {};
  const names = ["--source-rpc-url", "--source-config", "--block", "--block-hash", "--config", "--output", "--report", "--output-dir"];
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--help") {
      console.log(`Usage: import-source [--source-config <file>] [--source-rpc-url <url>] [--block <height> --block-hash <hash>] [--output-dir <directory>]\nDefaults: ${DEFAULT_SOURCE_CONFIG}; outputs in sources/optimism/imports/<block>.\nLegacy: --config <base> --output <new-config> --report <new-report>`);
      return;
    }
    if (!names.includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (arg in options) throw new Error(`Duplicate argument: ${arg}`);
    const value = process.argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value: ${arg}`);
    options[arg] = value;
  }
  if (options["--output-dir"] && (options["--output"] || options["--report"])) throw new Error("Use --output-dir or --output/--report, not both");
  if (Boolean(options["--output"]) !== Boolean(options["--report"])) throw new Error("--output and --report must be supplied together");
  if (options["--config"] && !options["--output"] && !options["--output-dir"]) throw new Error("Legacy --config requires explicit output paths; shared defaults never store a destination config");
  const sourcePath = await realpath(options["--source-config"] || DEFAULT_SOURCE_CONFIG);
  const source = await readJson<BootstrapSource>(sourcePath);
  const block = options["--block"] || String(source.blockNumber ?? "");
  if (!/^[1-9][0-9]*$/.test(block)) throw new Error("--block or source blockNumber must be an explicit positive integer");
  const height = Number(block);
  if (!Number.isSafeInteger(height)) throw new Error("Unsafe source block height");
  if (source.blockNumber !== undefined && height !== source.blockNumber && !options["--block-hash"]) throw new Error("Overriding the pinned block requires --block-hash");
  source.blockHash = options["--block-hash"] || source.blockHash;
  if (source.blockHash && !/^0x[0-9a-fA-F]{64}$/.test(source.blockHash)) throw new Error("Invalid source blockHash");
  if (!options["--config"] && !source.blockHash) throw new Error("Shared source import requires blockHash in source config or --block-hash");
  const rpcUrl = options["--source-rpc-url"] || process.env.SOURCE_DAO_SOURCE_RPC_URL || source.rpcUrl;
  if (!rpcUrl) throw new Error("Source RPC URL is required in source config, environment or --source-rpc-url");
  const configPath = options["--config"] ? await realpath(options["--config"]) : undefined;
  const directory = path.resolve(options["--output-dir"] || path.join(path.dirname(sourcePath), "imports", block));
  const output = path.resolve(options["--output"] || path.join(directory, "sourcedao-bootstrap-imported.json"));
  const reportPath = path.resolve(options["--report"] || path.join(directory, "sourcedao-bootstrap-source.json"));
  const paths = [output, reportPath, sourcePath, ...(configPath ? [configPath] : [])];
  if (new Set(paths).size !== paths.length) throw new Error("Input and output paths must be distinct");
  // Never rewrite frozen release inputs or an earlier import. Existing symlinks also count as files.
  async function requireNew(filename: string) {
    try { await lstat(filename); } catch (error: any) { if (error.code === "ENOENT") return; throw error; }
    throw new Error(`Output already exists: ${filename}`);
  }
  const base = configPath ? await readJson(configPath) : undefined;
  validateSource(source);
  const unlockOutput = await lockState(output);
  let unlockReport: (() => Promise<void>) | undefined;
  let provider: ethers.JsonRpcProvider | undefined;
  try {
    unlockReport = await lockState(reportPath);
    if (!configPath && !options["--output"] && !options["--report"]) {
      // A pinned complete import can be reused offline. A partial pair or changed identity fails closed.
      let cached;
      try { await lstat(output); cached = await readJson(output); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
      if (cached) {
        const previous = await readJson(reportPath);
        if (previous.schemaVersion !== "sourcedao-bootstrap-source:v2" || previous.sourceIdentitySha256 !== sha256(canonicalJson(sourceIdentity(source))) ||
            canonicalJson(previous.source) !== canonicalJson(sourceIdentity(source)) || previous.checkpoint?.number !== height ||
            previous.checkpoint?.hash?.toLowerCase() !== source.blockHash!.toLowerCase() ||
            previous.importedSha256 !== configDigest(cached) || canonicalJson(cached) !== canonicalJson(sharedSourceImport(previous))) {
          throw new Error("Existing shared import differs from pinned source; use a new --output-dir after review");
        }
        console.log(JSON.stringify({ imported: output, report: reportPath, reused: true, message: "Verified saved source evidence; no new RPC audit performed" }, null, 2));
        return;
      }
    }
    await requireNew(output); await requireNew(reportPath);
    const request = new ethers.FetchRequest(rpcUrl);
    request.timeout = 30_000;
    provider = new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 10, cacheTimeout: -1 });
    console.error(`Reading source DAO: chain=${source.chainId}, block=${height}, dao=${source.daoAddress}`);
    const result = await readBootstrapSource(provider, source, height, base);
    if (configPath && result.config.artifactsDir && !path.isAbsolute(result.config.artifactsDir)) {
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
