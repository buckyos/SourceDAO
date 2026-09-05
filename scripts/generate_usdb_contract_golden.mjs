import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");
const artifactsRoot = path.resolve(
  repositoryRoot,
  process.env.SOURCE_DAO_ARTIFACTS_DIR ?? "artifacts-usdb",
);
const defaultOutputPath = path.join(
  repositoryRoot,
  "security/usdb-contract-golden.json",
);

const productionContracts = [
  ["contracts/Acquired.sol", "Acquired"],
  ["contracts/Committee.sol", "SourceDaoCommittee"],
  ["contracts/Dao.sol", "SourceDao"],
  ["contracts/DevToken.sol", "DevToken"],
  ["contracts/Dividend.sol", "DividendContract"],
  ["contracts/NormalToken.sol", "NormalToken"],
  ["contracts/Project.sol", "ProjectManagement"],
  ["contracts/TokenLockup.sol", "SourceTokenLockup"],
];

function parseArguments(argv) {
  let check = false;
  let outputPath = defaultOutputPath;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      check = true;
      continue;
    }
    if (argument === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--output requires a path");
      }
      outputPath = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  return { check, outputPath };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Json(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeBytecode(value, label) {
  const candidate =
    typeof value === "string"
      ? value
      : value !== null && typeof value === "object"
        ? value.object
        : null;
  if (typeof candidate !== "string") {
    throw new Error(`${label} is missing bytecode`);
  }
  const normalized = candidate.startsWith("0x") ? candidate.slice(2) : candidate;
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`${label} contains invalid or unlinked bytecode`);
  }
  return normalized.toLowerCase();
}

function findBuildInfo() {
  const buildInfoDirectory = path.join(artifactsRoot, "build-info");
  if (!fs.existsSync(buildInfoDirectory)) {
    throw new Error(`USDB build-info directory not found: ${buildInfoDirectory}`);
  }

  const inputFiles = fs
    .readdirSync(buildInfoDirectory)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".output.json"))
    .sort();
  if (inputFiles.length !== 1) {
    throw new Error(
      `expected exactly one clean USDB build-info input, found ${inputFiles.length}; run npm run build:usdb`,
    );
  }

  const inputPath = path.join(buildInfoDirectory, inputFiles[0]);
  const outputPath = inputPath.replace(/\.json$/, ".output.json");
  if (!fs.existsSync(outputPath)) {
    throw new Error(`USDB build-info output not found: ${outputPath}`);
  }
  return { inputPath, outputPath };
}

function buildGolden() {
  const { inputPath, outputPath } = findBuildInfo();
  const buildInput = readJson(inputPath);
  const buildOutput = readJson(outputPath);
  const settings = buildInput?.input?.settings;
  if (settings === null || typeof settings !== "object") {
    throw new Error("USDB build-info has no compiler settings");
  }

  const contracts = productionContracts.map(([sourceName, contractName]) => {
    const buildSourceName = `project/${sourceName}`;
    const compiled = buildOutput?.output?.contracts?.[buildSourceName]?.[contractName];
    if (compiled === undefined) {
      throw new Error(`USDB build-info is missing ${buildSourceName}:${contractName}`);
    }

    const artifactPath = path.join(artifactsRoot, sourceName, `${contractName}.json`);
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`USDB artifact is missing: ${artifactPath}`);
    }
    const artifactBytes = fs.readFileSync(artifactPath);
    const artifact = JSON.parse(artifactBytes.toString("utf8"));
    if (artifact.contractName !== contractName || artifact.sourceName !== sourceName) {
      throw new Error(`USDB artifact identity mismatch: ${artifactPath}`);
    }

    const creationBytecode = normalizeBytecode(artifact.bytecode, `${contractName} creation`);
    const runtimeBytecode = normalizeBytecode(artifact.deployedBytecode, `${contractName} runtime`);
    const creationBytes = Buffer.from(creationBytecode, "hex");
    const runtimeBytes = Buffer.from(runtimeBytecode, "hex");
    const abi = canonicalize(artifact.abi);
    const storageLayout = canonicalize(compiled.storageLayout);
    const methodIdentifiers = canonicalize(compiled?.evm?.methodIdentifiers ?? {});

    return {
      source_name: sourceName,
      contract_name: contractName,
      artifact_path: path.relative(repositoryRoot, artifactPath),
      artifact_sha256: sha256Bytes(artifactBytes),
      abi_sha256: sha256Json(abi),
      abi,
      method_identifiers_sha256: sha256Json(methodIdentifiers),
      method_identifiers: methodIdentifiers,
      creation_bytecode_sha256: sha256Bytes(creationBytes),
      creation_size_bytes: creationBytes.length,
      runtime_bytecode_keccak256: ethers.keccak256(`0x${runtimeBytecode}`),
      runtime_bytecode_sha256: sha256Bytes(runtimeBytes),
      runtime_size_bytes: runtimeBytes.length,
      storage_layout_sha256: sha256Json(storageLayout),
      storage_layout: storageLayout,
    };
  });

  return canonicalize({
    schema_version: "sourcedao-usdb-contract-golden:v1",
    build_profile: "usdb",
    compiler: {
      type: buildInput.compilerType,
      version: buildInput.solcVersion,
      long_version: buildInput.solcLongVersion,
      settings_sha256: sha256Json(settings),
      settings: canonicalize(settings),
    },
    contracts,
  });
}

function serializedGolden() {
  return `${JSON.stringify(buildGolden(), null, 2)}\n`;
}

function checkGolden(outputPath, expected) {
  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `USDB contract golden is missing: ${outputPath}. Run npm run generate:usdb:golden`,
    );
  }
  const actual = fs.readFileSync(outputPath, "utf8");
  if (actual !== expected) {
    throw new Error(
      `USDB contract golden differs from the current build: ${outputPath}. ` +
        "Review the ABI, bytecode, and storage change, then run npm run generate:usdb:golden",
    );
  }
  console.log(`USDB contract golden matches ${productionContracts.length} production contracts.`);
}

function writeGolden(outputPath, contents) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o644 });
    fs.renameSync(temporaryPath, outputPath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
  console.log(`Wrote USDB contract golden: ${path.relative(repositoryRoot, outputPath)}`);
}

function main() {
  const { check, outputPath } = parseArguments(process.argv.slice(2));
  const contents = serializedGolden();
  if (check) {
    checkGolden(outputPath, contents);
  } else {
    writeGolden(outputPath, contents);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
