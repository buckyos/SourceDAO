import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

type CliOptions = {
  configPath: string;
  rpcUrl?: string;
  stateFilePath?: string;
  repoDir?: string;
};

type SourceDaoBootstrapConfig = {
  schemaVersion: number;
  chainId: number;
  rpcUrl: string;
  artifactsDir?: string;
  daoAddress: string;
  dividendAddress: string;
  bootstrapAdminAddress: string;
  cycleMinLength: number;
  transactionGasLimit?: number;
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
  committee?: {
    initialMembers?: string[];
    initProposalId?: number;
    initDevRatio?: number;
    mainProjectName?: string;
    finalVersion?: string;
    finalDevRatio?: number;
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

type HardhatArtifact = {
  abi: unknown[];
  bytecode: string;
};

type BootstrapOperation = {
  name: string;
  status: "completed" | "skipped" | "error";
  tx_hash?: string;
  block_number?: number;
  details?: string;
  error?: string;
};

type ModuleRecord = {
  address: string;
  source: "existing" | "deployed";
  implementation_address?: string;
  proxy_tx_hash?: string;
  proxy_block_number?: number;
  implementation_tx_hash?: string;
  implementation_block_number?: number;
  wiring_tx_hash?: string;
  wiring_block_number?: number;
};

type ModuleName =
  | "committee"
  | "dev_token"
  | "normal_token"
  | "token_lockup"
  | "project"
  | "acquired";

type BootstrapModules = {
  committee: ModuleRecord | null;
  dev_token: ModuleRecord | null;
  normal_token: ModuleRecord | null;
  token_lockup: ModuleRecord | null;
  project: ModuleRecord | null;
  acquired: ModuleRecord | null;
};

type ModuleValidationMode = "existing" | "deployed";

type BootstrapState = {
  state_version: string;
  generated_at: string;
  completed_at: string | null;
  status: "running" | "completed" | "error";
  scope: string;
  message: string;
  current_step: string | null;
  last_error: string | null;
  rpc_url: string;
  repo_dir: string | null;
  config_path: string;
  artifacts_dir: string;
  chain_id: number;
  dao_address: string;
  dividend_address: string;
  bootstrap_admin: string;
  warnings: string[];
  operations: BootstrapOperation[];
  final_wiring: {
    committee: string | null;
    dev_token: string | null;
    normal_token: string | null;
    token_lockup: string | null;
    project: string | null;
    dividend: string | null;
    acquired: string | null;
  };
  modules: BootstrapModules;
};

const DEFAULT_CONFIG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tools/config/sourcedao-bootstrap-full.example.json",
);
const DEFAULT_ARTIFACTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts-usdb",
);
const DEFAULT_TRANSACTION_GAS_LIMIT = 8_000_000n;
const SOURCE_DAO_BOOTSTRAP_SCHEMA_VERSION = 1;
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO_ADDRESS = ethers.ZeroAddress;

type BootstrapRuntimeContext = {
  options: CliOptions;
  config: ResolvedBootstrapConfig;
  artifactsDir: string;
  rpcUrl: string;
  walletAddress: string;
  operations: BootstrapOperation[];
  modules: BootstrapModules;
  currentStep: string | null;
};

let latestRuntimeContext: BootstrapRuntimeContext | null = null;

function printHeader(title: string) {
  console.log(`\n=== ${title} ===`);
}

function createEmptyModules(): BootstrapModules {
  return {
    committee: null,
    dev_token: null,
    normal_token: null,
    token_lockup: null,
    project: null,
    acquired: null,
  };
}

function moduleAddress(modules: BootstrapModules, key: ModuleName): string | null {
  return modules[key]?.address ?? null;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeBootstrapStateSnapshot(
  context: BootstrapRuntimeContext,
  status: BootstrapState["status"],
  message: string,
  lastError: string | null = null,
) {
  const { options, config, artifactsDir, rpcUrl, walletAddress, operations, modules, currentStep } = context;
  if (!options.stateFilePath) {
    return;
  }

  const completedAt = status === "completed" ? new Date().toISOString() : null;
  const state: BootstrapState = {
    state_version: "1",
    generated_at: new Date().toISOString(),
    completed_at: completedAt,
    status,
    scope: "full",
    message,
    current_step: currentStep,
    last_error: lastError,
    rpc_url: rpcUrl,
    repo_dir: options.repoDir ?? null,
    config_path: options.configPath,
    artifacts_dir: artifactsDir,
    chain_id: config.chainId,
    dao_address: config.daoAddress,
    dividend_address: config.dividendAddress,
    bootstrap_admin: walletAddress,
    warnings: config.warnings,
    operations,
    final_wiring: {
      committee: moduleAddress(modules, "committee"),
      dev_token: moduleAddress(modules, "dev_token"),
      normal_token: moduleAddress(modules, "normal_token"),
      token_lockup: moduleAddress(modules, "token_lockup"),
      project: moduleAddress(modules, "project"),
      dividend: config.dividendAddress,
      acquired: moduleAddress(modules, "acquired"),
    },
    modules,
  };

  await writeFile(options.stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function updateProgress(
  context: BootstrapRuntimeContext,
  message: string,
  currentStep: string | null,
) {
  context.currentStep = currentStep;
  latestRuntimeContext = context;
  await writeBootstrapStateSnapshot(context, "running", message);
}

function parseCliOptions(argv: string[]): CliOptions {
  let configPath = process.env.SOURCE_DAO_USDB_CONFIG?.trim() || DEFAULT_CONFIG_PATH;
  let rpcUrl = process.env.SOURCE_DAO_USDB_RPC_URL?.trim() || undefined;
  let stateFilePath = process.env.SOURCE_DAO_USDB_STATE_FILE?.trim() || undefined;
  let repoDir = process.env.SOURCE_DAO_REPO_DIR?.trim() || undefined;

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
    if (arg === "--repo-dir") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--repo-dir requires a path");
      repoDir = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--help") {
      console.log(
        "Usage: tsx scripts/usdb_bootstrap_full.ts --config <file> [--rpc-url <url>] [--state-file <file>] [--repo-dir <dir>]",
      );
      process.exit(0);
    }
  }

  return { configPath, rpcUrl, stateFilePath, repoDir };
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
    throw new Error(
      "bootstrapAdminPrivateKey is forbidden in config; inject SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY at runtime",
    );
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

function gasLimit(config: SourceDaoBootstrapConfig): bigint {
  return BigInt(config.transactionGasLimit ?? Number(DEFAULT_TRANSACTION_GAS_LIMIT));
}

function requireNonEmptyString(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required bootstrap config field: ${field}`);
  }
  return trimmed;
}

function parseBigIntString(value: string, field: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field} must be a canonical unsigned decimal string, have ${value}`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) {
    throw new Error(`${field} exceeds uint256`);
  }
  return parsed;
}

function ensureAddressList(values: string[], field: string): string[] {
  if (values.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  const normalized = values.map((value, index) =>
    ensureNonZeroAddress(value, `${field}[${index}]`),
  );
  const seen = new Set<string>();
  for (const [index, address] of normalized.entries()) {
    const key = address.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`${field}[${index}] duplicates address ${address}`);
    }
    seen.add(key);
  }
  return normalized;
}

