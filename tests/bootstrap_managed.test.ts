import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { startChain, TEST_KEY } from "./common/bootstrap_chain.js";
import { testBootstrapBundle } from "./common/bootstrap_bundle.js";

const image = process.env.SOURCE_DAO_MANAGED_TEST_IMAGE;
/** Run only when a locally built image is selected; never contact a live node. */
test("Managed Docker ceremony survives container death and exports validated public evidence", { skip: !image, timeout: 180_000 }, async () => {
  const chain = await startChain();
  let container: string | undefined;
  const run = (executable: string, args: string[]) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => output += data); child.stderr.on("data", data => output += data);
    child.on("error", reject); child.on("exit", code => resolve({ code, output }));
  });
  try {
    const bundle = await testBootstrapBundle(chain);
    const helper = path.resolve("../usdb/tests/common/sourcedao_container_runner.py");
    const invoke = (action: string, args: string[] = []) => run("python3", [helper, chain.root, bundle.root, chain.url, image!, action, ...args]);
    const pathsResult = await invoke("paths");
    assert.equal(pathsResult.code, 0, pathsResult.output);
    const paths = JSON.parse(pathsResult.output); container = paths.container;
    const key = path.join(chain.root, "admin.key");
    await writeFile(key, TEST_KEY, { mode: 0o600 });
    let result = await invoke("check"); assert.equal(result.code, 0, result.output);
    result = await invoke("bootstrap", ["--key-file", key]); assert.equal(result.code, 0, result.output);
    assert.equal(JSON.parse(result.output).outcome, "STARTED");
    let interrupted = false;
    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const journal = await readFile(`${paths.state}.transactions.json`, "utf8").then(JSON.parse).catch(() => undefined);
      if (journal?.transactions.length >= 3) {
        result = await run("docker", ["kill", container!]); assert.equal(result.code, 0, result.output);
        interrupted = true; break;
      }
    }
    assert.equal(interrupted, true, "must exercise a real interruption");
    const saved = JSON.parse(await readFile(`${paths.state}.transactions.json`, "utf8"));
    result = await invoke("status"); assert.equal(result.code, 1, result.output);
    assert.equal(JSON.parse(result.output).outcome, "FAILED");
    result = await invoke("bootstrap", ["--key-file", key]); assert.equal(result.code, 0, result.output);
    result = await invoke("status", ["--watch", "--interval", "1"]); assert.equal(result.code, 0, result.output);
    const resumed = JSON.parse(await readFile(`${paths.state}.transactions.json`, "utf8"));
    assert.equal(resumed.transactions.length, 22);
    assert.equal(await chain.provider.getTransactionCount(chain.config.bootstrapAdminAddress), 22);
    for (let i = 0; i < saved.transactions.length; i++) assert.equal(resumed.transactions[i].raw_transaction, saved.transactions[i].raw_transaction);
    const journalBytes = await readFile(`${paths.state}.transactions.json`, "utf8");
    result = await invoke("export"); assert.equal(result.code, 0, result.output);
    result = await invoke("validate"); assert.equal(result.code, 0, result.output);
    const report = JSON.parse(await readFile(paths.validation, "utf8"));
    assert.equal(report.mode, "strict"); assert.equal(report.status, "ok");
    const publicBytes = await readFile(paths.public_state, "utf8");
    assert.equal(publicBytes.includes(TEST_KEY), false); assert.equal(publicBytes.includes("raw_transaction"), false);
    assert.equal(await readFile(`${paths.state}.transactions.json`, "utf8"), journalBytes);
  } finally {
    if (container) await run("docker", ["rm", "-f", container]);
    await chain.close();
  }
});
