import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

type CliOptions = {
  configPath: string;
  rpcUrl?: string;
  stateFilePath?: string;
  outputPath?: string;
  strict: boolean;
};

type ModuleValidationMode = "relaxed" | "strict";

type SourceDaoBootstrapConfig = {
  schemaVersion: number;
  chainId: number;
  rpcUrl: string;
  artifactsDir?: string;
  daoAddress: string;
  dividendAddress: string;
  bootstrapAdminAddress: string;
  cycleMinLength: number;
  outputPath?: string;
  expectedModules?: Partial<ExpectedModules>;
  committee?: {
    initialMembers?: string[];
    initProposalId?: number;
    initDevRatio?: number;
    mainProjectName?: string;
    finalVersion?: string;
    finalDevRatio?: number;
  };
  devToken?: {
    name?: string;
    symbol?: string;
    totalSupply?: string;
    initAddresses?: string[];
    initAmounts?: string[];
  };
  normalToken?: {
    name?: string;
    symbol?: string;
  };
  tokenLockup?: {
    unlockProjectName?: string;
    unlockVersion?: string;
  };
  project?: {
    initProjectIdCounter?: number;
  };
  acquired?: {
    initInvestmentCount?: number;
  };
};

type ExpectedModules = {
  committee: string;
  devToken: string;
  normalToken: string;
  lockup: string;
  project: string;
  dividend: string;
  acquired: string;
};

type ResolvedBootstrapConfig = {
  schemaVersion: number;
  chainId: number;
  rpcUrl: string;
  artifactsDir?: string;
  daoAddress: string;
  dividendAddress: string;
  bootstrapAdminAddress: string;
  cycleMinLength: number;
  outputPath?: string;
  expectedModules?: Partial<ExpectedModules>;
  committee: {
    initialMembers: string[];
    initProposalId: number;
    initDevRatio: number;
    mainProjectName: string;
    finalVersion: string;
    finalDevRatio: number;
  };
  devToken: {
    name: string;
    symbol: string;
    totalSupply: string;
    initAddresses: string[];
    initAmounts: string[];
  };
  normalToken: {
    name: string;
    symbol: string;
  };
  tokenLockup: {
    unlockProjectName: string;
    unlockVersion: string;
  };
  project: {
    initProjectIdCounter: number;
  };
  acquired: {
    initInvestmentCount: number;
  };
};

type HardhatArtifact = {
  abi: unknown[];
};

type BootstrapState = {
  status?: string;
  final_wiring?: Partial<{
    committee: string | null;
    dev_token: string | null;
    normal_token: string | null;
    token_lockup: string | null;
    project: string | null;
    dividend: string | null;
    acquired: string | null;
  }>;
};

type ValidationSummary = {
  status: "ok";
  generatedAt: string;
  chainId: number;
  rpcUrl: string;
  artifactsDir: string;
  mode: ModuleValidationMode;
  daoAddress: string;
  bootstrapAdmin: string;
  modules: Record<string, {
    address: string;
    version: string;
    expectedAddress: string | null;
  }>;
};

const DEFAULT_ARTIFACTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts-usdb",
);
const ZERO_ADDRESS = ethers.ZeroAddress;
const SOURCE_DAO_BOOTSTRAP_SCHEMA_VERSION = 1;
const MAX_UINT256 = (1n << 256n) - 1n;

function printHeader(title: string) {
  console.log(`\n=== ${title} ===`);
}

function parseCliOptions(argv: string[]): CliOptions {
  let configPath = process.env.SOURCE_DAO_USDB_CONFIG?.trim() || "";
  let rpcUrl = process.env.SOURCE_DAO_USDB_RPC_URL?.trim() || undefined;
  let stateFilePath = process.env.SOURCE_DAO_USDB_STATE_FILE?.trim() || undefined;
  let outputPath = process.env.SOURCE_DAO_BOOTSTRAP_VALIDATE_OUTPUT?.trim() || undefined;
  let strict = process.env.SOURCE_DAO_BOOTSTRAP_VALIDATE_STRICT === "1";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--config requires a file path");
      configPath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--rpc-url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--rpc-url requires a URL");
      rpcUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--state-file") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--state-file requires a path");
      stateFilePath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--output requires a path");
      outputPath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "--help") {
      console.log(
        "Usage: tsx scripts/usdb_validate_bootstrap.ts --config <file> [--rpc-url <url>] [--state-file <file>] [--output <file>] [--strict]",
      );
      process.exit(0);
    }
  }

  if (!configPath) {
    throw new Error("Missing --config <file> or SOURCE_DAO_USDB_CONFIG");
  }

  return { configPath, rpcUrl, stateFilePath, outputPath, strict };
}