function ensureBigIntList(values: string[], field: string): bigint[] {
  if (values.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  return values.map((value, index) => parseBigIntString(requireNonEmptyString(value, `${field}[${index}]`), `${field}[${index}]`));
}

function ensureNonZeroAddress(value: string, field: string): string {
  const address = ethers.getAddress(requireNonEmptyString(value, field));
  if (sameAddress(address, ZERO_ADDRESS)) {
    throw new Error(`${field} must not be the zero address`);
  }
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
    throw new Error(`${field} is required for full bootstrap`);
  }
  return value;
}

function ensureDistinctAddresses(entries: Array<[string, string]>) {
  const seen = new Map<string, string>();
  for (const [field, address] of entries) {
    const key = address.toLowerCase();
    const previous = seen.get(key);
    if (previous) {
      throw new Error(`${field} conflicts with ${previous}: ${address}`);
    }
    seen.set(key, field);
  }
}

type ResolvedBootstrapConfig = {
  schemaVersion: number;
  chainId: number;
  rpcUrl: string;
  artifactsDir?: string;
  daoAddress: string;
  dividendAddress: string;
  bootstrapAdminAddress: string;
  cycleMinLength: number;
  transactionGasLimit?: number;
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
  warnings: string[];
};

function resolveBootstrapConfig(config: SourceDaoBootstrapConfig): ResolvedBootstrapConfig {
  const chainId = ensureSafeInteger(config.chainId, "chainId", 1);
  const rpcUrl = requireNonEmptyString(config.rpcUrl, "rpcUrl");
  const daoAddress = ensureNonZeroAddress(config.daoAddress, "daoAddress");
  const dividendAddress = ensureNonZeroAddress(config.dividendAddress, "dividendAddress");
  const bootstrapAdminAddress = ensureNonZeroAddress(
    config.bootstrapAdminAddress,
    "bootstrapAdminAddress",
  );
  ensureDistinctAddresses([
    ["daoAddress", daoAddress],
    ["dividendAddress", dividendAddress],
    ["bootstrapAdminAddress", bootstrapAdminAddress],
  ]);
  const cycleMinLength = ensureSafeInteger(config.cycleMinLength, "cycleMinLength", 1);
  if (config.transactionGasLimit !== undefined) {
    ensureSafeInteger(config.transactionGasLimit, "transactionGasLimit", 1);
  }

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
    finalVersion: requireNonEmptyString(
      committeeConfig.finalVersion,
      "committee.finalVersion",
    ),
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
  if (totalSupply === 0n) {
    throw new Error("devToken.totalSupply must be positive");
  }
  const initialSupply = sumBigInts(
    devToken.initAmounts.map((value, index) =>
      parseBigIntString(value, `devToken.initAmounts[${index}]`),
    ),
  );
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

  return {
    ...config,
    chainId,
    rpcUrl,
    daoAddress,
    dividendAddress,
    bootstrapAdminAddress,
    cycleMinLength,
    committee,
    devToken,
    normalToken,
    tokenLockup,
    project,
    acquired,
    warnings: [],
  };
}

async function ensureCode(provider: ethers.JsonRpcProvider, address: string, label: string) {
  const code = await provider.getCode(address);
  if (code === "0x") {
    throw new Error(`${label} at ${address} has no deployed code`);
  }
}

async function assertCallable<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new Error(`${label} failed: ${formatUnknownError(error)}`);
  }
}

function asBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  throw new Error(`${label} returned a non-integer value`);
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

  actual.forEach((actualAddress, index) => {
    assertAddressEqual(`${label}[${index}]`, actualAddress, expected[index]);
  });
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

