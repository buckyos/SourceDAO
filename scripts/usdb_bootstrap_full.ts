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

  const implementationFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const implementation = await implementationFactory.deploy({ gasLimit: gasLimit(config) });
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();
  const implementationTxHash = implementation.deploymentTransaction()?.hash ?? "";

  const iface = new ethers.Interface(artifact.abi);
  const initData = iface.encodeFunctionData("initialize", initArgs);

  const proxyFactory = new ethers.ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, wallet);
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

  const dao = new ethers.Contract(config.daoAddress, daoArtifact.abi, wallet);
  const dividend = new ethers.Contract(config.dividendAddress, dividendArtifact.abi, wallet);

  await ensureCode(provider, config.daoAddress, "DAO");
  await ensureCode(provider, config.dividendAddress, "Dividend");

  const operations: BootstrapOperation[] = [];
  const daoBootstrapAdmin = (await dao.bootstrapAdmin()) as string;
  if (daoBootstrapAdmin === ZERO_ADDRESS) {
    await dao.initialize.staticCall();
    const txHash = await sendAndWait("Dao.initialize", async () =>
      dao.initialize({ gasLimit: gasLimit(config) }),
    );
    operations.push({ name: "Dao.initialize", status: "completed", tx_hash: txHash });
  } else if (daoBootstrapAdmin.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`dao bootstrap admin mismatch: have ${daoBootstrapAdmin}, expected ${wallet.address}`);
  } else {
    console.log(`Dao.initialize: already initialized by ${daoBootstrapAdmin}`);
    operations.push({
      name: "Dao.initialize",
      status: "skipped",
      details: `already initialized by ${daoBootstrapAdmin}`,
    });
  }

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

  const daoDividend = (await dao.dividend()) as string;
  if (daoDividend === ZERO_ADDRESS) {
    await dao.setTokenDividendAddress.staticCall(config.dividendAddress);
    const txHash = await sendAndWait("Dao.setTokenDividendAddress", async () =>
      dao.setTokenDividendAddress(config.dividendAddress, { gasLimit: gasLimit(config) }),
    );
    operations.push({
      name: "Dao.setTokenDividendAddress",
      status: "completed",
      tx_hash: txHash,
    });
  } else if (daoDividend.toLowerCase() !== config.dividendAddress.toLowerCase()) {
    throw new Error(`dao dividend mismatch: have ${daoDividend}, expected ${config.dividendAddress}`);
  } else {
    console.log(`Dao.setTokenDividendAddress: already wired to ${daoDividend}`);
    operations.push({
      name: "Dao.setTokenDividendAddress",
      status: "skipped",
      details: `already wired to ${daoDividend}`,
    });
  }

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
): Promise<ModuleRecord> {
  if (currentAddress !== ZERO_ADDRESS) {
    await ensureCode(provider, currentAddress, label);
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
  const committeeMembers = config.committee.initialMembers;
  const committeeInitProposalId = config.committee.initProposalId;
  const committeeInitDevRatio = config.committee.initDevRatio;
  const committeeMainProject = config.committee.mainProjectName;
  const committeeFinalVersion = convertVersion(config.committee.finalVersion);
  const committeeFinalDevRatio = config.committee.finalDevRatio;
  const projectInitProjectIdCounter = config.project.initProjectIdCounter;
  const tokenLockupProjectName = config.tokenLockup.unlockProjectName;
  const tokenLockupProjectVersion = convertVersion(config.tokenLockup.unlockVersion);
  const acquiredInitInvestmentCount = config.acquired.initInvestmentCount;

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
          ethers.encodeBytes32String(committeeMainProject),
          committeeFinalVersion,
          committeeFinalDevRatio,
          config.daoAddress,
        ],
        config,
      );
      const record = moduleRecordFromDeployment(deployed);
      modules.committee = record;
      await updateProgress(context, "Committee deployed; wiring DAO", "Dao.setCommitteeAddress");
      const wiringTxHash = await sendAndWait("Dao.setCommitteeAddress", async () =>
        dao.setCommitteeAddress(deployed.proxyAddress, { gasLimit: gasLimit(config) }),
      );
      operations.push({ name: "Dao.setCommitteeAddress", status: "completed", tx_hash: wiringTxHash });
      record.wiring_tx_hash = wiringTxHash;
      return record;
    },
    provider,
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
          parseBigIntString(config.devToken.totalSupply, "devToken.totalSupply"),
          devTokenInitAddresses,
          devTokenInitAmounts,
          config.daoAddress,
        ],
        config,
      );
      const record = moduleRecordFromDeployment(deployed);
      modules.dev_token = record;
      await updateProgress(context, "DevToken deployed; wiring DAO", "Dao.setDevTokenAddress");
      const wiringTxHash = await sendAndWait("Dao.setDevTokenAddress", async () =>
        dao.setDevTokenAddress(deployed.proxyAddress, { gasLimit: gasLimit(config) }),
      );
      operations.push({ name: "Dao.setDevTokenAddress", status: "completed", tx_hash: wiringTxHash });
      record.wiring_tx_hash = wiringTxHash;
      return record;
    },
    provider,
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
      await updateProgress(context, "NormalToken deployed; wiring DAO", "Dao.setNormalTokenAddress");
      const wiringTxHash = await sendAndWait("Dao.setNormalTokenAddress", async () =>
        dao.setNormalTokenAddress(deployed.proxyAddress, { gasLimit: gasLimit(config) }),
      );
      operations.push({ name: "Dao.setNormalTokenAddress", status: "completed", tx_hash: wiringTxHash });
      record.wiring_tx_hash = wiringTxHash;
      return record;
    },
    provider,
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
          ethers.encodeBytes32String(tokenLockupProjectName),
          tokenLockupProjectVersion,
          config.daoAddress,
        ],
        config,
      );
      const record = moduleRecordFromDeployment(deployed);
      modules.token_lockup = record;
      await updateProgress(context, "TokenLockup deployed; wiring DAO", "Dao.setTokenLockupAddress");
      const wiringTxHash = await sendAndWait("Dao.setTokenLockupAddress", async () =>
        dao.setTokenLockupAddress(deployed.proxyAddress, { gasLimit: gasLimit(config) }),
      );
      operations.push({ name: "Dao.setTokenLockupAddress", status: "completed", tx_hash: wiringTxHash });
      record.wiring_tx_hash = wiringTxHash;
      return record;
    },
    provider,
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
      await updateProgress(context, "Project deployed; wiring DAO", "Dao.setProjectAddress");
      const wiringTxHash = await sendAndWait("Dao.setProjectAddress", async () =>
        dao.setProjectAddress(deployed.proxyAddress, { gasLimit: gasLimit(config) }),
      );
      operations.push({ name: "Dao.setProjectAddress", status: "completed", tx_hash: wiringTxHash });
      record.wiring_tx_hash = wiringTxHash;
      return record;
    },
    provider,
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
      await updateProgress(context, "Acquired deployed; wiring DAO", "Dao.setAcquiredAddress");
      const wiringTxHash = await sendAndWait("Dao.setAcquiredAddress", async () =>
        dao.setAcquiredAddress(deployed.proxyAddress, { gasLimit: gasLimit(config) }),
      );
      operations.push({ name: "Dao.setAcquiredAddress", status: "completed", tx_hash: wiringTxHash });
      record.wiring_tx_hash = wiringTxHash;
      return record;
    },
    provider,
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
