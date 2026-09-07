import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";
import { originalMints, readBootstrapSource, validateSource, type BootstrapSource } from "../scripts/lib/bootstrap_source.js";
import { startChain, runScript } from "./common/bootstrap_chain.js";

test("Original mints reject later transfers and preserve exact integer allocations", () => {
  const token = "0x0000000000000000000000000000000000000001", holder = "0x0000000000000000000000000000000000000002";
  const abi = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)", "event Initialized(uint64 version)"]);
  const event = (name: string, args: any[]) => ({ address: token, ...abi.encodeEventLog(abi.getEvent(name)!, args) });
  const initialized = event("Initialized", [1]);
  const mint = event("Transfer", [ethers.ZeroAddress, holder, 9007199254740993123456n]);
  assert.equal(originalMints(token, [initialized, mint]).get(holder), 9007199254740993123456n);
  assert.throws(() => originalMints(token, [mint]), /initialization event/);
  assert.throws(() => originalMints(token, [initialized, initialized, mint]), /initialization event/);
  assert.throws(() => originalMints(token, [initialized, event("Transfer", [holder, token, 1])]), /Non-mint/);
  const source = JSON.parse('{"schemaVersion":1,"chainId":10,"daoAddress":"0x0000000000000000000000000000000000000001"}');
  assert.throws(() => validateSource(source), /Invalid source address/);
});