function sumBigInts(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

async function contractFromArtifact(
  wallet: ethers.Wallet,
  artifactsDir: string,
  relativeArtifactPath: string,
  address: string,
): Promise<ethers.Contract> {
  const artifact = await loadArtifact(artifactsDir, relativeArtifactPath);
  return new ethers.Contract(address, artifact.abi as ethers.InterfaceAbi, wallet);
}

async function validateReadableVersion(contract: ethers.Contract, label: string) {
  const version = await assertCallable(`${label}.version`, () => contract.version() as Promise<string>);
  if (!version.trim()) {
    throw new Error(`${label}.version returned an empty string`);
  }
}

async function validateDaoContract(dao: ethers.Contract, expectedBootstrapAdmin: string) {
  await validateReadableVersion(dao, "DAO");
  const bootstrapAdmin = await assertCallable("DAO.bootstrapAdmin", () =>
    dao.bootstrapAdmin() as Promise<string>,
  );
  assertAddressEqual("DAO.bootstrapAdmin", bootstrapAdmin, expectedBootstrapAdmin);
}

async function validateDividendModule(
  address: string,
  wallet: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  config: ResolvedBootstrapConfig,
) {
  await ensureCode(provider, address, "Dividend");
  const dividend = await contractFromArtifact(
    wallet,
    artifactsDir,
    "contracts/Dividend.sol/DividendContract.json",
    address,
  );
  await validateReadableVersion(dividend, "Dividend");
  assertBigIntEqual(
    "Dividend.cycleMinLength",
    await assertCallable("Dividend.cycleMinLength", () => dividend.cycleMinLength() as Promise<bigint>),
    BigInt(config.cycleMinLength),
  );
  await assertCallable("Dividend.getCurrentCycleIndex", () =>
    dividend.getCurrentCycleIndex() as Promise<bigint>,
  );
  await assertCallable("Dividend.getCurrentCycle", () => dividend.getCurrentCycle());
}

async function validateCommitteeModule(
  address: string,
  mode: ModuleValidationMode,
  wallet: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  expected: {
    members: string[];
    initProposalId: bigint;
    initDevRatio: bigint;
    mainProjectName: string;
    finalVersion: bigint;
    finalDevRatio: bigint;
  },
) {
  await ensureCode(provider, address, "Committee");
  const committee = await contractFromArtifact(
    wallet,
    artifactsDir,
    "contracts/Committee.sol/SourceDaoCommittee.json",
    address,
  );
  await validateReadableVersion(committee, "Committee");

  const members = Array.from(
    await assertCallable("Committee.members", () => committee.members() as Promise<string[]>),
  );
  if (members.length === 0) {
    throw new Error("Committee.members returned an empty list");
  }
  if (mode === "deployed") {
    assertAddressListEqual("Committee.members", members, expected.members);
  }

  const firstMemberActive = await assertCallable("Committee.isMember", () =>
    committee.isMember(members[0]) as Promise<boolean>,
  );
  if (!firstMemberActive) {
    throw new Error(`Committee.isMember(${members[0]}) returned false`);
  }

  const proposalCursor = await assertCallable("Committee.proposalCursor", () =>
    committee.proposalCursor() as Promise<bigint>,
  );
  if (mode === "deployed") {
    assertBigIntEqual("Committee.proposalCursor", proposalCursor, expected.initProposalId);
  } else {
    assertBigIntAtLeast("Committee.proposalCursor", proposalCursor, expected.initProposalId);
  }

  assertHexEqual(
    "Committee.mainProjectName",
    await assertCallable("Committee.mainProjectName", () => committee.mainProjectName() as Promise<string>),
    expected.mainProjectName,
  );
  assertBigIntEqual(
    "Committee.finalVersion",
    await assertCallable("Committee.finalVersion", () => committee.finalVersion() as Promise<bigint>),
    expected.finalVersion,
  );
  assertBigIntEqual(
    "Committee.finalRatio",
    await assertCallable("Committee.finalRatio", () => committee.finalRatio() as Promise<bigint>),
    expected.finalDevRatio,
  );

  const devRatio = await assertCallable("Committee.devRatio", () =>
    committee.devRatio() as Promise<bigint>,
  );
  if (mode === "deployed") {
    assertBigIntEqual("Committee.devRatio", devRatio, expected.initDevRatio);
  } else {
    assertBigIntAtLeast("Committee.devRatio", devRatio, expected.finalDevRatio);
  }
}

async function validateDevTokenModule(
  address: string,
  mode: ModuleValidationMode,
  wallet: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  expected: {
    name: string;
    symbol: string;
    totalSupply: bigint;
    initialReleased: bigint;
  },
) {
  await ensureCode(provider, address, "DevToken");
  const token = await contractFromArtifact(wallet, artifactsDir, "contracts/DevToken.sol/DevToken.json", address);
  await validateReadableVersion(token, "DevToken");
  assertStringEqual("DevToken.name", await assertCallable("DevToken.name", () => token.name() as Promise<string>), expected.name);
  assertStringEqual(
    "DevToken.symbol",
    await assertCallable("DevToken.symbol", () => token.symbol() as Promise<string>),
    expected.symbol,
  );

  const totalSupply = await assertCallable("DevToken.totalSupply", () =>
    token.totalSupply() as Promise<bigint>,
  );
  const totalReleased = await assertCallable("DevToken.totalReleased", () =>
    token.totalReleased() as Promise<bigint>,
  );
  if (mode === "deployed") {
    assertBigIntEqual("DevToken.totalSupply", totalSupply, expected.totalSupply);
    assertBigIntEqual("DevToken.totalReleased", totalReleased, expected.initialReleased);
  } else {
    assertBigIntAtLeast("DevToken.totalSupply", totalSupply, 1n);
    if (asBigInt(totalReleased, "DevToken.totalReleased") > asBigInt(totalSupply, "DevToken.totalSupply")) {
      throw new Error("DevToken.totalReleased exceeds totalSupply");
    }
  }
}

async function validateNormalTokenModule(
  address: string,
  mode: ModuleValidationMode,
  wallet: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  expected: {
    name: string;
    symbol: string;
  },
) {
  await ensureCode(provider, address, "NormalToken");
  const token = await contractFromArtifact(
    wallet,
    artifactsDir,
    "contracts/NormalToken.sol/NormalToken.json",
    address,
  );
  await validateReadableVersion(token, "NormalToken");
  assertStringEqual(
    "NormalToken.name",
    await assertCallable("NormalToken.name", () => token.name() as Promise<string>),
    expected.name,
  );
  assertStringEqual(
    "NormalToken.symbol",
    await assertCallable("NormalToken.symbol", () => token.symbol() as Promise<string>),
    expected.symbol,
  );
  const totalSupply = await assertCallable("NormalToken.totalSupply", () =>
    token.totalSupply() as Promise<bigint>,
  );
  if (mode === "deployed") {
    assertBigIntEqual("NormalToken.totalSupply", totalSupply, 0n);
  }
}

async function validateTokenLockupModule(
  address: string,
  mode: ModuleValidationMode,
  wallet: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  expected: {
    unlockProjectName: string;
    unlockProjectVersion: bigint;
  },
) {
  await ensureCode(provider, address, "TokenLockup");
  const lockup = await contractFromArtifact(
    wallet,
    artifactsDir,
    "contracts/TokenLockup.sol/SourceTokenLockup.json",
    address,
  );
  await validateReadableVersion(lockup, "TokenLockup");
  assertHexEqual(
    "TokenLockup.unlockProjectName",
    await assertCallable("TokenLockup.unlockProjectName", () =>
      lockup.unlockProjectName() as Promise<string>,
    ),
    expected.unlockProjectName,
  );
  assertBigIntEqual(
    "TokenLockup.unlockProjectVersion",
    await assertCallable("TokenLockup.unlockProjectVersion", () =>
      lockup.unlockProjectVersion() as Promise<bigint>,
    ),
    expected.unlockProjectVersion,
  );
  const totalAssigned = await assertCallable("TokenLockup.totalAssigned", () =>
    lockup.totalAssigned(ZERO_ADDRESS) as Promise<bigint>,
  );
  if (mode === "deployed") {
    assertBigIntEqual("TokenLockup.totalAssigned(address(0))", totalAssigned, 0n);
  }
  await assertCallable("TokenLockup.totalClaimed", () =>
    lockup.totalClaimed(ZERO_ADDRESS) as Promise<bigint>,
  );
}

async function validateProjectModule(
  address: string,
  mode: ModuleValidationMode,
  wallet: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  expected: {
    initProjectIdCounter: bigint;
    mainProjectName: string;
    finalVersion: bigint;
  },
) {
  await ensureCode(provider, address, "Project");
  const project = await contractFromArtifact(
    wallet,
    artifactsDir,
    "contracts/Project.sol/ProjectManagement.json",
    address,
  );
  await validateReadableVersion(project, "Project");
  const projectIdCounter = await assertCallable("Project.projectIdCounter", () =>
    project.projectIdCounter() as Promise<bigint>,
  );
  if (mode === "deployed") {
    assertBigIntEqual("Project.projectIdCounter", projectIdCounter, expected.initProjectIdCounter);
  } else {
    assertBigIntAtLeast("Project.projectIdCounter", projectIdCounter, expected.initProjectIdCounter);
  }
  await assertCallable("Project.versionReleasedTime", () =>
    project.versionReleasedTime(expected.mainProjectName, expected.finalVersion) as Promise<bigint>,
  );
  await assertCallable("Project.latestProjectVersion", () =>
    project.latestProjectVersion(expected.mainProjectName),
  );
}

async function validateAcquiredModule(
  address: string,
  _mode: ModuleValidationMode,
  wallet: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  expected: {
    initInvestmentCount: bigint;
  },
) {
  await ensureCode(provider, address, "Acquired");
  const acquired = await contractFromArtifact(wallet, artifactsDir, "contracts/Acquired.sol/Acquired.json", address);
  await validateReadableVersion(acquired, "Acquired");
  await assertCallable("Acquired.getInvestmentInfo", () =>
    acquired.getInvestmentInfo(expected.initInvestmentCount) as Promise<unknown>,
  );
  await assertCallable("Acquired.getAddressInvestedAmount", () =>
    acquired.getAddressInvestedAmount(expected.initInvestmentCount, wallet.address) as Promise<bigint>,
  );
  await assertCallable("Acquired.getAddressPercent", () =>
    acquired.getAddressPercent(expected.initInvestmentCount, wallet.address) as Promise<bigint>,
  );
}

async function sendAndWait(
  label: string,
  action: () => Promise<ethers.TransactionResponse | ethers.ContractTransactionResponse>,
) {
  const tx = await action();
  console.log(`${label}: ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} failed`);
  }
  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  };
}