async function loadJsonFile<T>(filePath: string): Promise<T> {
  const blob = await readFile(filePath, "utf8");
  return JSON.parse(blob) as T;
}

function assertPublicBootstrapConfig(config: unknown): asserts config is SourceDaoBootstrapConfig {
  if (config === null || typeof config !== "object") {
    throw new Error("SourceDAO bootstrap config must be a JSON object");
  }
  if ("bootstrapAdminPrivateKey" in config) {
    throw new Error("bootstrapAdminPrivateKey is forbidden in config");
  }
  if (!("bootstrapAdminAddress" in config)) {
    throw new Error("bootstrapAdminAddress is required in config");
  }
  const schemaVersion = (config as Record<string, unknown>).schemaVersion;
  if (schemaVersion !== SOURCE_DAO_BOOTSTRAP_SCHEMA_VERSION) {
    throw new Error(
      `unsupported SourceDAO bootstrap schemaVersion ${String(schemaVersion)}, ` +
      `expected ${SOURCE_DAO_BOOTSTRAP_SCHEMA_VERSION}`,
    );
  }
}

async function loadArtifact(artifactsDir: string, relativePath: string): Promise<HardhatArtifact> {
  return loadJsonFile<HardhatArtifact>(path.join(artifactsDir, relativePath));
}

function normalizeArtifactsDir(configPath: string, artifactsDir?: string) {
  if (!artifactsDir) return DEFAULT_ARTIFACTS_DIR;
  if (path.isAbsolute(artifactsDir)) return artifactsDir;
  return path.resolve(path.dirname(configPath), artifactsDir);
}

function requireNonEmptyString(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`Missing required bootstrap config field: ${field}`);
  return trimmed;
}

function ensureAddressList(values: string[], field: string): string[] {
  if (values.length === 0) throw new Error(`${field} must not be empty`);
  const normalized = values.map((value, index) =>
    ensureNonZeroAddress(value, `${field}[${index}]`),
  );
  const seen = new Set<string>();
  for (const [index, address] of normalized.entries()) {
    const key = address.toLowerCase();
    if (seen.has(key)) throw new Error(`${field}[${index}] duplicates address ${address}`);
    seen.add(key);
  }
  return normalized;
}

function parseBigIntString(value: string, field: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field} must be a canonical unsigned decimal string, have ${value}`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) throw new Error(`${field} exceeds uint256`);
  return parsed;
}

function convertVersion(version: string): number {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid version format: ${version}. Expected format is major.minor.patch`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch) ||
    minor >= 100_000 ||
    patch >= 100_000
  ) {
    throw new Error(`Invalid version range: ${version}`);
  }
  const encoded = major * 10_000_000_000 + minor * 100_000 + patch;
  if (!Number.isSafeInteger(encoded) || encoded <= 0) {
    throw new Error(`Encoded version must be a positive safe integer: ${version}`);
  }
  return encoded;
}

function ensureNonZeroAddress(value: string, field: string): string {
  const address = ethers.getAddress(requireNonEmptyString(value, field));
  if (sameAddress(address, ZERO_ADDRESS)) throw new Error(`${field} must not be the zero address`);
  return address;
}

