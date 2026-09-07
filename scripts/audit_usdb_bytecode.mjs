import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const forbiddenOpcodes = new Map([[0x49, "BLOBHASH"], [0x4a, "BLOBBASEFEE"], [0x5c, "TLOAD"], [0x5d, "TSTORE"], [0x5e, "MCOPY"]]);
export const requiredContracts = [
  "contracts/Acquired.sol/Acquired.json", "contracts/Committee.sol/SourceDaoCommittee.json",
  "contracts/Dao.sol/SourceDao.json", "contracts/DevToken.sol/DevToken.json",
  "contracts/Dividend.sol/DividendContract.json", "contracts/NormalToken.sol/NormalToken.json",
  "contracts/Project.sol/ProjectManagement.json", "contracts/TokenLockup.sol/SourceTokenLockup.json",
  "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json",
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "build-info" ? [] : walk(fullPath);
    return entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".dbg.json") ? [fullPath] : [];
  });
}

export function decodeRuntime(value) {
  const candidate = typeof value === "string" ? value : value?.object;
  if (typeof candidate !== "string") throw new Error("Missing deployed bytecode");
  const hex = candidate.replace(/^0x/, "");
  if (hex.length % 2 || !/^[\da-f]*$/i.test(hex)) throw new Error("Invalid or unlinked deployed bytecode");
  return Buffer.from(hex, "hex");
}

// Solidity appends a definite-length CBOR map and its two-byte length. Decode
// that map completely before excluding it; arbitrary trailing bytes remain code.
function metadataStart(bytes) {
  if (bytes.length < 3) return bytes.length;
  const length = bytes.readUInt16BE(bytes.length - 2);
  const start = bytes.length - 2 - length;
  if (start < 0 || bytes[start] >> 5 !== 5) return bytes.length;
  let cursor = start;
  const end = bytes.length - 2;
  function item(depth = 0) {
    if (depth > 16 || cursor >= end) throw new Error("Invalid CBOR");
    const byte = bytes[cursor++], major = byte >> 5, info = byte & 31;
    let size = info;
    if (info >= 24) {
      const width = { 24: 1, 25: 2, 26: 4 }[info];
      if (!width || cursor + width > end) throw new Error("Invalid CBOR size");
      size = bytes.readUIntBE(cursor, width); cursor += width;
    }
    if (major === 2 || major === 3) {
      if (cursor + size > end) throw new Error("Truncated CBOR");
      const result = major === 3 ? bytes.subarray(cursor, cursor + size).toString("utf8") : null;
      cursor += size; return result;
    }
    if (major === 4 || major === 5) {
      if (size > end - cursor) throw new Error("Invalid CBOR count");
      const keys = [];
      for (let i = 0; i < size; i++) {
        const key = item(depth + 1);
        if (major === 5) { keys.push(key); item(depth + 1); }
      }
      return keys;
    }
    if (major > 1) throw new Error("Unsupported CBOR");
    return null;
  }
  try {
    const keys = item();
    return cursor === end && Array.isArray(keys) && keys.includes("solc") ? start : bytes.length;
  } catch { return bytes.length; }
}

export function findForbiddenOpcodes(bytes) {
  const findings = [], end = metadataStart(bytes);
  for (let pc = 0; pc < end; pc++) {
    const opcode = bytes[pc], opcodeName = forbiddenOpcodes.get(opcode);
    if (opcodeName) findings.push({ pc, opcode, opcodeName });
    if (opcode >= 0x60 && opcode <= 0x7f) pc += opcode - 0x5f;
  }
  return findings;
}

export function auditArtifacts(root) {
  const files = walk(root), scanned = new Set(), violations = [];
  let empty = 0;
  for (const file of files) {
    const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!artifact.contractName || !artifact.sourceName || !Array.isArray(artifact.abi)) throw new Error(`Invalid artifact: ${file}`);
    const runtime = decodeRuntime(artifact.deployedBytecode);
    if (!runtime.length) { empty++; continue; }
    scanned.add(path.relative(root, file));
    const findings = findForbiddenOpcodes(runtime);
    if (findings.length) violations.push({ file, findings });
  }
  if (!scanned.size) throw new Error("No executable runtime bytecode was audited");
  for (const required of requiredContracts) {
    if (!scanned.has(required)) throw new Error(`Required runtime was not audited: ${required}`);
  }
  if (violations.length) throw new Error(`Forbidden opcodes detected: ${JSON.stringify(violations)}`);
  return { artifacts: files.length, scanned: scanned.size, empty };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = path.resolve(process.env.SOURCE_DAO_ARTIFACTS_DIR ?? "artifacts-usdb");
    const result = auditArtifacts(root);
    console.log(`USDB bytecode audit passed: ${result.scanned} runtimes scanned, ${result.empty} empty interfaces/abstract contracts, ${result.artifacts} artifact files.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
