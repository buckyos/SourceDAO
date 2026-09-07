import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ceremonyPaths, defaultBundleDirectory, selectedNetwork, SECURITY_ROOT } from "../scripts/lib/bootstrap_paths.js";
import { applySourceImport, sharedSourceImport } from "../scripts/lib/bootstrap_source.js";
import { configDigest } from "../scripts/lib/bootstrap_io.js";
import { runScript } from "./common/bootstrap_chain.js";

test("Shared saved source applies to distinct target networks without importing their policy", async () => {
  const sourceDir = path.join(SECURITY_ROOT, "sources/optimism/imports/156576688");
  const report = JSON.parse(await readFile(path.join(sourceDir, "sourcedao-bootstrap-source.json"), "utf8"));
  const imported = JSON.parse(await readFile(path.join(sourceDir, "sourcedao-bootstrap-imported.json"), "utf8"));
  assert.deepEqual(sharedSourceImport(report), imported);
  assert.equal(configDigest(imported), report.importedSha256);
  const base = { schemaVersion: 1, chainId: 100, bootstrapAdminAddress: "target-admin", committee: { initialMembers: [], mainProjectName: "USDB" }, devToken: { name: "USDB Dev" }, normalToken: { name: "USDB" } };
  const first = applySourceImport(base, imported), second = applySourceImport({ ...base, chainId: 200 }, imported);
  assert.equal(first.chainId, 100); assert.equal(second.chainId, 200);
  assert.equal(first.bootstrapAdminAddress, "target-admin");
  assert.deepEqual(first.devToken, second.devToken); assert.equal(first.devToken.name, "USDB Dev");
  assert.deepEqual(base.committee.initialMembers, []);
  const hash = `0x${"01".repeat(32)}`, otherHash = `0x${"02".repeat(32)}`;
  assert.notEqual(ceremonyPaths(first, hash).state, ceremonyPaths(second, hash).state);
  assert.notEqual(ceremonyPaths(first, hash).state, ceremonyPaths(first, otherHash).state);
  assert.notEqual(ceremonyPaths(first, hash).state, ceremonyPaths({ ...first, cycleMinLength: 100 }, hash).state);
  assert.notEqual(ceremonyPaths(first, hash).state, ceremonyPaths(first, hash).publicState);
  assert.throws(() => selectedNetwork("../mainnet"), /Invalid/);
});

test("Default import works outside the checkout and missing bundle never selects an example", async () => {
  const imported = await runScript("usdb_bootstrap_tools.ts", ["import-source"], {}, "/tmp").result;
  assert.equal(imported.code, 0, imported.output); assert.match(imported.output, /no new RPC audit/);
  assert.match(imported.output, /security\/sources\/optimism\/imports\/156576688/);
  const missing = await runScript("usdb_bootstrap_full.ts", [], { SOURCE_DAO_BUNDLE_DIR: "/tmp/absent-sourcedao-frozen-bundle-fixture", SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY: "" }, "/tmp").result;
  assert.equal(missing.code, 1); assert.match(missing.output, /absent-sourcedao-frozen-bundle-fixture/);
  assert.doesNotMatch(missing.output, /sourcedao-bootstrap-full.example/);
  const legacy = await runScript("usdb_import_bootstrap_source.ts", ["--config", "unused.json"], {}, "/tmp").result;
  assert.equal(legacy.code, 1); assert.match(legacy.output, /shared defaults never store a destination config/);
  assert.ok(path.isAbsolute(defaultBundleDirectory()));
});