async function assertDaoModuleRegistered(dao: ethers.Contract, moduleAddress: string, label: string) {
  const registered = await assertCallable(`DAO.isDAOContract(${label})`, () =>
    dao.isDAOContract(moduleAddress) as Promise<boolean>,
  );
  if (!registered) {
    throw new Error(`DAO.isDAOContract returned false for ${label} at ${moduleAddress}`);
  }
}

async function wireDaoModule(
  dao: ethers.Contract,
  setterName: string,
  getterName: string,
  moduleAddress: string,
  label: string,
  config: SourceDaoBootstrapConfig,
): Promise<BootstrapOperation> {
  const daoWithDynamicMethods = dao as unknown as Record<string, ethers.BaseContractMethod>;
  const getter = daoWithDynamicMethods[getterName];
  const setter = daoWithDynamicMethods[setterName];
  if (!getter || !setter) {
    throw new Error(`DAO ABI missing ${getterName} or ${setterName}`);
  }

  const currentAddress = (await assertCallable(`DAO.${getterName}`, async () => getter())) as string;
  if (sameAddress(currentAddress, ZERO_ADDRESS)) {
    await assertCallable(`DAO.${setterName}.staticCall`, async () => setter.staticCall(moduleAddress));
    const result = await sendAndWait(`Dao.${setterName}`, async () =>
      setter(moduleAddress, { gasLimit: gasLimit(config) }) as Promise<ethers.ContractTransactionResponse>,
    );
    const readbackAddress = (await assertCallable(`DAO.${getterName}`, async () => getter())) as string;
    assertAddressEqual(`DAO.${getterName}`, readbackAddress, moduleAddress);
    await assertDaoModuleRegistered(dao, moduleAddress, label);
    return {
      name: `Dao.${setterName}`,
      status: "completed",
      tx_hash: result.txHash,
      block_number: result.blockNumber,
    };
  }

  assertAddressEqual(`DAO.${getterName}`, currentAddress, moduleAddress);
  await assertDaoModuleRegistered(dao, moduleAddress, label);
  console.log(`Dao.${setterName}: already wired to ${currentAddress}`);
  return {
    name: `Dao.${setterName}`,
    status: "skipped",
    details: `already wired to ${currentAddress}`,
  };
}

