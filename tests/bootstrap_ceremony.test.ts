import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { ethers } from "ethers";
import { startChain, runScript } from "./common/bootstrap_chain.js";

test("Full ceremony recovers crashes without duplicate deployments and validates historical state", { timeout: 240_000 }, async () => {
  const chain = await startChain();
  let current: ReturnType<typeof runScript> | undefined, crashNonce: number | undefined;
  let replaceCheckpoint = false;
  const proxy = createServer(async (req, res) => {
    try {
      let body = ""; for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body), requests = Array.isArray(parsed) ? parsed : [parsed];
      const response = await fetch(chain.url, { method: "POST", headers: { "content-type": "application/json" }, body });
      let text = await response.text();
      if (replaceCheckpoint) {
        const payload = JSON.parse(text), responses = Array.isArray(payload) ? payload : [payload];
        for (const item of responses) {
          const request = requests.find(rpc => rpc.id === item.id);
          if (request?.method === "eth_getBlockByNumber" && request.params[0] !== "latest" && request.params[0] !== "0x0" && item.result) {
            item.result.hash = ethers.keccak256("0xdead");
          }
        }
        text = JSON.stringify(payload);
      }
      for (const rpc of requests) {
        if (rpc.method === "eth_sendRawTransaction" && ethers.Transaction.from(rpc.params[0]).nonce === crashNonce) {
          crashNonce = undefined; current?.child.kill("SIGKILL");
        }
      }
      res.writeHead(200, { "content-type": "application/json" }); res.end(text);
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(proxy.address() as any).port}`;
  const args = ["--config", chain.configPath, "--rpc-url", url, "--state-file", chain.statePath];
  try {
    // Crash after broadcast/receipt, before tool observes it: initialize,
    // implementation, proxy, wiring and finalization are separate checkpoints.
    for (const nonce of [0, 3, 4, 5, 21]) {
      crashNonce = nonce;
      current = runScript("usdb_bootstrap_full.ts", args);
      const result = await current.result;
      assert.equal(result.signal, "SIGKILL", result.output);
      const journal = JSON.parse(await readFile(`${chain.statePath}.transactions.json`, "utf8"));
      assert.equal(journal.transactions.at(-1).nonce, nonce);
      assert.equal(journal.transactions.length, nonce + 1);
      // The test has observed the writer's death; production operators must
      // make the same check before removing an abandoned lock.
      await unlink(`${chain.statePath}.lock`);
    }
    current = runScript("usdb_bootstrap_full.ts", args);
    let result = await current.result;
    assert.equal(result.code, 0, result.output);
    let state = JSON.parse(await readFile(chain.statePath, "utf8"));
    assert.equal(state.status, "completed"); assert.equal(state.operations.length, 22);
    const transactions = state.operations.map((op: any) => op.tx_hash);
    const initial = await readFile(chain.statePath, "utf8");
    const wrong = { ...chain.config, chainId: chain.config.chainId + 1 };
    await writeFile(chain.configPath, JSON.stringify(wrong));
    result = await runScript("usdb_bootstrap_full.ts", args).result;
    assert.equal(result.code, 1); assert.match(result.output, /unexpected chainId/);
    assert.equal(await readFile(chain.statePath, "utf8"), initial);
    await writeFile(chain.configPath, JSON.stringify({ ...chain.config, cycleMinLength: chain.config.cycleMinLength + 1 }));
    result = await runScript("usdb_bootstrap_full.ts", args).result;
    assert.equal(result.code, 1); assert.match(result.output, /journal identity mismatch/);
    assert.equal(await readFile(chain.statePath, "utf8"), initial);
    await writeFile(chain.configPath, JSON.stringify(chain.config));
    result = await runScript("usdb_bootstrap_full.ts", args).result;
    assert.equal(result.code, 0, result.output);
    state = JSON.parse(await readFile(chain.statePath, "utf8"));
    assert.deepEqual(state.operations.map((op: any) => op.tx_hash), transactions);
    assert.equal(await readFile(chain.statePath, "utf8"), initial, "completed acceptance input must remain byte-for-byte stable");
    assert.equal(await chain.provider.getTransactionCount(chain.config.bootstrapAdminAddress), 22);

    const validateArgs = [...args, "--strict", "--output", chain.reportPath];
    result = await runScript("usdb_validate_bootstrap.ts", validateArgs).result;
    assert.equal(result.code, 0, result.output);
    const report = JSON.parse(await readFile(chain.reportPath, "utf8"));
    assert.equal(report.evidence.code.length, 14);
    const height = report.evidence.checkpoint.number;
    replaceCheckpoint = true;
    result = await runScript("usdb_validate_bootstrap.ts", validateArgs).result;
    replaceCheckpoint = false;
    assert.equal(result.code, 1); assert.match(result.output, /checkpoint changed/);
    const corruptions = [
      { message: /mainContractAddress mismatch/, async apply() {
        await chain.provider.send("hardhat_setStorageAt", [state.final_wiring.committee, ethers.toBeHex(0, 32), ethers.toBeHex(0x9999, 32)]);
      } },
      { message: /investmentCount mismatch/, async apply() {
        await chain.provider.send("hardhat_setStorageAt", [state.final_wiring.acquired, ethers.toBeHex(51, 32), ethers.toBeHex(chain.config.acquired.initInvestmentCount + 1, 32)]);
      } },
      { message: /implementation differs/, async apply() {
        const slot = await chain.provider.getStorage(state.final_wiring.committee, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
        const implementation = ethers.getAddress(ethers.dataSlice(slot, 12));
        const code = await chain.provider.getCode(implementation);
        await chain.provider.send("hardhat_setCode", [implementation, `${code}00`]);
        const committee = new ethers.Contract(state.final_wiring.committee, ["function version() view returns (string)"], chain.provider);
        assert.equal(await committee.version(), report.modules.committee.version, "corruption must preserve the advertised version");
      } },
    ];
    for (const corruption of corruptions) {
      const snapshot = await chain.provider.send("evm_snapshot", []);
      try {
        await corruption.apply();
        await chain.provider.send("evm_mine", []);
        result = await runScript("usdb_validate_bootstrap.ts", validateArgs).result;
        assert.equal(result.code, 1, result.output); assert.match(result.output, corruption.message);
      } finally { await chain.provider.send("evm_revert", [snapshot]); }
    }
    // A later token transfer keeps metadata and totalReleased unchanged, but
    // strict latest validation must reject the altered holder distribution.
    const token = new ethers.Contract(state.final_wiring.dev_token, ["function transfer(address,uint256) returns(bool)"], new ethers.Wallet((await import("./common/bootstrap_chain.js")).TEST_KEY, chain.provider));
    await (await token.transfer(state.final_wiring.token_lockup, 1n)).wait();
    result = await runScript("usdb_validate_bootstrap.ts", validateArgs).result;
    assert.equal(result.code, 1); assert.match(result.output, /DevToken.balanceOf/);
    result = await runScript("usdb_validate_bootstrap.ts", [...validateArgs, "--block", String(height)]).result;
    assert.equal(result.code, 0, result.output);
    const historical = JSON.parse(await readFile(chain.reportPath, "utf8"));
    assert.deepEqual(historical.evidence, report.evidence);
    await chain.provider.send("hardhat_setCode", [state.final_wiring.committee, "0x60006000f3"]);
    result = await runScript("usdb_validate_bootstrap.ts", validateArgs).result;
    assert.equal(result.code, 1); assert.match(result.output, /runtime differs/);
  } finally {
    current?.child.kill();
    proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve));
    await chain.close();
  }
});