function ensureSafeInteger(value: number, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field} must be a safe integer >= ${minimum}, have ${String(value)}`);
  }
  return value;
}

function requireSection<T>(value: T | undefined, field: string): T {
  if (value === undefined || value === null) {
    throw new Error(`${field} is required for full bootstrap validation`);
  }
  return value;
}

function resolveBootstrapConfig(config: SourceDaoBootstrapConfig): ResolvedBootstrapConfig {
  const committeeConfig = requireSection(config.committee, "committee");
  const committee = {
    initialMembers: ensureAddressList(
      requireSection(committeeConfig.initialMembers, "committee.initialMembers"),
      "committee.initialMembers",
    ),
    initProposalId: ensureSafeInteger(
      requireSection(committeeConfig.initProposalId, "committee.initProposalId"),
      "committee.initProposalId",
      1,
    ),
    initDevRatio: ensureSafeInteger(
      requireSection(committeeConfig.initDevRatio, "committee.initDevRatio"),
      "committee.initDevRatio",
      101,
    ),
    mainProjectName: requireNonEmptyString(
      committeeConfig.mainProjectName,
      "committee.mainProjectName",
    ),
    finalVersion: requireNonEmptyString(committeeConfig.finalVersion, "committee.finalVersion"),
    finalDevRatio: ensureSafeInteger(
      requireSection(committeeConfig.finalDevRatio, "committee.finalDevRatio"),
      "committee.finalDevRatio",
      101,
    ),
  };
  ethers.encodeBytes32String(committee.mainProjectName);
  convertVersion(committee.finalVersion);

  const devTokenConfig = requireSection(config.devToken, "devToken");
  const devToken = {
    name: requireNonEmptyString(devTokenConfig.name, "devToken.name"),
    symbol: requireNonEmptyString(devTokenConfig.symbol, "devToken.symbol"),
    totalSupply: requireNonEmptyString(devTokenConfig.totalSupply, "devToken.totalSupply"),
    initAddresses: ensureAddressList(
      requireSection(devTokenConfig.initAddresses, "devToken.initAddresses"),
      "devToken.initAddresses",
    ),
    initAmounts: requireSection(devTokenConfig.initAmounts, "devToken.initAmounts").map(
      (value, index) => requireNonEmptyString(value, `devToken.initAmounts[${index}]`),
    ),
  };
  if (devToken.initAddresses.length !== devToken.initAmounts.length) {
    throw new Error("devToken.initAddresses and devToken.initAmounts length mismatch");
  }
  const totalSupply = parseBigIntString(devToken.totalSupply, "devToken.totalSupply");
  if (totalSupply === 0n) throw new Error("devToken.totalSupply must be positive");
  const initialSupply = sumBigInts(devToken.initAmounts);
  if (initialSupply > totalSupply) {
    throw new Error(
      `devToken initial allocation ${initialSupply} exceeds totalSupply ${totalSupply}`,
    );
  }

  const normalTokenConfig = requireSection(config.normalToken, "normalToken");
  const normalToken = {
    name: requireNonEmptyString(normalTokenConfig.name, "normalToken.name"),
    symbol: requireNonEmptyString(normalTokenConfig.symbol, "normalToken.symbol"),
  };
  const tokenLockupConfig = requireSection(config.tokenLockup, "tokenLockup");
  const tokenLockup = {
    unlockProjectName: requireNonEmptyString(
      tokenLockupConfig.unlockProjectName,
      "tokenLockup.unlockProjectName",
    ),
    unlockVersion: requireNonEmptyString(
      tokenLockupConfig.unlockVersion,
      "tokenLockup.unlockVersion",
    ),
  };
  ethers.encodeBytes32String(tokenLockup.unlockProjectName);
  convertVersion(tokenLockup.unlockVersion);

  const projectConfig = requireSection(config.project, "project");
  const project = {
    initProjectIdCounter: ensureSafeInteger(
      requireSection(projectConfig.initProjectIdCounter, "project.initProjectIdCounter"),
      "project.initProjectIdCounter",
      0,
    ),
  };
  const acquiredConfig = requireSection(config.acquired, "acquired");
  const acquired = {
    initInvestmentCount: ensureSafeInteger(
      requireSection(acquiredConfig.initInvestmentCount, "acquired.initInvestmentCount"),
      "acquired.initInvestmentCount",
      0,
    ),
  };

  const chainId = ensureSafeInteger(config.chainId, "chainId", 1);
  const rpcUrl = requireNonEmptyString(config.rpcUrl, "rpcUrl");
  const daoAddress = ensureNonZeroAddress(config.daoAddress, "daoAddress");
  const dividendAddress = ensureNonZeroAddress(config.dividendAddress, "dividendAddress");
  const bootstrapAdminAddress = ensureNonZeroAddress(
    config.bootstrapAdminAddress,
    "bootstrapAdminAddress",
  );
  const uniqueSystemAddresses = new Set([
    daoAddress.toLowerCase(),
    dividendAddress.toLowerCase(),
    bootstrapAdminAddress.toLowerCase(),
  ]);
  if (uniqueSystemAddresses.size !== 3) {
    throw new Error("daoAddress, dividendAddress, and bootstrapAdminAddress must be distinct");
  }

  return {
    ...config,
    chainId,
    rpcUrl,
    daoAddress,
    dividendAddress,
    bootstrapAdminAddress,
    cycleMinLength: ensureSafeInteger(config.cycleMinLength, "cycleMinLength", 1),
    expectedModules: normalizeExpectedModules(config.expectedModules),
    committee,
    devToken,
    normalToken,
    tokenLockup,
    project,
    acquired,
  };
}

function normalizeExpectedModules(modules?: Partial<ExpectedModules>): Partial<ExpectedModules> | undefined {
  if (!modules) return undefined;
  const normalized: Partial<ExpectedModules> = {};
  for (const [key, value] of Object.entries(modules)) {
    if (value) {
      normalized[key as keyof ExpectedModules] = ethers.getAddress(value);
    }
  }
  return normalized;
}

async function loadExpectedModulesFromState(stateFilePath?: string): Promise<Partial<ExpectedModules>> {
  if (!stateFilePath) return {};
  const state = await loadJsonFile<BootstrapState>(stateFilePath);
  if (state.status && state.status !== "completed") {
    throw new Error(`bootstrap state file is not completed: ${state.status}`);
  }
  const wiring = state.final_wiring ?? {};
  return normalizeExpectedModules({
    committee: wiring.committee ?? undefined,
    devToken: wiring.dev_token ?? undefined,
    normalToken: wiring.normal_token ?? undefined,
    lockup: wiring.token_lockup ?? undefined,
    project: wiring.project ?? undefined,
    dividend: wiring.dividend ?? undefined,
    acquired: wiring.acquired ?? undefined,
  }) ?? {};
}

async function ensureCode(provider: ethers.JsonRpcProvider, address: string, label: string) {
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error(`${label} at ${address} has no deployed code`);
}

async function assertCallable<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  }
}

function sameAddress(left: string, right: string): boolean {
  return ethers.getAddress(left) === ethers.getAddress(right);
}

function assertAddressEqual(label: string, actual: string, expected: string) {
  if (!sameAddress(actual, expected)) {
    throw new Error(`${label} mismatch: have ${actual}, expected ${expected}`);
  }
}

function assertAddressListEqual(label: string, actual: string[], expected: string[]) {
  if (actual.length !== expected.length) {
    throw new Error(`${label} length mismatch: have ${actual.length}, expected ${expected.length}`);
  }
  actual.forEach((value, index) => assertAddressEqual(`${label}[${index}]`, value, expected[index]));
}

function assertStringEqual(label: string, actual: unknown, expected: string) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: have ${String(actual)}, expected ${expected}`);
  }
}

