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
  chainId: number;
  rpcUrl: string;
  artifactsDir?: string;
  daoAddress: string;
  dividendAddress: string;
  bootstrapAdminPrivateKey?: string;
  bootstrapAdminAddress?: string;
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
  chainId: number;
  rpcUrl: string;
  artifactsDir?: string;
  daoAddress: string;
  dividendAddress: string;
  bootstrapAdminPrivateKey?: string;
  bootstrapAdminAddress?: string;
  cycleMinLength: number;
  outputPath?: string;
  expectedModules?: Partial<ExpectedModules>;
  committee: {
    initialMembers: string[];
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
  return values.map((value, index) => ethers.getAddress(requireNonEmptyString(value, `${field}[${index}]`)));
}

function parseBigIntString(value: string, field: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid bigint string for ${field}: ${value}`);
  }
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

function resolveBootstrapConfig(config: SourceDaoBootstrapConfig): ResolvedBootstrapConfig {
  const committee = config.committee
    ? {
        initialMembers: ensureAddressList(config.committee.initialMembers ?? [], "committee.initialMembers"),
        initDevRatio: config.committee.initDevRatio ?? 400,
        mainProjectName: requireNonEmptyString(config.committee.mainProjectName, "committee.mainProjectName"),
        finalVersion: requireNonEmptyString(config.committee.finalVersion, "committee.finalVersion"),
        finalDevRatio: config.committee.finalDevRatio ?? 120,
      }
    : {
        initialMembers: DEFAULT_COMMITTEE_MEMBERS,
        initDevRatio: 400,
        mainProjectName: "Buckyos",
        finalVersion: "1.0.0",
        finalDevRatio: 120,
      };

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
    : {
        name: "BuckyOS Develop DAO Token",
        symbol: "BDDT",
        totalSupply: ethers.parseEther("2100000000").toString(),
        initAddresses: DEFAULT_DEV_TOKEN_ADDRESSES,
        initAmounts: DEFAULT_DEV_TOKEN_AMOUNTS,
      };

  if (devToken.initAddresses.length !== devToken.initAmounts.length) {
    throw new Error("devToken.initAddresses and devToken.initAmounts length mismatch");
  }

  return {
    ...config,
    daoAddress: ethers.getAddress(config.daoAddress),
    dividendAddress: ethers.getAddress(config.dividendAddress),
    bootstrapAdminAddress: config.bootstrapAdminAddress
      ? ethers.getAddress(config.bootstrapAdminAddress)
      : undefined,
    expectedModules: normalizeExpectedModules(config.expectedModules),
    committee,
    devToken,
    normalToken: config.normalToken
      ? {
          name: requireNonEmptyString(config.normalToken.name, "normalToken.name"),
          symbol: requireNonEmptyString(config.normalToken.symbol, "normalToken.symbol"),
        }
      : { name: "BuckyOS DAO Token", symbol: "BDT" },
    tokenLockup: config.tokenLockup
      ? {
          unlockProjectName: requireNonEmptyString(config.tokenLockup.unlockProjectName, "tokenLockup.unlockProjectName"),
          unlockVersion: requireNonEmptyString(config.tokenLockup.unlockVersion, "tokenLockup.unlockVersion"),
        }
      : { unlockProjectName: "Buckyos", unlockVersion: "1.0.0" },
    project: config.project
      ? { initProjectIdCounter: config.project.initProjectIdCounter ?? 4 }
      : { initProjectIdCounter: 4 },
    acquired: config.acquired
      ? { initInvestmentCount: config.acquired.initInvestmentCount ?? 4 }
      : { initInvestmentCount: 4 },
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

function deriveExpectedBootstrapAdmin(config: ResolvedBootstrapConfig): string | null {
  if (config.bootstrapAdminAddress) return config.bootstrapAdminAddress;
  if (config.bootstrapAdminPrivateKey) {
    const privateKey = config.bootstrapAdminPrivateKey.startsWith("0x")
      ? config.bootstrapAdminPrivateKey
      : `0x${config.bootstrapAdminPrivateKey}`;
    return new ethers.Wallet(privateKey).address;
  }
  return null;
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
  const sourceConfig = await loadJsonFile<SourceDaoBootstrapConfig>(options.configPath);
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
  const expectedBootstrapAdmin = deriveExpectedBootstrapAdmin(config);
  if (expectedBootstrapAdmin) {
    assertAddressEqual("DAO.bootstrapAdmin", bootstrapAdmin, expectedBootstrapAdmin);
  }
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
