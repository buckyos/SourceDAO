import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { atomicJson, createJson, readJson, lockState, configDigest } from "../scripts/lib/bootstrap_io.js";
import { auditArtifacts, decodeRuntime, findForbiddenOpcodes, requiredContracts } from "../scripts/audit_usdb_bytecode.mjs";

test("Opcode audit scans flat and object artifacts, skips PUSH data and valid metadata only", async () => {
  for (const value of ["0x5c00", { object: "5c00" }]) assert.equal(findForbiddenOpcodes(decodeRuntime(value))[0].opcodeName, "TLOAD");
  assert.deepEqual(findForbiddenOpcodes(decodeRuntime("0x605c615d5e00")), []);
  // CBOR {solc: bytes(5c5d5e)}, with the Solidity two-byte trailer length.
  assert.deepEqual(findForbiddenOpcodes(decodeRuntime("0x00a164736f6c63435c5d5e000a")), []);
  assert.equal(findForbiddenOpcodes(decodeRuntime("0x00a164736f6c63435c5d5e000b")).length, 3);
  for (const value of [undefined, "0x0", "0xzz", "0x__$123$__"]) assert.throws(() => decodeRuntime(value));
  const root = await mkdtemp(path.join(os.tmpdir(), "sourcedao-audit-"));
  try {
    assert.throws(() => auditArtifacts(root), /No executable/);
    for (const name of requiredContracts) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), JSON.stringify({ contractName: "Test", sourceName: "Test.sol", abi: [], deployedBytecode: "0x00" }));
    }
    assert.equal(auditArtifacts(root).scanned, 9);
    await writeFile(path.join(root, requiredContracts[0]), JSON.stringify({ contractName: "Test", sourceName: "Test.sol", abi: [], deployedBytecode: "0x5e" }));
    assert.throws(() => auditArtifacts(root), /Forbidden/);
    await rm(path.join(root, requiredContracts[0]));
    assert.throws(() => auditArtifacts(root), /Required runtime/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Atomic state, exclusive lock and duplicate-key rejection preserve evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sourcedao-state-")), file = path.join(root, "state.json");
  try {
    await atomicJson(file, { operations: ["confirmed"] });
    await assert.rejects(createJson(file, { operations: [] }), { code: "EEXIST" });
    const unlock = await lockState(file);
    await assert.rejects(lockState(file), /Bootstrap lock exists/);
    assert.deepEqual((await readJson(file)).operations, ["confirmed"]);
    await unlock();
    await (await lockState(file))();
    await writeFile(file, '{"config":{"chainId":1,"chainId":2}}');
    await assert.rejects(readJson(file), /Duplicate key/);
    assert.equal(configDigest({ chainId: 1, rpcUrl: "a", artifactsDir: "b" }), configDigest({ chainId: 1, rpcUrl: "c" }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Both CLI entrypoints accept public config with RPC override and reject unknown arguments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sourcedao-public-config-"));
  const config = path.join(root, "config.json");
  const publicConfig = JSON.parse(await readFile("tools/config/sourcedao-bootstrap-full.example.json", "utf8"));
  delete publicConfig.rpcUrl;
  await writeFile(config, JSON.stringify(publicConfig));
  try {
  for (const script of ["usdb_bootstrap_full.ts", "usdb_validate_bootstrap.ts"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}`, "--config", config, "--rpc-url", "http://127.0.0.1:1", "--invalid"], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown argument/);
  }
  } finally { await rm(root, { recursive: true, force: true }); }
});