function assertHexEqual(label: string, actual: string, expected: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} mismatch: have ${actual}, expected ${expected}`);
  }
}

function asBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  throw new Error(`${label} returned a non-integer value`);
}

function assertBigIntEqual(label: string, actual: unknown, expected: bigint) {
  const actualValue = asBigInt(actual, label);
  if (actualValue !== expected) {
    throw new Error(`${label} mismatch: have ${actualValue}, expected ${expected}`);
  }
}

function assertBigIntAtLeast(label: string, actual: unknown, minimum: bigint) {
  const actualValue = asBigInt(actual, label);
  if (actualValue < minimum) {
    throw new Error(`${label} too small: have ${actualValue}, expected at least ${minimum}`);
  }
}

function sumBigInts(values: string[]): bigint {
  return values.reduce((total, value, index) => total + parseBigIntString(value, `devToken.initAmounts[${index}]`), 0n);
}

async function contractFromArtifact(
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  relativeArtifactPath: string,
  address: string,
): Promise<ethers.Contract> {
  const artifact = await loadArtifact(artifactsDir, relativeArtifactPath);
  return new ethers.Contract(address, artifact.abi as ethers.InterfaceAbi, provider);
}

async function readVersion(contract: ethers.Contract, label: string): Promise<string> {
  const version = await assertCallable(`${label}.version`, () => contract.version() as Promise<string>);
  if (!version.trim()) throw new Error(`${label}.version returned an empty string`);
  return version;
}

async function readDaoModuleAddress(
  dao: ethers.Contract,
  getterName: keyof ExpectedModules,
): Promise<string> {
  const getter = (dao as unknown as Record<string, ethers.BaseContractMethod>)[getterName];
  if (!getter) throw new Error(`DAO ABI missing getter: ${getterName}`);
  return ethers.getAddress((await assertCallable(`DAO.${getterName}`, () => getter())) as string);
}

async function assertDaoModuleRegistered(dao: ethers.Contract, moduleAddress: string, label: string) {
  const registered = await assertCallable(`DAO.isDAOContract(${label})`, () =>
    dao.isDAOContract(moduleAddress) as Promise<boolean>,
  );
  if (!registered) {
    throw new Error(`DAO.isDAOContract returned false for ${label} at ${moduleAddress}`);
  }
}

async function validateCommittee(
  address: string,
  mode: ModuleValidationMode,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  config: ResolvedBootstrapConfig,
): Promise<string> {
  await ensureCode(provider, address, "Committee");
  const committee = await contractFromArtifact(provider, artifactsDir, "contracts/Committee.sol/SourceDaoCommittee.json", address);
  const version = await readVersion(committee, "Committee");
  const members = Array.from(await assertCallable("Committee.members", () => committee.members() as Promise<string[]>));
  if (members.length === 0) throw new Error("Committee.members returned an empty list");
  if (mode === "strict") assertAddressListEqual("Committee.members", members, config.committee.initialMembers);
  const firstMemberActive = await assertCallable("Committee.isMember", () =>
    committee.isMember(members[0]) as Promise<boolean>,
  );
  if (!firstMemberActive) throw new Error(`Committee.isMember(${members[0]}) returned false`);
  const proposalCursor = await assertCallable("Committee.proposalCursor", () =>
    committee.proposalCursor() as Promise<bigint>,
  );
  if (mode === "strict") {
    assertBigIntEqual(
      "Committee.proposalCursor",
      proposalCursor,
      BigInt(config.committee.initProposalId),
    );
  } else {
    assertBigIntAtLeast(
      "Committee.proposalCursor",
      proposalCursor,
      BigInt(config.committee.initProposalId),
    );
  }
  assertHexEqual(
    "Committee.mainProjectName",
    await assertCallable("Committee.mainProjectName", () => committee.mainProjectName() as Promise<string>),
    ethers.encodeBytes32String(config.committee.mainProjectName),
  );
  assertBigIntEqual(
    "Committee.finalVersion",
    await assertCallable("Committee.finalVersion", () => committee.finalVersion() as Promise<bigint>),
    BigInt(convertVersion(config.committee.finalVersion)),
  );
  assertBigIntEqual(
    "Committee.finalRatio",
    await assertCallable("Committee.finalRatio", () => committee.finalRatio() as Promise<bigint>),
    BigInt(config.committee.finalDevRatio),
  );
  const devRatio = await assertCallable("Committee.devRatio", () => committee.devRatio() as Promise<bigint>);
  if (mode === "strict") {
    assertBigIntEqual("Committee.devRatio", devRatio, BigInt(config.committee.initDevRatio));
  } else {
    assertBigIntAtLeast("Committee.devRatio", devRatio, BigInt(config.committee.finalDevRatio));
  }
  return version;
}

async function validateDevToken(
  address: string,
  mode: ModuleValidationMode,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  config: ResolvedBootstrapConfig,
): Promise<string> {
  await ensureCode(provider, address, "DevToken");
  const token = await contractFromArtifact(provider, artifactsDir, "contracts/DevToken.sol/DevToken.json", address);
  const version = await readVersion(token, "DevToken");
  assertStringEqual("DevToken.name", await assertCallable("DevToken.name", () => token.name() as Promise<string>), config.devToken.name);
  assertStringEqual("DevToken.symbol", await assertCallable("DevToken.symbol", () => token.symbol() as Promise<string>), config.devToken.symbol);
  const totalSupply = await assertCallable("DevToken.totalSupply", () => token.totalSupply() as Promise<bigint>);
  const totalReleased = await assertCallable("DevToken.totalReleased", () => token.totalReleased() as Promise<bigint>);
  if (mode === "strict") {
    assertBigIntEqual("DevToken.totalSupply", totalSupply, parseBigIntString(config.devToken.totalSupply, "devToken.totalSupply"));
    assertBigIntEqual("DevToken.totalReleased", totalReleased, sumBigInts(config.devToken.initAmounts));
  } else {
    assertBigIntAtLeast("DevToken.totalSupply", totalSupply, 1n);
    if (asBigInt(totalReleased, "DevToken.totalReleased") > asBigInt(totalSupply, "DevToken.totalSupply")) {
      throw new Error("DevToken.totalReleased exceeds totalSupply");
    }
  }
  return version;
}

async function validateNormalToken(
  address: string,
  mode: ModuleValidationMode,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  config: ResolvedBootstrapConfig,
): Promise<string> {
  await ensureCode(provider, address, "NormalToken");
  const token = await contractFromArtifact(provider, artifactsDir, "contracts/NormalToken.sol/NormalToken.json", address);
  const version = await readVersion(token, "NormalToken");
  assertStringEqual("NormalToken.name", await assertCallable("NormalToken.name", () => token.name() as Promise<string>), config.normalToken.name);
  assertStringEqual("NormalToken.symbol", await assertCallable("NormalToken.symbol", () => token.symbol() as Promise<string>), config.normalToken.symbol);
  const totalSupply = await assertCallable("NormalToken.totalSupply", () => token.totalSupply() as Promise<bigint>);
  if (mode === "strict") assertBigIntEqual("NormalToken.totalSupply", totalSupply, 0n);
  return version;
}

async function validateTokenLockup(
  address: string,
  mode: ModuleValidationMode,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  config: ResolvedBootstrapConfig,
): Promise<string> {
  await ensureCode(provider, address, "TokenLockup");
  const lockup = await contractFromArtifact(provider, artifactsDir, "contracts/TokenLockup.sol/SourceTokenLockup.json", address);
  const version = await readVersion(lockup, "TokenLockup");
  assertHexEqual(
    "TokenLockup.unlockProjectName",
    await assertCallable("TokenLockup.unlockProjectName", () => lockup.unlockProjectName() as Promise<string>),
    ethers.encodeBytes32String(config.tokenLockup.unlockProjectName),
  );
  assertBigIntEqual(
    "TokenLockup.unlockProjectVersion",
    await assertCallable("TokenLockup.unlockProjectVersion", () => lockup.unlockProjectVersion() as Promise<bigint>),
    BigInt(convertVersion(config.tokenLockup.unlockVersion)),
  );
  const totalAssigned = await assertCallable("TokenLockup.totalAssigned", () =>
    lockup.totalAssigned(ZERO_ADDRESS) as Promise<bigint>,
  );
  if (mode === "strict") assertBigIntEqual("TokenLockup.totalAssigned(address(0))", totalAssigned, 0n);
  await assertCallable("TokenLockup.totalClaimed", () => lockup.totalClaimed(ZERO_ADDRESS) as Promise<bigint>);
  return version;
}

async function validateProject(
  address: string,
  mode: ModuleValidationMode,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  config: ResolvedBootstrapConfig,
): Promise<string> {
  await ensureCode(provider, address, "Project");
  const project = await contractFromArtifact(provider, artifactsDir, "contracts/Project.sol/ProjectManagement.json", address);
  const version = await readVersion(project, "Project");
  const counter = await assertCallable("Project.projectIdCounter", () => project.projectIdCounter() as Promise<bigint>);
  const expectedCounter = BigInt(config.project.initProjectIdCounter);
  if (mode === "strict") {
    assertBigIntEqual("Project.projectIdCounter", counter, expectedCounter);
  } else {
    assertBigIntAtLeast("Project.projectIdCounter", counter, expectedCounter);
  }
  await assertCallable("Project.versionReleasedTime", () =>
    project.versionReleasedTime(
      ethers.encodeBytes32String(config.committee.mainProjectName),
      BigInt(convertVersion(config.committee.finalVersion)),
    ) as Promise<bigint>,
  );
  await assertCallable("Project.latestProjectVersion", () =>
    project.latestProjectVersion(ethers.encodeBytes32String(config.committee.mainProjectName)) as Promise<unknown>,
  );
  return version;
}

async function validateDividend(
  address: string,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  config: ResolvedBootstrapConfig,
): Promise<string> {
  await ensureCode(provider, address, "Dividend");
  const dividend = await contractFromArtifact(provider, artifactsDir, "contracts/Dividend.sol/DividendContract.json", address);
  const version = await readVersion(dividend, "Dividend");
  assertBigIntEqual(
    "Dividend.cycleMinLength",
    await assertCallable("Dividend.cycleMinLength", () => dividend.cycleMinLength() as Promise<bigint>),
    BigInt(config.cycleMinLength),
  );
  await assertCallable("Dividend.getCurrentCycleIndex", () => dividend.getCurrentCycleIndex() as Promise<bigint>);
  await assertCallable("Dividend.getCurrentCycle", () => dividend.getCurrentCycle() as Promise<unknown>);
  const bootstrapFinalized = await assertCallable(
    "Dividend.bootstrapFinalized",
    () => dividend.bootstrapFinalized() as Promise<boolean>,
  );
  if (!bootstrapFinalized) {
    throw new Error("Dividend bootstrap readiness marker is not finalized");
  }
  return version;
}

async function validateAcquired(
  address: string,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  config: ResolvedBootstrapConfig,
  probeAddress: string,
): Promise<string> {
  await ensureCode(provider, address, "Acquired");
  const acquired = await contractFromArtifact(provider, artifactsDir, "contracts/Acquired.sol/Acquired.json", address);
  const version = await readVersion(acquired, "Acquired");
  const investmentId = BigInt(config.acquired.initInvestmentCount);
  await assertCallable("Acquired.getInvestmentInfo", () => acquired.getInvestmentInfo(investmentId) as Promise<unknown>);
  await assertCallable("Acquired.getAddressInvestedAmount", () =>
    acquired.getAddressInvestedAmount(investmentId, probeAddress) as Promise<bigint>,
  );
  await assertCallable("Acquired.getAddressPercent", () =>
    acquired.getAddressPercent(investmentId, probeAddress) as Promise<bigint>,
  );
  return version;
}

async function writeOutput(outputPath: string | undefined, summary: ValidationSummary) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`Wrote bootstrap validation summary: ${outputPath}`);
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const sourceConfig = await loadJsonFile<unknown>(options.configPath);
  assertPublicBootstrapConfig(sourceConfig);
  const config = resolveBootstrapConfig(sourceConfig);
  const artifactsDir = normalizeArtifactsDir(options.configPath, config.artifactsDir);
  const rpcUrl = options.rpcUrl || config.rpcUrl;
  const outputPath = options.outputPath ?? config.outputPath;
  const mode: ModuleValidationMode = options.strict ? "strict" : "relaxed";

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== config.chainId) {
    throw new Error(`unexpected chainId ${chainId}, expected ${config.chainId}`);
  }

  const dao = await contractFromArtifact(provider, artifactsDir, "contracts/Dao.sol/SourceDao.json", config.daoAddress);
  const expectedFromState = await loadExpectedModulesFromState(options.stateFilePath);
  const expectedModules = {
    ...config.expectedModules,
    ...expectedFromState,
    dividend: expectedFromState.dividend ?? config.expectedModules?.dividend ?? config.dividendAddress,
  };

  printHeader("Bootstrap validation config");
  console.log(`RPC URL            ${rpcUrl}`);
  console.log(`Chain ID           ${config.chainId}`);
  console.log(`Artifacts dir      ${artifactsDir}`);
  console.log(`Mode               ${mode}`);
  console.log(`DAO                ${config.daoAddress}`);

  printHeader("DAO checks");
  await ensureCode(provider, config.daoAddress, "DAO");
  const daoVersion = await readVersion(dao, "DAO");
  const bootstrapAdmin = ethers.getAddress(await assertCallable("DAO.bootstrapAdmin", () => dao.bootstrapAdmin() as Promise<string>));
  if (sameAddress(bootstrapAdmin, ZERO_ADDRESS)) {
    throw new Error("DAO.bootstrapAdmin is still zero; bootstrap is not initialized");
  }
  assertAddressEqual("DAO.bootstrapAdmin", bootstrapAdmin, config.bootstrapAdminAddress);
  console.log(`DAO.version        ${daoVersion}`);
  console.log(`Bootstrap admin    ${bootstrapAdmin}`);

  const addresses: ExpectedModules = {
    committee: await readDaoModuleAddress(dao, "committee"),
    devToken: await readDaoModuleAddress(dao, "devToken"),
    normalToken: await readDaoModuleAddress(dao, "normalToken"),
    lockup: await readDaoModuleAddress(dao, "lockup"),
    project: await readDaoModuleAddress(dao, "project"),
    dividend: await readDaoModuleAddress(dao, "dividend"),
    acquired: await readDaoModuleAddress(dao, "acquired"),
  };

  const probeAddress = config.committee.initialMembers[0] ?? bootstrapAdmin;
  const summary: ValidationSummary = {
    status: "ok",
    generatedAt: new Date().toISOString(),
    chainId,
    rpcUrl,
    artifactsDir,
    mode,
    daoAddress: config.daoAddress,
    bootstrapAdmin,
    modules: {},
  };

  const validateModuleAddress = async (
    key: keyof ExpectedModules,
    label: string,
    validate: (address: string) => Promise<string>,
  ) => {
    const address = addresses[key];
    if (sameAddress(address, ZERO_ADDRESS)) {
      throw new Error(`DAO.${key} is still zero`);
    }
    const expectedAddress = expectedModules[key] ?? null;
    if (expectedAddress) {
      assertAddressEqual(`DAO.${key}`, address, expectedAddress);
    }
    await assertDaoModuleRegistered(dao, address, label);
    const version = await validate(address);
    summary.modules[key] = { address, version, expectedAddress };
    console.log(`${label.padEnd(14)} ${address} version=${version}`);
  };

  printHeader("Module checks");
  await validateModuleAddress("committee", "Committee", (address) =>
    validateCommittee(address, mode, provider, artifactsDir, config),
  );
  await validateModuleAddress("devToken", "DevToken", (address) =>
    validateDevToken(address, mode, provider, artifactsDir, config),
  );
  await validateModuleAddress("normalToken", "NormalToken", (address) =>
    validateNormalToken(address, mode, provider, artifactsDir, config),
  );
  await validateModuleAddress("lockup", "TokenLockup", (address) =>
    validateTokenLockup(address, mode, provider, artifactsDir, config),
  );
  await validateModuleAddress("project", "Project", (address) =>
    validateProject(address, mode, provider, artifactsDir, config),
  );
  await validateModuleAddress("dividend", "Dividend", (address) =>
    validateDividend(address, provider, artifactsDir, config),
  );
  await validateModuleAddress("acquired", "Acquired", (address) =>
    validateAcquired(address, provider, artifactsDir, config, probeAddress),
  );

  printHeader("Bootstrap validation summary");
  console.log("SourceDAO bootstrap validation succeeded.");
  await writeOutput(outputPath, summary);
}

main().catch((error) => {
  console.error("\nSourceDAO bootstrap validation failed.");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
