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
  chainId: number;
  rpcUrl: string;
  artifactsDir?: string;
  daoAddress: string;
  dividendAddress: string;
  bootstrapAdminPrivateKey: string;
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
  status: "completed" | "skipped";
  tx_hash?: string;
  details?: string;
};

type ModuleRecord = {
  address: string;
  source: "existing" | "deployed";
  implementation_address?: string;
  proxy_tx_hash?: string;
  implementation_tx_hash?: string;
  wiring_tx_hash?: string;
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
  "../tools/config/sourcedao-local.json",
);
const DEFAULT_ARTIFACTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts-usdb",
);
const DEFAULT_TRANSACTION_GAS_LIMIT = 8_000_000n;
const ZERO_ADDRESS = ethers.ZeroAddress;

const DEFAULT_COMMITTEE_MEMBERS = [
  "0xad82A5fb394a525835A3a6DC34C1843e19160CFA",
  "0x2514d2FEAAC3bFD8361333d1341dC8823595f744",
  "0x2DFD1FCFC9601E7De871b0BbcBCbB6Cad6901697",
];

const DEFAULT_DEV_TOKEN_ADDRESSES = [
  "0x2DFD1FCFC9601E7De871b0BbcBCbB6Cad6901697",
  "0xad82A5fb394a525835A3a6DC34C1843e19160CFA",
  "0x0Ef9534aE246d24e1C79BC1fE8c8718C11a7fF09",
  "0x2514d2FEAAC3bFD8361333d1341dC8823595f744",
  "0x0F56a6f7662B38506f7Ad0ad0cc952b79b8e90e7",
  "0x71165cD9579b495276De7b0389bB2Cd5352DaFE6",
  "0x865d123D1CFC7F95B48495A854173408032b9358",
  "0x19b54B60908241C301d5c95EDbd4C80081dF95B5",
  "0xC7ced856D14720547533E1E32D7FEfb9877E84E5",
  "0xdc7dD66eafdBf4B2e40CbC7bEb93f732f8F86518",
];

const DEFAULT_DEV_TOKEN_AMOUNTS = [
  "109876068779349609949184721",
  "6035901558616593430477310",
  "6830778957104289571042895",
  "2580803954604539546045395",
  "4155646470352964703529647",
  "35000000000000000000000",
  "1950866948305169483051694",
  "4466415393460653934606539",
  "4945967938206179382061793",
  "6122550000000000000000000",
];

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

async function loadArtifact(artifactsDir: string, relativePath: string): Promise<HardhatArtifact> {
  return loadJsonFile<HardhatArtifact>(path.join(artifactsDir, relativePath));
}

function normalizeArtifactsDir(configPath: string, artifactsDir?: string) {
  if (!artifactsDir) return DEFAULT_ARTIFACTS_DIR;
  if (path.isAbsolute(artifactsDir)) return artifactsDir;
  return path.resolve(path.dirname(configPath), artifactsDir);
}