async function deployUupsProxy(
  label: string,
  wallet: ethers.Wallet,
  artifactsDir: string,
  relativeArtifactPath: string,
  initArgs: unknown[],
  config: SourceDaoBootstrapConfig,
  operations: BootstrapOperation[],
) {
  const artifact = await loadArtifact(artifactsDir, relativeArtifactPath);
  const proxyArtifact = await loadArtifact(
    artifactsDir,
    "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json",
  );

  const implementationFactory = new ethers.ContractFactory(
    artifact.abi as ethers.InterfaceAbi,
    artifact.bytecode,
    wallet,
  );
  const implementation = await implementationFactory.deploy({ gasLimit: gasLimit(config) });
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();
  const implementationTx = implementation.deploymentTransaction();
  if (!implementationTx) {
    throw new Error(`${label} implementation deployment has no transaction`);
  }
  const implementationReceipt = await implementationTx.wait();
  if (!implementationReceipt || implementationReceipt.status !== 1) {
    throw new Error(`${label} implementation deployment failed`);
  }
  const implementationTxHash = implementationTx.hash;
  operations.push({
    name: `${label}.deployImplementation`,
    status: "completed",
    tx_hash: implementationTxHash,
    block_number: implementationReceipt.blockNumber,
  });

  const iface = new ethers.Interface(artifact.abi as ethers.InterfaceAbi);
  const initData = iface.encodeFunctionData("initialize", initArgs);

  const proxyFactory = new ethers.ContractFactory(
    proxyArtifact.abi as ethers.InterfaceAbi,
    proxyArtifact.bytecode,
    wallet,
  );
  const proxy = await proxyFactory.deploy(implementationAddress, initData, {
    gasLimit: gasLimit(config),
  });
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  const proxyTx = proxy.deploymentTransaction();
  if (!proxyTx) {
    throw new Error(`${label} proxy deployment has no transaction`);
  }
  const proxyReceipt = await proxyTx.wait();
  if (!proxyReceipt || proxyReceipt.status !== 1) {
    throw new Error(`${label} proxy deployment failed`);
  }
  const proxyTxHash = proxyTx.hash;
  operations.push({
    name: `${label}.deployProxy`,
    status: "completed",
    tx_hash: proxyTxHash,
    block_number: proxyReceipt.blockNumber,
  });

  return {
    proxyAddress,
    implementationAddress,
    proxyTxHash,
    proxyBlockNumber: proxyReceipt.blockNumber,
    implementationTxHash,
    implementationBlockNumber: implementationReceipt.blockNumber,
  };
}

async function ensureDaoAndDividend(
  config: ResolvedBootstrapConfig,
  wallet: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
  operations: BootstrapOperation[],
) {
  const daoArtifact = await loadArtifact(artifactsDir, "contracts/Dao.sol/SourceDao.json");
  const dividendArtifact = await loadArtifact(
    artifactsDir,
    "contracts/Dividend.sol/DividendContract.json",
  );

  const dao = new ethers.Contract(config.daoAddress, daoArtifact.abi as ethers.InterfaceAbi, wallet);
  const dividend = new ethers.Contract(
    config.dividendAddress,
    dividendArtifact.abi as ethers.InterfaceAbi,
    wallet,
  );

  await ensureCode(provider, config.daoAddress, "DAO");
  await ensureCode(provider, config.dividendAddress, "Dividend");

  const daoBootstrapAdmin = (await dao.bootstrapAdmin()) as string;
  if (sameAddress(daoBootstrapAdmin, ZERO_ADDRESS)) {
    await dao.initialize.staticCall();
    const result = await sendAndWait("Dao.initialize", async () =>
      dao.initialize({ gasLimit: gasLimit(config) }),
    );
    operations.push({
      name: "Dao.initialize",
      status: "completed",
      tx_hash: result.txHash,
      block_number: result.blockNumber,
    });
  } else if (!sameAddress(daoBootstrapAdmin, wallet.address)) {
    throw new Error(`dao bootstrap admin mismatch: have ${daoBootstrapAdmin}, expected ${wallet.address}`);
  } else {
    console.log(`Dao.initialize: already initialized by ${daoBootstrapAdmin}`);
    operations.push({
      name: "Dao.initialize",
      status: "skipped",
      details: `already initialized by ${daoBootstrapAdmin}`,
    });
  }
  await validateDaoContract(dao, wallet.address);

  const cycleMinLength = BigInt(await dividend.cycleMinLength());
  if (cycleMinLength === 0n) {
    await dividend.initialize.staticCall(config.cycleMinLength, config.daoAddress);
    const result = await sendAndWait("Dividend.initialize", async () =>
      dividend.initialize(config.cycleMinLength, config.daoAddress, { gasLimit: gasLimit(config) }),
    );
    operations.push({
      name: "Dividend.initialize",
      status: "completed",
      tx_hash: result.txHash,
      block_number: result.blockNumber,
    });
  } else if (cycleMinLength !== BigInt(config.cycleMinLength)) {
    throw new Error(
      `dividend cycleMinLength mismatch: have ${cycleMinLength}, expected ${config.cycleMinLength}`,
    );
  } else {
    console.log(`Dividend.initialize: already initialized with cycleMinLength=${cycleMinLength}`);
    operations.push({
      name: "Dividend.initialize",
      status: "skipped",
      details: `already initialized with cycleMinLength=${cycleMinLength}`,
    });
  }
  await validateDividendModule(config.dividendAddress, wallet, provider, artifactsDir, config);

  operations.push(
    await wireDaoModule(
      dao,
      "setTokenDividendAddress",
      "dividend",
      config.dividendAddress,
      "Dividend",
      config,
    ),
  );

  return dao;
}

function moduleRecordFromExisting(address: string): ModuleRecord {
  return { address, source: "existing" };
}

