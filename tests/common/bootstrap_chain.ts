import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";

// Public Hardhat test key, used only on this ephemeral loopback chain.
export const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
export function runScript(script: string, args: string[], env: NodeJS.ProcessEnv = {}, cwd = path.resolve(import.meta.dirname, "../..")) {
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), path.resolve(import.meta.dirname, "../../scripts", script), ...args], {
    cwd, env: { ...process.env, SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY: TEST_KEY, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
  const result = new Promise<{ code: number | null; signal: string | null; output: string }>((resolve, reject) => {
    child.on("error", reject); child.on("exit", (code, signal) => resolve({ code, signal, output }));
  });
  return { child, result };
}
export async function startChain() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sourcedao-ceremony-"));
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  const node = spawn(process.execPath, ["node_modules/hardhat/dist/src/cli.js", "node", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  node.stdout.on("data", data => { log += data; }); node.stderr.on("data", data => { log += data; });
  const provider = new ethers.JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (node.exitCode !== null) throw new Error(log);
    try { await provider.send("eth_chainId", []); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!ready) { node.kill(); throw new Error(`Local test RPC failed to start: ${log}`); }
  const config = JSON.parse(await readFile("tools/config/sourcedao-bootstrap-full.example.json", "utf8"));
  delete config.rpcUrl;
  config.artifactsDir = path.resolve("artifacts-usdb");
  config.chainId = Number((await provider.getNetwork()).chainId);
  config.bootstrapAdminAddress = new ethers.Wallet(TEST_KEY).address;
  config.devToken = { name: "USDB Test Dev Token", symbol: "UTDT", totalSupply: "100000000000000000000", initAddresses: [config.bootstrapAdminAddress], initAmounts: ["5000000000000000000"] };
  config.normalToken = { name: "USDB Test Token", symbol: "UTT" };
  config.committee.initialMembers = [config.bootstrapAdminAddress];
  config.committee.mainProjectName = "USDB"; config.tokenLockup.unlockProjectName = "USDB";
  for (const [address, artifact] of [[config.daoAddress, "contracts/Dao.sol/SourceDao"], [config.dividendAddress, "contracts/Dividend.sol/DividendContract"]]) {
    const json = JSON.parse(await readFile(`artifacts-usdb/${artifact}.json`, "utf8"));
    await provider.send("hardhat_setCode", [address, json.deployedBytecode]);
  }
  await provider.send("evm_mine", []);
  const configPath = path.join(root, "config.json"), statePath = path.join(root, "state.json"), reportPath = path.join(root, "validation.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return { root, url, provider, config, configPath, statePath, reportPath,
    async close() { provider.destroy(); node.kill(); await new Promise(resolve => node.once("exit", resolve)); await rm(root, { recursive: true, force: true }); },
  };
}