function convertVersion(version: string): number {
  const versions = version.split(".");
  if (versions.length < 3) {
    throw new Error(`Invalid version format: ${version}. Expected format is major.minor.patch`);
  }
  const major = Number.parseInt(versions[0], 10);
  const minor = Number.parseInt(versions[1], 10);
  const patch = Number.parseInt(versions[2], 10);
  return major * 10_000_000_000 + minor * 100_000 + patch;
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
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid bigint string for ${field}: ${value}`);
  }
}

function ensureAddressList(values: string[], field: string): string[] {
  if (values.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  return values.map((value, index) => ethers.getAddress(requireNonEmptyString(value, `${field}[${index}]`)));
}

function ensureBigIntList(values: string[], field: string): bigint[] {
  if (values.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  return values.map((value, index) => parseBigIntString(requireNonEmptyString(value, `${field}[${index}]`), `${field}[${index}]`));
}

type ResolvedBootstrapConfig = {
  chainId: number;
  rpcUrl: string;
  artifactsDir?: string;
  daoAddress: string;
  dividendAddress: string;
  bootstrapAdminPrivateKey: string;
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
  const warnings: string[] = [];

  const committee = config.committee
    ? {
        initialMembers: ensureAddressList(config.committee.initialMembers ?? [], "committee.initialMembers"),
        initProposalId: config.committee.initProposalId ?? 7,
        initDevRatio: config.committee.initDevRatio ?? 400,
        mainProjectName: requireNonEmptyString(config.committee.mainProjectName, "committee.mainProjectName"),
        finalVersion: requireNonEmptyString(config.committee.finalVersion, "committee.finalVersion"),
        finalDevRatio: config.committee.finalDevRatio ?? 120,
      }
    : (() => {
        warnings.push("committee config missing; using legacy defaults");
        return {
          initialMembers: DEFAULT_COMMITTEE_MEMBERS,
          initProposalId: 7,
          initDevRatio: 400,
          mainProjectName: "Buckyos",
          finalVersion: "1.0.0",
          finalDevRatio: 120,
        };
      })();

  const devToken = config.devToken
    ? {
        name: requireNonEmptyString(config.devToken.name, "devToken.name"),
        symbol: requireNonEmptyString(config.devToken.symbol, "devToken.symbol"),
        totalSupply: requireNonEmptyString(config.devToken.totalSupply, "devToken.totalSupply"),
        initAddresses: ensureAddressList(config.devToken.initAddresses ?? [], "devToken.initAddresses"),
        initAmounts: (config.devToken.initAmounts ?? []).map((value, index) =>
          requireNonEmptyString(value, `devToken.initAmounts[${index}]`),
        ),
      }
    : (() => {
        warnings.push("devToken config missing; using legacy defaults");
        return {
          name: "BuckyOS Develop DAO Token",
          symbol: "BDDT",
          totalSupply: ethers.parseEther("2100000000").toString(),
          initAddresses: DEFAULT_DEV_TOKEN_ADDRESSES,
          initAmounts: DEFAULT_DEV_TOKEN_AMOUNTS,
        };
      })();

  const normalToken = config.normalToken
    ? {
        name: requireNonEmptyString(config.normalToken.name, "normalToken.name"),
        symbol: requireNonEmptyString(config.normalToken.symbol, "normalToken.symbol"),
      }
    : (() => {
        warnings.push("normalToken config missing; using legacy defaults");
        return { name: "BuckyOS DAO Token", symbol: "BDT" };
      })();

  const tokenLockup = config.tokenLockup
    ? {
        unlockProjectName: requireNonEmptyString(
          config.tokenLockup.unlockProjectName,
          "tokenLockup.unlockProjectName",
        ),
        unlockVersion: requireNonEmptyString(config.tokenLockup.unlockVersion, "tokenLockup.unlockVersion"),
      }
    : (() => {
        warnings.push("tokenLockup config missing; using legacy defaults");
        return { unlockProjectName: "Buckyos", unlockVersion: "1.0.0" };
      })();

  const project = config.project
    ? {
        initProjectIdCounter: config.project.initProjectIdCounter ?? 4,
      }
    : (() => {
        warnings.push("project config missing; using legacy defaults");
        return { initProjectIdCounter: 4 };
      })();

  const acquired = config.acquired
    ? {
        initInvestmentCount: config.acquired.initInvestmentCount ?? 4,
      }
    : (() => {
        warnings.push("acquired config missing; using legacy defaults");
        return { initInvestmentCount: 4 };
      })();

  if (devToken.initAddresses.length !== devToken.initAmounts.length) {
    throw new Error("devToken.initAddresses and devToken.initAmounts length mismatch");
  }

  return {
    ...config,
    committee,
    devToken,
    normalToken,
    tokenLockup,
    project,
    acquired,
    warnings,
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
  return tx.hash;
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
    const txHash = await sendAndWait(`Dao.${setterName}`, async () =>
      setter(moduleAddress, { gasLimit: gasLimit(config) }) as Promise<ethers.ContractTransactionResponse>,
    );
    const readbackAddress = (await assertCallable(`DAO.${getterName}`, async () => getter())) as string;
    assertAddressEqual(`DAO.${getterName}`, readbackAddress, moduleAddress);
    await assertDaoModuleRegistered(dao, moduleAddress, label);
    return { name: `Dao.${setterName}`, status: "completed", tx_hash: txHash };
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
  wallet: ethers.Wallet,
  artifactsDir: string,
  relativeArtifactPath: string,
  initArgs: unknown[],
  config: SourceDaoBootstrapConfig,
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
  const implementationTxHash = implementation.deploymentTransaction()?.hash ?? "";

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
  const proxyTxHash = proxy.deploymentTransaction()?.hash ?? "";

  return {
    proxyAddress,
    implementationAddress,
    proxyTxHash,
    implementationTxHash,
  };
}

async function ensureDaoAndDividend(
  config: ResolvedBootstrapConfig,
  wallet: ethers.Wallet,
  provider: ethers.JsonRpcProvider,
  artifactsDir: string,
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

  const operations: BootstrapOperation[] = [];
  const daoBootstrapAdmin = (await dao.bootstrapAdmin()) as string;
  if (sameAddress(daoBootstrapAdmin, ZERO_ADDRESS)) {
    await dao.initialize.staticCall();
    const txHash = await sendAndWait("Dao.initialize", async () =>
      dao.initialize({ gasLimit: gasLimit(config) }),
    );
    operations.push({ name: "Dao.initialize", status: "completed", tx_hash: txHash });
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
    const txHash = await sendAndWait("Dividend.initialize", async () =>
      dividend.initialize(config.cycleMinLength, config.daoAddress, { gasLimit: gasLimit(config) }),
    );
    operations.push({ name: "Dividend.initialize", status: "completed", tx_hash: txHash });
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

  return { dao, operations };
}

function moduleRecordFromExisting(address: string): ModuleRecord {
  return { address, source: "existing" };
}

function moduleRecordFromDeployment(details: {
  proxyAddress: string;
  implementationAddress: string;
  proxyTxHash: string;
  implementationTxHash: string;
}): ModuleRecord {
  return {
    address: details.proxyAddress,
    source: "deployed",
    implementation_address: details.implementationAddress,
    proxy_tx_hash: details.proxyTxHash,
    implementation_tx_hash: details.implementationTxHash,
    wiring_tx_hash: undefined,
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
  const sourceConfig = await loadJsonFile<SourceDaoBootstrapConfig>(options.configPath);
  const config = resolveBootstrapConfig(sourceConfig);
  const artifactsDir = normalizeArtifactsDir(options.configPath, config.artifactsDir);
  const rpcUrl = options.rpcUrl || config.rpcUrl;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== config.chainId) {
    throw new Error(`unexpected chainId ${chainId}, expected ${config.chainId}`);
  }

  const wallet = new ethers.Wallet(config.bootstrapAdminPrivateKey, provider);
  const modules = createEmptyModules();
  const { dao, operations } = await ensureDaoAndDividend(config, wallet, provider, artifactsDir);
  const context: BootstrapRuntimeContext = {
    options,
    config,
    artifactsDir,
    rpcUrl,
    walletAddress: wallet.address,
    operations,
    modules,
    currentStep: null,
  };
  latestRuntimeContext = context;
  await updateProgress(context, "SourceDAO full bootstrap started", "Preflight");

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
        wallet,
        artifactsDir,
        "contracts/NormalToken.sol/NormalToken.json",
        [config.normalToken.name, config.normalToken.symbol, config.daoAddress],
        config,
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
        wallet,
        artifactsDir,
        "contracts/TokenLockup.sol/SourceTokenLockup.json",
        [
          tokenLockupProjectNameBytes,
          tokenLockupProjectVersion,
          config.daoAddress,
        ],
        config,
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
        wallet,
        artifactsDir,
        "contracts/Project.sol/ProjectManagement.json",
        [projectInitProjectIdCounter, config.daoAddress],
        config,
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
        wallet,
        artifactsDir,
        "contracts/Acquired.sol/Acquired.json",
        [acquiredInitInvestmentCount, config.daoAddress],
        config,
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
