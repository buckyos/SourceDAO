import fs from "node:fs";
import path from "node:path";

const artifactsRoot = process.env.SOURCE_DAO_ARTIFACTS_DIR ?? path.resolve("artifacts-usdb");

const forbiddenOpcodes = new Map([
  [0x49, "BLOBHASH"],
  [0x4a, "BLOBBASEFEE"],
  [0x5c, "TLOAD"],
  [0x5d, "TSTORE"],
  [0x5e, "MCOPY"],
]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".dbg.json")) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeBytecodeObject(bytecodeObject) {
  if (typeof bytecodeObject !== "string" || bytecodeObject.length === 0) {
    return null;
  }
  const normalized = bytecodeObject.startsWith("0x") ? bytecodeObject.slice(2) : bytecodeObject;
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.includes("__")) {
    return null;
  }
  return normalized;
}

function decodeBytecode(bytecodeObject) {
  const normalized = normalizeBytecodeObject(bytecodeObject);
  if (normalized === null) {
    return null;
  }
  return Buffer.from(normalized, "hex");
}

function findForbiddenOpcodes(bytecode) {
  const findings = [];
  for (let pc = 0; pc < bytecode.length; pc += 1) {
    const opcode = bytecode[pc];
    const opcodeName = forbiddenOpcodes.get(opcode);
    if (opcodeName !== undefined) {
      findings.push({ pc, opcode, opcodeName });
    }
    if (opcode >= 0x60 && opcode <= 0x7f) {
      pc += opcode - 0x5f;
    }
  }
  return findings;
}

function main() {
  if (!fs.existsSync(artifactsRoot)) {
    throw new Error(`Artifacts directory not found: ${artifactsRoot}. Run the USDB build first.`);
  }

  const artifactFiles = walk(artifactsRoot);
  const violations = [];

  for (const artifactFile of artifactFiles) {
    const artifact = JSON.parse(fs.readFileSync(artifactFile, "utf8"));
    const runtimeBytecode =
      decodeBytecode(artifact?.deployedBytecode?.object) ??
      decodeBytecode(artifact?.bytecode?.object);

    if (runtimeBytecode === null) {
      continue;
    }

    const findings = findForbiddenOpcodes(runtimeBytecode);
    if (findings.length === 0) {
      continue;
    }

    violations.push({
      file: path.relative(process.cwd(), artifactFile),
      contract: artifact.contractName ?? path.basename(artifactFile, ".json"),
      findings,
    });
  }

  if (violations.length === 0) {
    console.log(`USDB bytecode audit passed for ${artifactFiles.length} artifact files under ${path.relative(process.cwd(), artifactsRoot)}.`);
    return;
  }

  console.error("USDB bytecode audit failed. Forbidden opcodes detected:");
  for (const violation of violations) {
    console.error(`- ${violation.contract} (${violation.file})`);
    for (const finding of violation.findings) {
      console.error(`  - pc=0x${finding.pc.toString(16)} opcode=0x${finding.opcode.toString(16)} ${finding.opcodeName}`);
    }
  }
  process.exitCode = 1;
}

main();