test("Source import recovers deployment allocations after conversion and preserves destination policy", { timeout: 120_000 }, async () => {
  const chain = await startChain();
  try {
    const deployed = await runScript("usdb_bootstrap_full.ts", ["--config", chain.configPath, "--rpc-url", chain.url, "--state-file", chain.statePath]).result;
    assert.equal(deployed.code, 0, deployed.output);
    const state = JSON.parse(await readFile(chain.statePath, "utf8"));
    const source: BootstrapSource = {
      schemaVersion: 1, chainId: chain.config.chainId, daoAddress: chain.config.daoAddress,
      modules: { devToken: state.modules.dev_token.address, normalToken: state.modules.normal_token.address,
        committee: state.modules.committee.address, lockup: state.modules.token_lockup.address,
        dividend: chain.config.dividendAddress, project: state.modules.project.address, acquired: state.modules.acquired.address },
      deploymentTransactions: { devToken: state.modules.dev_token.proxy_tx_hash, normalToken: state.modules.normal_token.proxy_tx_hash },
    };
    const dev = new ethers.Contract(source.modules.devToken, ["function dev2normal(uint256)", "function totalSupply() view returns(uint256)"], await chain.provider.getSigner(chain.config.bootstrapAdminAddress));
    await (await dev.dev2normal(ethers.parseEther("1"))).wait();
    assert.equal(await dev.totalSupply(), ethers.parseEther("99"));
    const height = Number(BigInt(await chain.provider.send("eth_blockNumber", [])));
    const base = structuredClone(chain.config);
    base.chainId = 202608250;
    base.devToken.name = "Independent USDB governance";
    base.devToken.totalSupply = "1";
    base.committee.initialMembers = [ethers.getAddress("0x0000000000000000000000000000000000009999")];
    const before = JSON.stringify(base), nonce = await chain.provider.getTransactionCount(chain.config.bootstrapAdminAddress);
    const imported = await readBootstrapSource(chain.provider, source, height, base);
    assert.equal(imported.config.devToken.totalSupply, ethers.parseEther("100").toString());
    assert.deepEqual(imported.config.devToken.initAmounts, [ethers.parseEther("5").toString()]);
    assert.equal(imported.report.tokens.normalToken.totalSupply, "0", "later BDT conversion must not enter the initial allocation");
    assert.equal(imported.report.tokens.devToken.reserve, ethers.parseEther("95").toString());
    assert.deepEqual(imported.config.committee.initialMembers, chain.config.committee.initialMembers);
    assert.equal(imported.config.devToken.name, base.devToken.name);
    assert.deepEqual(imported.config.normalToken, base.normalToken);
    for (const name of ["chainId", "daoAddress", "dividendAddress", "bootstrapAdminAddress", "cycleMinLength", "project", "tokenLockup", "acquired"]) {
      assert.deepEqual(imported.config[name], base[name], name);
    }
    const { initialMembers: _, ...committeePolicy } = imported.config.committee;
    const { initialMembers: __, ...originalPolicy } = base.committee;
    assert.deepEqual(committeePolicy, originalPolicy);
    assert.equal(JSON.stringify(base), before);
    assert.equal(await chain.provider.getTransactionCount(chain.config.bootstrapAdminAddress), nonce, "import must not send transactions");
    await assert.rejects(readBootstrapSource(chain.provider, { ...source, chainId: source.chainId + 1 }, height, base), /chain ID mismatch/);
    await assert.rejects(readBootstrapSource(chain.provider, { ...source, modules: { ...source.modules, devToken: chain.config.bootstrapAdminAddress } }, height, base), /module mismatch/);
    await assert.rejects(readBootstrapSource(chain.provider, { ...source, deploymentTransactions: { ...source.deploymentTransactions, devToken: source.deploymentTransactions.normalToken } }, height, base), /successful direct CREATE/);
    function altered(overrides: Record<string, (...args: any[]) => any>) {
      return new Proxy(chain.provider, { get(target, key) {
        if (typeof key === "string" && key in overrides) return overrides[key];
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    }
    await assert.rejects(readBootstrapSource(altered({ getCode: async (address, block) => {
      if (block < height) throw new Error("historical state unavailable");
      return chain.provider.getCode(address, block);
    } }), source, height, base), /historical state unavailable/);
    await assert.rejects(readBootstrapSource(altered({ send: async (method, args) => {
      const response = await chain.provider.send(method, args);
      return method === "eth_getBlockByNumber" ? { ...response, hash: ethers.keccak256("0xdead") } : response;
    } }), source, height, base), /block changed during import/);

    const sourcePath = path.join(chain.root, "source.json"), output = path.join(chain.root, "import.json"), report = path.join(chain.root, "source-report.json");
    await writeFile(sourcePath, JSON.stringify(source));
    const args = ["--source-rpc-url", chain.url, "--source-config", sourcePath, "--block", String(height), "--config", chain.configPath, "--output", output, "--report", report];
    let result = await runScript("usdb_import_bootstrap_source.ts", args).result;
    assert.equal(result.code, 0, result.output);
    const configBytes = await readFile(output, "utf8"), reportBytes = await readFile(report, "utf8");
    result = await runScript("usdb_import_bootstrap_source.ts", args).result;
    assert.equal(result.code, 1); assert.match(result.output, /already exists/);
    assert.equal(await readFile(output, "utf8"), configBytes);
    assert.equal(await readFile(report, "utf8"), reportBytes);
    result = await runScript("usdb_import_bootstrap_source.ts", [...args, "--unknown"]).result;
    assert.equal(result.code, 1); assert.match(result.output, /Unknown argument/);

    // The shared path needs no target config, RPC flag, block flag or individual output paths.
    const checkpoint = await chain.provider.getBlock(height);
    await writeFile(sourcePath, JSON.stringify({ ...source, rpcUrl: chain.url, blockNumber: height, blockHash: checkpoint!.hash }));
    const sharedDir = path.join(chain.root, "shared"), sharedArgs = ["--source-config", sourcePath, "--output-dir", sharedDir];
    result = await runScript("usdb_import_bootstrap_source.ts", sharedArgs, {}, chain.root).result;
    assert.equal(result.code, 0, result.output);
    const sharedPath = path.join(sharedDir, "sourcedao-bootstrap-imported.json"), sharedReportPath = path.join(sharedDir, "sourcedao-bootstrap-source.json");
    const shared = JSON.parse(await readFile(sharedPath, "utf8")), sharedReportBytes = await readFile(sharedReportPath, "utf8");
    assert.equal(shared.schemaVersion, "sourcedao-bootstrap-import:v1");
    assert.equal("chainId" in shared, false); assert.equal("bootstrapAdminAddress" in shared, false);
    assert.equal(shared.devToken.totalSupply, ethers.parseEther("100").toString());
    assert.equal(sharedReportBytes.includes(chain.url), false);
    assert.equal(sharedReportBytes.includes("baseConfigSha256"), false);
    result = await runScript("usdb_import_bootstrap_source.ts", sharedArgs).result;
    assert.equal(result.code, 0, result.output); assert.match(result.output, /no new RPC audit/);
    assert.equal(await readFile(sharedReportPath, "utf8"), sharedReportBytes);
    result = await runScript("usdb_import_bootstrap_source.ts", [...sharedArgs, "--block", String(height + 1)]).result;
    assert.equal(result.code, 1); assert.match(result.output, /requires --block-hash/);
    result = await runScript("usdb_import_bootstrap_source.ts", [...sharedArgs, "--output", output]).result;
    assert.equal(result.code, 1); assert.match(result.output, /not both/);
    await assert.rejects(readBootstrapSource(chain.provider, { ...source, blockHash: `0x${"aa".repeat(32)}` }, height), /checkpoint hash mismatch/);
    shared.devToken.totalSupply = "1"; await writeFile(sharedPath, JSON.stringify(shared));
    result = await runScript("usdb_import_bootstrap_source.ts", sharedArgs).result;
    assert.equal(result.code, 1); assert.match(result.output, /differs from pinned source/);
  } finally { await chain.close(); }
});