function moduleRecordFromDeployment(details: {
  proxyAddress: string;
  implementationAddress: string;
  proxyTxHash: string;
  proxyBlockNumber: number;
  implementationTxHash: string;
  implementationBlockNumber: number;
}): ModuleRecord {
  return {
    address: details.proxyAddress,
    source: "deployed",
    implementation_address: details.implementationAddress,
    proxy_tx_hash: details.proxyTxHash,
    proxy_block_number: details.proxyBlockNumber,
    implementation_tx_hash: details.implementationTxHash,
    implementation_block_number: details.implementationBlockNumber,
    wiring_tx_hash: undefined,
    wiring_block_number: undefined,
  };
}

async function ensureModule(
  label: string,
  currentAddress: string,
  deploy: () => Promise<ModuleRecord>,
  provider: ethers.JsonRpcProvider,
  validateModule: (address: string, mode: ModuleValidationMode) => Promise<void>,
): Promise<ModuleRecord> {
  if (!sameAddress(currentAddress, ZERO_ADDRESS)) {
    await ensureCode(provider, currentAddress, label);
    await validateModule(currentAddress, "existing");
    console.log(`${label}: already configured at ${currentAddress}`);
    return moduleRecordFromExisting(currentAddress);
  }
  printHeader(`Deploy ${label}`);
  return deploy();
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const sourceConfig = await loadJsonFile<unknown>(options.configPath);
  assertPublicBootstrapConfig(sourceConfig);
  const config = resolveBootstrapConfig(sourceConfig);
  const artifactsDir = normalizeArtifactsDir(options.configPath, config.artifactsDir);
  const rpcUrl = options.rpcUrl || config.rpcUrl;
  const modules = createEmptyModules();
  const operations: BootstrapOperation[] = [];
  const context: BootstrapRuntimeContext = {
    options,
    config,
    artifactsDir,
    rpcUrl,
    walletAddress: config.bootstrapAdminAddress,
    operations,
    modules,
    currentStep: "Preflight",
  };
  latestRuntimeContext = context;
  await updateProgress(context, "SourceDAO full bootstrap preflight started", "Preflight");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== config.chainId) {
    throw new Error(`unexpected chainId ${chainId}, expected ${config.chainId}`);
  }

  const configuredPrivateKey = process.env.SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY?.trim();
  if (!configuredPrivateKey) {
    throw new Error("SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY is required");
  }
  const wallet = new ethers.Wallet(
    configuredPrivateKey.startsWith("0x") ? configuredPrivateKey : `0x${configuredPrivateKey}`,
    provider,
  );
  if (!sameAddress(wallet.address, config.bootstrapAdminAddress)) {
    throw new Error(
      `bootstrap signer mismatch: derived ${wallet.address}, expected ${config.bootstrapAdminAddress}`,
    );
  }
  context.walletAddress = wallet.address;
  await updateProgress(context, "Checking or initializing DAO and Dividend", "DaoAndDividend");
  const dao = await ensureDaoAndDividend(config, wallet, provider, artifactsDir, operations);
  await updateProgress(context, "DAO and Dividend are ready", null);

  printHeader("SourceDAO bootstrap config");
  console.log(`RPC URL            ${rpcUrl}`);
  console.log(`Chain ID           ${config.chainId}`);
  console.log(`Artifacts dir      ${artifactsDir}`);
  console.log(`Bootstrap admin    ${wallet.address}`);
  console.log(`DAO                ${config.daoAddress}`);
  console.log(`Dividend           ${config.dividendAddress}`);

  const devTokenInitAddresses = config.devToken.initAddresses;
  const devTokenInitAmounts = ensureBigIntList(config.devToken.initAmounts, "devToken.initAmounts");
  const devTokenTotalSupply = parseBigIntString(config.devToken.totalSupply, "devToken.totalSupply");
  const devTokenInitialReleased = sumBigInts(devTokenInitAmounts);
  const committeeMembers = config.committee.initialMembers;
  const committeeInitProposalId = config.committee.initProposalId;
  const committeeInitDevRatio = config.committee.initDevRatio;
  const committeeMainProject = config.committee.mainProjectName;
  const committeeMainProjectBytes = ethers.encodeBytes32String(committeeMainProject);
  const committeeFinalVersion = convertVersion(config.committee.finalVersion);
  const committeeFinalDevRatio = config.committee.finalDevRatio;
  const projectInitProjectIdCounter = config.project.initProjectIdCounter;
  const tokenLockupProjectName = config.tokenLockup.unlockProjectName;
  const tokenLockupProjectNameBytes = ethers.encodeBytes32String(tokenLockupProjectName);
  const tokenLockupProjectVersion = convertVersion(config.tokenLockup.unlockVersion);
  const acquiredInitInvestmentCount = config.acquired.initInvestmentCount;

  const validateCommittee = (address: string, mode: ModuleValidationMode) =>
    validateCommitteeModule(address, mode, wallet, provider, artifactsDir, {
      members: committeeMembers,
      initProposalId: BigInt(committeeInitProposalId),
      initDevRatio: BigInt(committeeInitDevRatio),
      mainProjectName: committeeMainProjectBytes,
      finalVersion: BigInt(committeeFinalVersion),
      finalDevRatio: BigInt(committeeFinalDevRatio),
    });
  const validateDevToken = (address: string, mode: ModuleValidationMode) =>
    validateDevTokenModule(address, mode, wallet, provider, artifactsDir, {
      name: config.devToken.name,
      symbol: config.devToken.symbol,
      totalSupply: devTokenTotalSupply,
      initialReleased: devTokenInitialReleased,
    });
  const validateNormalToken = (address: string, mode: ModuleValidationMode) =>
    validateNormalTokenModule(address, mode, wallet, provider, artifactsDir, {
      name: config.normalToken.name,
      symbol: config.normalToken.symbol,
    });
  const validateTokenLockup = (address: string, mode: ModuleValidationMode) =>
    validateTokenLockupModule(address, mode, wallet, provider, artifactsDir, {
      unlockProjectName: tokenLockupProjectNameBytes,
      unlockProjectVersion: BigInt(tokenLockupProjectVersion),
    });
  const validateProject = (address: string, mode: ModuleValidationMode) =>
    validateProjectModule(address, mode, wallet, provider, artifactsDir, {
      initProjectIdCounter: BigInt(projectInitProjectIdCounter),
      mainProjectName: committeeMainProjectBytes,
      finalVersion: BigInt(committeeFinalVersion),
    });
  const validateAcquired = (address: string, mode: ModuleValidationMode) =>
    validateAcquiredModule(address, mode, wallet, provider, artifactsDir, {
      initInvestmentCount: BigInt(acquiredInitInvestmentCount),
    });

  const currentCommittee = (await dao.committee()) as string;
  const currentDevToken = (await dao.devToken()) as string;
  const currentNormalToken = (await dao.normalToken()) as string;
  const currentLockup = (await dao.lockup()) as string;
  const currentProject = (await dao.project()) as string;
  const currentAcquired = (await dao.acquired()) as string;

  await updateProgress(context, "Checking or deploying Committee", "Committee");
  const committee = await ensureModule(
    "Committee",
    currentCommittee,
    async () => {
      const deployed = await deployUupsProxy(
        "Committee",
        wallet,
        artifactsDir,
        "contracts/Committee.sol/SourceDaoCommittee.json",
        [
          committeeMembers,
          committeeInitProposalId,
          committeeInitDevRatio,
          committeeMainProjectBytes,
          committeeFinalVersion,
          committeeFinalDevRatio,
          config.daoAddress,
        ],
        config,
        operations,
      );
      const record = moduleRecordFromDeployment(deployed);
      modules.committee = record;
      await validateCommittee(deployed.proxyAddress, "deployed");
      await updateProgress(context, "Committee deployed; wiring DAO", "Dao.setCommitteeAddress");
      const wiring = await wireDaoModule(
        dao,
        "setCommitteeAddress",
        "committee",
        deployed.proxyAddress,
        "Committee",
        config,
      );
      operations.push(wiring);
      record.wiring_tx_hash = wiring.tx_hash;
      record.wiring_block_number = wiring.block_number;
      return record;
    },
    provider,
    validateCommittee,
  );
  modules.committee = committee;
  await updateProgress(context, `Committee ready at ${committee.address}`, null);

  await updateProgress(context, "Checking or deploying DevToken", "DevToken");
  const devToken = await ensureModule(
    "DevToken",
    currentDevToken,
    async () => {
      const deployed = await deployUupsProxy(
        "DevToken",
        wallet,
        artifactsDir,
        "contracts/DevToken.sol/DevToken.json",
        [
          config.devToken.name,
          config.devToken.symbol,
          devTokenTotalSupply,
          devTokenInitAddresses,
          devTokenInitAmounts,
          config.daoAddress,
        ],
        config,
        operations,
      );
      const record = moduleRecordFromDeployment(deployed);
      modules.dev_token = record;
      await validateDevToken(deployed.proxyAddress, "deployed");
      await updateProgress(context, "DevToken deployed; wiring DAO", "Dao.setDevTokenAddress");
      const wiring = await wireDaoModule(
        dao,
        "setDevTokenAddress",
        "devToken",
        deployed.proxyAddress,
        "DevToken",
        config,
      );
      operations.push(wiring);
      record.wiring_tx_hash = wiring.tx_hash;
      record.wiring_block_number = wiring.block_number;
      return record;
    },
    provider,
    validateDevToken,
  );
  modules.dev_token = devToken;
  await updateProgress(context, `DevToken ready at ${devToken.address}`, null);

  await updateProgress(context, "Checking or deploying NormalToken", "NormalToken");
  const normalToken = await ensureModule(
    "NormalToken",
    currentNormalToken,
    async () => {
      const deployed = await deployUupsProxy(
        "NormalToken",
        wallet,
        artifactsDir,
        "contracts/NormalToken.sol/NormalToken.json",
        [config.normalToken.name, config.normalToken.symbol, config.daoAddress],
        config,
        operations,
      );
      const record = moduleRecordFromDeployment(deployed);
      modules.normal_token = record;
      await validateNormalToken(deployed.proxyAddress, "deployed");
      await updateProgress(context, "NormalToken deployed; wiring DAO", "Dao.setNormalTokenAddress");
      const wiring = await wireDaoModule(
        dao,
        "setNormalTokenAddress",
        "normalToken",
        deployed.proxyAddress,
        "NormalToken",
        config,
      );
      operations.push(wiring);
      record.wiring_tx_hash = wiring.tx_hash;
      record.wiring_block_number = wiring.block_number;
      return record;
    },
    provider,
    validateNormalToken,
  );
  modules.normal_token = normalToken;
  await updateProgress(context, `NormalToken ready at ${normalToken.address}`, null);

  await updateProgress(context, "Checking or deploying TokenLockup", "TokenLockup");
  const tokenLockup = await ensureModule(
    "TokenLockup",
    currentLockup,
    async () => {
      const deployed = await deployUupsProxy(
        "TokenLockup",
        wallet,
        artifactsDir,
        "contracts/TokenLockup.sol/SourceTokenLockup.json",
        [
          tokenLockupProjectNameBytes,
          tokenLockupProjectVersion,
          config.daoAddress,
        ],
        config,
        operations,
      );
      const record = moduleRecordFromDeployment(deployed);
      modules.token_lockup = record;
      await validateTokenLockup(deployed.proxyAddress, "deployed");
      await updateProgress(context, "TokenLockup deployed; wiring DAO", "Dao.setTokenLockupAddress");
      const wiring = await wireDaoModule(
        dao,
        "setTokenLockupAddress",
        "lockup",
        deployed.proxyAddress,
        "TokenLockup",
        config,
      );
      operations.push(wiring);
      record.wiring_tx_hash = wiring.tx_hash;
      record.wiring_block_number = wiring.block_number;
      return record;
    },
    provider,
    validateTokenLockup,
  );
  modules.token_lockup = tokenLockup;
  await updateProgress(context, `TokenLockup ready at ${tokenLockup.address}`, null);

  await updateProgress(context, "Checking or deploying Project", "Project");
  const project = await ensureModule(
    "Project",
    currentProject,
    async () => {
      const deployed = await deployUupsProxy(
        "Project",
        wallet,
        artifactsDir,
        "contracts/Project.sol/ProjectManagement.json",
        [projectInitProjectIdCounter, config.daoAddress],
        config,
        operations,
      );
      const record = moduleRecordFromDeployment(deployed);
      modules.project = record;
      await validateProject(deployed.proxyAddress, "deployed");
      await updateProgress(context, "Project deployed; wiring DAO", "Dao.setProjectAddress");
      const wiring = await wireDaoModule(
        dao,
        "setProjectAddress",
        "project",
        deployed.proxyAddress,
        "Project",
        config,
      );
      operations.push(wiring);
      record.wiring_tx_hash = wiring.tx_hash;
      record.wiring_block_number = wiring.block_number;
      return record;
    },
    provider,
    validateProject,
  );
  modules.project = project;
  await updateProgress(context, `Project ready at ${project.address}`, null);

  await updateProgress(context, "Checking or deploying Acquired", "Acquired");
  const acquired = await ensureModule(
    "Acquired",
    currentAcquired,
    async () => {
      const deployed = await deployUupsProxy(
        "Acquired",
        wallet,
        artifactsDir,
        "contracts/Acquired.sol/Acquired.json",
        [acquiredInitInvestmentCount, config.daoAddress],
        config,
        operations,
      );
      const record = moduleRecordFromDeployment(deployed);
      modules.acquired = record;
      await validateAcquired(deployed.proxyAddress, "deployed");
      await updateProgress(context, "Acquired deployed; wiring DAO", "Dao.setAcquiredAddress");
      const wiring = await wireDaoModule(
        dao,
        "setAcquiredAddress",
        "acquired",
        deployed.proxyAddress,
        "Acquired",
        config,
      );
      operations.push(wiring);
      record.wiring_tx_hash = wiring.tx_hash;
      record.wiring_block_number = wiring.block_number;
      return record;
    },
    provider,
    validateAcquired,
  );
  modules.acquired = acquired;
  await updateProgress(context, `Acquired ready at ${acquired.address}`, null);

  const finalCommittee = (await dao.committee()) as string;
  const finalDevToken = (await dao.devToken()) as string;
  const finalNormalToken = (await dao.normalToken()) as string;
  const finalProject = (await dao.project()) as string;
  const finalLockup = (await dao.lockup()) as string;
  const finalDividend = (await dao.dividend()) as string;
  const finalAcquired = (await dao.acquired()) as string;

  if (
    finalCommittee === ZERO_ADDRESS ||
    finalDevToken === ZERO_ADDRESS ||
    finalNormalToken === ZERO_ADDRESS ||
    finalProject === ZERO_ADDRESS ||
    finalLockup === ZERO_ADDRESS ||
    finalDividend === ZERO_ADDRESS ||
    finalAcquired === ZERO_ADDRESS
  ) {
    throw new Error("SourceDAO bootstrap incomplete after deployment");
  }

  assertAddressEqual("DAO.committee final wiring", finalCommittee, committee.address);
  assertAddressEqual("DAO.devToken final wiring", finalDevToken, devToken.address);
  assertAddressEqual("DAO.normalToken final wiring", finalNormalToken, normalToken.address);
  assertAddressEqual("DAO.project final wiring", finalProject, project.address);
  assertAddressEqual("DAO.lockup final wiring", finalLockup, tokenLockup.address);
  assertAddressEqual("DAO.dividend final wiring", finalDividend, config.dividendAddress);
  assertAddressEqual("DAO.acquired final wiring", finalAcquired, acquired.address);
  await assertDaoModuleRegistered(dao, finalCommittee, "Committee");
  await assertDaoModuleRegistered(dao, finalDevToken, "DevToken");
  await assertDaoModuleRegistered(dao, finalNormalToken, "NormalToken");
  await assertDaoModuleRegistered(dao, finalProject, "Project");
  await assertDaoModuleRegistered(dao, finalLockup, "TokenLockup");
  await assertDaoModuleRegistered(dao, finalDividend, "Dividend");
  await assertDaoModuleRegistered(dao, finalAcquired, "Acquired");

  printHeader("Bootstrap summary");
  console.log(`Committee          ${finalCommittee}`);
  console.log(`DevToken           ${finalDevToken}`);
  console.log(`NormalToken        ${finalNormalToken}`);
  console.log(`Project            ${finalProject}`);
  console.log(`TokenLockup        ${finalLockup}`);
  console.log(`Dividend           ${finalDividend}`);
  console.log(`Acquired           ${finalAcquired}`);

  modules.committee = committee;
  modules.dev_token = devToken;
  modules.normal_token = normalToken;
  modules.token_lockup = tokenLockup;
  modules.project = project;
  modules.acquired = acquired;
  context.currentStep = null;
  latestRuntimeContext = context;
  await writeBootstrapStateSnapshot(context, "completed", "SourceDAO full bootstrap completed successfully");
}

main().catch(async (error) => {
  const errorText = error instanceof Error ? error.stack || error.message : String(error);
  if (latestRuntimeContext) {
    try {
      latestRuntimeContext.operations.push({
        name: latestRuntimeContext.currentStep ?? "Bootstrap",
        status: "error",
        error: formatUnknownError(error),
      });
      await writeBootstrapStateSnapshot(
        latestRuntimeContext,
        "error",
        "SourceDAO full bootstrap failed",
        errorText,
      );
    } catch (writeError) {
      const writeText = writeError instanceof Error ? writeError.stack || writeError.message : String(writeError);
      console.error("Failed to persist SourceDAO bootstrap error state.");
      console.error(writeText);
    }
  }
  console.error("\nUSDB full SourceDAO bootstrap failed.");
  console.error(errorText);
  process.exitCode = 1;
});
