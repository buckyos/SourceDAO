import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

type UpgradeAction = "plan" | "deploy" | "prepare" | "support" | "reject" | "status" | "execute";
type ProposalMode = "current" | "legacy";
type ExecuteMode = "upgradeToAndCall" | "upgradeTo";
type TargetModule =
  | "dao"
  | "committee"
  | "devToken"
  | "normalToken"
  | "lockup"
  | "project"
  | "dividend"
  | "acquired"
  | "custom";

type CliOptions = {
  action: UpgradeAction;
  configPath: string;
  rpcUrl?: string;
  privateKey?: string;
  newImplementationAddress?: string;
  proposalId?: bigint;
  outputPath?: string;
};

type UpgradeCallConfig = {
  function: string;
  args?: unknown[];
};

type UpgradeTargetConfig = {
  module: TargetModule;
  proxyAddress?: string;
  artifactPath?: string;
  expectedCurrentVersion?: string;
  expectedNewVersion?: string;
};

type SourceDaoUpgradeConfig = {
  chainId: number;
  rpcUrl: string;
  privateKey?: string;
  artifactsDir?: string;
  daoAddress: string;
  target: UpgradeTargetConfig;
  proposalMode?: ProposalMode;
  executeMode?: ExecuteMode;
  newImplementationAddress?: string;
  upgradeCalldata?: string;
  upgradeCall?: UpgradeCallConfig;
  allowLegacyCalldata?: boolean;
  proposalId?: string | number;
  transactionGasLimit?: number;
  outputPath?: string;
};

type HardhatArtifact = {
  contractName?: string;
  abi: unknown[];
  bytecode?: string | { object?: string };
};

type PreparedUpgrade = {
  action: UpgradeAction;
  chainId: number;
  daoAddress: string;
  committeeAddress: string;
  targetModule: TargetModule;
  proxyAddress: string;
  currentImplementationAddress: string;
  currentVersion: string | null;
  newImplementationAddress: string | null;
  newImplementationVersion: string | null;
  proposalMode: ProposalMode;
  executeMode: ExecuteMode;
  upgradeCalldata: string;
  calldataHash: string;
  proposalId: string | null;
  proposalParams: string[];
  txHashes: Record<string, string>;
  finalImplementationAddress: string;
};

const DEFAULT_ARTIFACTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts",
);
const DEFAULT_TRANSACTION_GAS_LIMIT = 4_000_000n;
const ZERO_ADDRESS = ethers.ZeroAddress;
const EMPTY_CALLDATA = "0x";
const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const TARGET_ARTIFACTS: Record<Exclude<TargetModule, "custom">, string> = {
  dao: "contracts/Dao.sol/SourceDao.json",
  committee: "contracts/Committee.sol/SourceDaoCommittee.json",
  devToken: "contracts/DevToken.sol/DevToken.json",
  normalToken: "contracts/NormalToken.sol/NormalToken.json",
  lockup: "contracts/TokenLockup.sol/SourceTokenLockup.json",
  project: "contracts/Project.sol/ProjectManagement.json",
  dividend: "contracts/Dividend.sol/DividendContract.json",
  acquired: "contracts/Acquired.sol/Acquired.json",
};

function printHeader(title: string) {
  console.log(`\n=== ${title} ===`);
}

function parseCliOptions(argv: string[]): CliOptions {
  let action = (process.env.SOURCE_DAO_UPGRADE_ACTION?.trim() || "plan") as UpgradeAction;
  const envConfigPath = process.env.SOURCE_DAO_UPGRADE_CONFIG?.trim();
  let configPath = envConfigPath ? path.resolve(process.cwd(), envConfigPath) : "";
  let rpcUrl = process.env.SOURCE_DAO_UPGRADE_RPC_URL?.trim() || undefined;
  let privateKey = process.env.SOURCE_DAO_UPGRADE_PRIVATE_KEY?.trim() || undefined;
  let newImplementationAddress =
    process.env.SOURCE_DAO_UPGRADE_NEW_IMPLEMENTATION?.trim() || undefined;
  let proposalId =
    process.env.SOURCE_DAO_UPGRADE_PROPOSAL_ID?.trim()
      ? BigInt(process.env.SOURCE_DAO_UPGRADE_PROPOSAL_ID.trim())
      : undefined;
  let outputPath = process.env.SOURCE_DAO_UPGRADE_OUTPUT?.trim() || undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--action") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--action requires a value");
      action = next as UpgradeAction;
      index += 1;
      continue;
    }
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
    if (arg === "--private-key") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--private-key requires a key");
      privateKey = next;
      index += 1;
      continue;
    }
    if (arg === "--new-implementation") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--new-implementation requires an address");
      }
      newImplementationAddress = ethers.getAddress(next);
      index += 1;
      continue;
    }
    if (arg === "--proposal-id") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("--proposal-id requires an id");
      proposalId = BigInt(next);
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
    if (arg === "--help") {
      console.log(
        "Usage: tsx scripts/upgrade_existing_sourcedao.ts --config <file> --action <plan|deploy|prepare|support|reject|status|execute> [--rpc-url <url>] [--private-key <key>] [--new-implementation <address>] [--proposal-id <id>] [--output <file>]",
      );
      process.exit(0);
    }
  }

  const validActions: UpgradeAction[] = ["plan", "deploy", "prepare", "support", "reject", "status", "execute"];
  if (!validActions.includes(action)) {
    throw new Error(`Unsupported action: ${action}`);
  }
  if (!configPath) {
    throw new Error("Missing --config <file> or SOURCE_DAO_UPGRADE_CONFIG");
  }

  return { action, configPath, rpcUrl, privateKey, newImplementationAddress, proposalId, outputPath };
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

function normalizePrivateKey(privateKey: string): string {
  return privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
}

function gasLimit(config: SourceDaoUpgradeConfig): bigint {
  return BigInt(config.transactionGasLimit ?? Number(DEFAULT_TRANSACTION_GAS_LIMIT));
}

function moduleArtifactPath(target: UpgradeTargetConfig): string {
  const validModules: TargetModule[] = [
    "dao",
    "committee",
    "devToken",
    "normalToken",
    "lockup",
    "project",
    "dividend",
    "acquired",
    "custom",
  ];
  if (!validModules.includes(target.module)) {
    throw new Error(`Unsupported target.module: ${target.module}`);
  }
  if (target.artifactPath) return target.artifactPath;
  if (target.module === "custom") {
    throw new Error("target.artifactPath is required when target.module is custom");
  }
  return TARGET_ARTIFACTS[target.module];
}

function artifactBytecode(artifact: HardhatArtifact): string {
  if (typeof artifact.bytecode === "string") return artifact.bytecode;
  if (typeof artifact.bytecode?.object === "string") return artifact.bytecode.object;
  throw new Error(`Artifact ${artifact.contractName ?? "unknown"} has no deployable bytecode`);
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
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
  return { txHash: tx.hash, receipt };
}

async function getImplementationAddress(provider: ethers.JsonRpcProvider, proxyAddress: string): Promise<string> {
  const rawSlot = await provider.getStorage(proxyAddress, ERC1967_IMPLEMENTATION_SLOT);
  const implementation = ethers.getAddress(ethers.dataSlice(rawSlot, 12));
  return implementation;
}

function sameAddress(left: string, right: string): boolean {
  return ethers.getAddress(left) === ethers.getAddress(right);
}

function assertAddressEqual(label: string, actual: string, expected: string) {
  if (!sameAddress(actual, expected)) {
    throw new Error(`${label} mismatch: have ${actual}, expected ${expected}`);
  }
}

function assertHexData(value: string, label: string): string {
  if (!ethers.isHexString(value)) {
    throw new Error(`${label} must be hex data`);
  }
  return value;
}

function buildUpgradeParams(proxyAddress: string, implementationAddress: string, upgradeCalldata: string): string[] {
  return [
    ethers.zeroPadValue(proxyAddress, 32),
    ethers.zeroPadValue(implementationAddress, 32),
    ethers.keccak256(upgradeCalldata),
    ethers.encodeBytes32String("upgradeContract"),
  ];
}

function normalizeProposalMode(config: SourceDaoUpgradeConfig): ProposalMode {
  const mode = config.proposalMode ?? "current";
  if (mode !== "current" && mode !== "legacy") {
    throw new Error(`Unsupported proposalMode: ${mode}`);
  }
  return mode;
}

function normalizeExecuteMode(config: SourceDaoUpgradeConfig): ExecuteMode {
  const mode = config.executeMode ?? "upgradeToAndCall";
  if (mode !== "upgradeToAndCall" && mode !== "upgradeTo") {
    throw new Error(`Unsupported executeMode: ${mode}`);
  }
  return mode;
}

function normalizeProposalId(value: bigint | string | number | undefined): bigint | null {
  if (value === undefined) return null;
  return BigInt(value);
}

async function readVersion(
  runner: ethers.ContractRunner,
  artifact: HardhatArtifact,
  address: string,
): Promise<string | null> {
  try {
    const contract = new ethers.Contract(address, artifact.abi as ethers.InterfaceAbi, runner);
    const version = (await contract.version()) as string;
    return version;
  } catch {
    return null;
  }
}

function assertExpectedVersion(label: string, actual: string | null, expected?: string) {
  if (!expected) return;
  if (actual !== expected) {
    throw new Error(`${label} version mismatch: have ${actual ?? "<unreadable>"}, expected ${expected}`);
  }
}

function method(contract: ethers.Contract, name: string): ethers.BaseContractMethod {
  const candidate = (contract as unknown as Record<string, ethers.BaseContractMethod>)[name];
  if (!candidate) {
    throw new Error(`Contract ABI missing method: ${name}`);
  }
  return candidate;
}

async function resolveTargetProxy(
  config: SourceDaoUpgradeConfig,
  dao: ethers.Contract,
): Promise<string> {
  if (config.target.proxyAddress) {
    return ethers.getAddress(config.target.proxyAddress);
  }

  switch (config.target.module) {
    case "dao":
      return ethers.getAddress(config.daoAddress);
    case "committee":
      return ethers.getAddress((await dao.committee()) as string);
    case "devToken":
      return ethers.getAddress((await dao.devToken()) as string);
    case "normalToken":
      return ethers.getAddress((await dao.normalToken()) as string);
    case "lockup":
      return ethers.getAddress((await dao.lockup()) as string);
    case "project":
      return ethers.getAddress((await dao.project()) as string);
    case "dividend":
      return ethers.getAddress((await dao.dividend()) as string);
    case "acquired":
      return ethers.getAddress((await dao.acquired()) as string);
    case "custom":
      throw new Error("target.proxyAddress is required when target.module is custom");
  }
}

function encodeUpgradeCalldata(config: SourceDaoUpgradeConfig, artifact: HardhatArtifact): string {
  if (config.upgradeCalldata && config.upgradeCall) {
    throw new Error("Use either upgradeCalldata or upgradeCall, not both");
  }
  if (config.upgradeCalldata) {
    return assertHexData(config.upgradeCalldata, "upgradeCalldata");
  }
  if (config.upgradeCall) {
    const iface = new ethers.Interface(artifact.abi as ethers.InterfaceAbi);
    return iface.encodeFunctionData(config.upgradeCall.function, config.upgradeCall.args ?? []);
  }
  return EMPTY_CALLDATA;
}

async function deployImplementation(
  wallet: ethers.Wallet,
  artifact: HardhatArtifact,
  config: SourceDaoUpgradeConfig,
): Promise<{ address: string; txHash: string }> {
  const factory = new ethers.ContractFactory(
    artifact.abi as ethers.InterfaceAbi,
    artifactBytecode(artifact),
    wallet,
  );
  const implementation = await factory.deploy({ gasLimit: gasLimit(config) });
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();
  const txHash = implementation.deploymentTransaction()?.hash ?? "";
  console.log(`Implementation deployed: ${implementationAddress}`);
  console.log(`Implementation tx     : ${txHash || "<unknown>"}`);
  return { address: implementationAddress, txHash };
}

function extractProposalId(receipt: ethers.TransactionReceipt, committee: ethers.Contract): bigint | null {
  for (const log of receipt.logs) {
    try {
      const parsed = committee.interface.parseLog(log);
      if (parsed && parsed.name === "ProposalStart") {
        return parsed.args.proposalId as bigint;
      }
    } catch {
      // Ignore logs from other contracts.
    }
  }
  return null;
}

async function prepareUpgradeProposal(
  committee: ethers.Contract,
  proxyAddress: string,
  implementationAddress: string,
  upgradeCalldata: string,
  proposalMode: ProposalMode,
  config: SourceDaoUpgradeConfig,
) {
  if (proposalMode === "legacy") {
    if (upgradeCalldata !== EMPTY_CALLDATA && !config.allowLegacyCalldata) {
      throw new Error(
        "legacy proposal mode does not approve calldata; set allowLegacyCalldata=true only after committee review",
      );
    }
    const prepare = committee["prepareContractUpgrade(address,address)"] as ethers.BaseContractMethod;
    await prepare.staticCall(proxyAddress, implementationAddress);
    return sendAndWait("Committee.prepareContractUpgrade", async () =>
      prepare(proxyAddress, implementationAddress, { gasLimit: gasLimit(config) }) as Promise<ethers.ContractTransactionResponse>,
    );
  }

  const calldataHash = ethers.keccak256(upgradeCalldata);
  const prepare = committee["prepareContractUpgrade(address,address,bytes32)"] as ethers.BaseContractMethod;
  await prepare.staticCall(proxyAddress, implementationAddress, calldataHash);
  return sendAndWait("Committee.prepareContractUpgrade", async () =>
    prepare(proxyAddress, implementationAddress, calldataHash, { gasLimit: gasLimit(config) }) as Promise<ethers.ContractTransactionResponse>,
  );
}

async function voteUpgradeProposal(
  committee: ethers.Contract,
  proposalId: bigint,
  params: string[],
  vote: "support" | "reject",
  config: SourceDaoUpgradeConfig,
) {
  const voteMethod = method(committee, vote);
  await voteMethod.staticCall(proposalId, params);
  return sendAndWait(`Committee.${vote}`, async () =>
    voteMethod(proposalId, params, { gasLimit: gasLimit(config) }) as Promise<ethers.ContractTransactionResponse>,
  );
}

async function executeUpgrade(
  targetProxy: ethers.Contract,
  implementationAddress: string,
  upgradeCalldata: string,
  executeMode: ExecuteMode,
  config: SourceDaoUpgradeConfig,
) {
  if (executeMode === "upgradeTo") {
    if (upgradeCalldata !== EMPTY_CALLDATA) {
      throw new Error("executeMode=upgradeTo cannot be used with non-empty upgrade calldata");
    }
    const upgradeTo = method(targetProxy, "upgradeTo");
    await upgradeTo.staticCall(implementationAddress);
    return sendAndWait("Proxy.upgradeTo", async () =>
      upgradeTo(implementationAddress, { gasLimit: gasLimit(config) }) as Promise<ethers.ContractTransactionResponse>,
    );
  }

  const upgradeToAndCall = method(targetProxy, "upgradeToAndCall");
  await upgradeToAndCall.staticCall(implementationAddress, upgradeCalldata);
  return sendAndWait("Proxy.upgradeToAndCall", async () =>
    upgradeToAndCall(implementationAddress, upgradeCalldata, { gasLimit: gasLimit(config) }) as Promise<ethers.ContractTransactionResponse>,
  );
}

async function writeOutput(outputPath: string | undefined, summary: PreparedUpgrade) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, jsonReplacer, 2)}\n`, "utf8");
  console.log(`Wrote upgrade summary: ${outputPath}`);
}

function printSummary(summary: PreparedUpgrade) {
  printHeader("Upgrade summary");
  console.log(`Action                 ${summary.action}`);
  console.log(`Chain ID               ${summary.chainId}`);
  console.log(`DAO                    ${summary.daoAddress}`);
  console.log(`Committee              ${summary.committeeAddress}`);
  console.log(`Target module          ${summary.targetModule}`);
  console.log(`Proxy                  ${summary.proxyAddress}`);
  console.log(`Current implementation ${summary.currentImplementationAddress}`);
  console.log(`Current version        ${summary.currentVersion ?? "<unreadable>"}`);
  console.log(`New implementation     ${summary.newImplementationAddress ?? "<not deployed/provided>"}`);
  console.log(`New version            ${summary.newImplementationVersion ?? "<unreadable>"}`);
  console.log(`Proposal mode          ${summary.proposalMode}`);
  console.log(`Execute mode           ${summary.executeMode}`);
  console.log(`Calldata hash          ${summary.calldataHash}`);
  console.log(`Proposal ID            ${summary.proposalId ?? "<unknown>"}`);
  console.log(`Proposal params        ${JSON.stringify(summary.proposalParams)}`);
  console.log(`Final implementation   ${summary.finalImplementationAddress}`);
  for (const [name, hash] of Object.entries(summary.txHashes)) {
    console.log(`${name.padEnd(22)} ${hash}`);
  }
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const sourceConfig = await loadJsonFile<SourceDaoUpgradeConfig>(options.configPath);
  const config: SourceDaoUpgradeConfig = {
    ...sourceConfig,
    rpcUrl: options.rpcUrl ?? sourceConfig.rpcUrl,
    privateKey: options.privateKey ?? sourceConfig.privateKey,
    newImplementationAddress: options.newImplementationAddress ?? sourceConfig.newImplementationAddress,
    proposalId: options.proposalId?.toString() ?? sourceConfig.proposalId,
    outputPath: options.outputPath ?? sourceConfig.outputPath,
  };
  const artifactsDir = normalizeArtifactsDir(options.configPath, config.artifactsDir);
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== config.chainId) {
    throw new Error(`unexpected chainId ${chainId}, expected ${config.chainId}`);
  }

  const requiresSigner = ["deploy", "prepare", "support", "reject", "execute"].includes(options.action);
  const privateKey = config.privateKey?.trim();
  if (requiresSigner && !privateKey) {
    throw new Error(`${options.action} requires privateKey in config, env, or --private-key`);
  }
  const wallet = privateKey ? new ethers.Wallet(normalizePrivateKey(privateKey), provider) : null;
  const runner = wallet ?? provider;

  const daoArtifact = await loadArtifact(artifactsDir, TARGET_ARTIFACTS.dao);
  const targetArtifactPath = moduleArtifactPath(config.target);
  const targetArtifact = await loadArtifact(artifactsDir, targetArtifactPath);
  const dao = new ethers.Contract(config.daoAddress, daoArtifact.abi as ethers.InterfaceAbi, runner);
  const committeeAddress = ethers.getAddress((await dao.committee()) as string);
  const committeeArtifact = await loadArtifact(artifactsDir, TARGET_ARTIFACTS.committee);
  const committee = new ethers.Contract(committeeAddress, committeeArtifact.abi as ethers.InterfaceAbi, runner);
  const proxyAddress = await resolveTargetProxy(config, dao);

  await ensureCode(provider, config.daoAddress, "DAO");
  await ensureCode(provider, committeeAddress, "Committee");
  await ensureCode(provider, proxyAddress, "Target proxy");

  const currentImplementationAddress = await getImplementationAddress(provider, proxyAddress);
  if (sameAddress(currentImplementationAddress, ZERO_ADDRESS)) {
    throw new Error(`Target proxy ${proxyAddress} does not expose an ERC1967 implementation address`);
  }
  await ensureCode(provider, currentImplementationAddress, "Current implementation");

  const currentVersion = await readVersion(runner, targetArtifact, proxyAddress);
  assertExpectedVersion("current proxy", currentVersion, config.target.expectedCurrentVersion);

  const upgradeCalldata = encodeUpgradeCalldata(config, targetArtifact);
  const proposalMode = normalizeProposalMode(config);
  const executeMode = normalizeExecuteMode(config);
  let newImplementationAddress = config.newImplementationAddress
    ? ethers.getAddress(config.newImplementationAddress)
    : null;
  const txHashes: Record<string, string> = {};
  let proposalId = normalizeProposalId(options.proposalId ?? config.proposalId);

  printHeader("Upgrade config");
  console.log(`RPC URL                ${config.rpcUrl}`);
  console.log(`Artifacts dir          ${artifactsDir}`);
  console.log(`Signer                 ${wallet?.address ?? "<read-only>"}`);
  console.log(`Target artifact        ${targetArtifactPath}`);

  if (options.action === "deploy" || options.action === "prepare") {
    if (!wallet) throw new Error(`${options.action} requires a signer`);
    if (!newImplementationAddress) {
      printHeader("Deploy implementation");
      const deployed = await deployImplementation(wallet, targetArtifact, config);
      newImplementationAddress = deployed.address;
      if (deployed.txHash) {
        txHashes.deployImplementation = deployed.txHash;
      }
    }
  }

  if (newImplementationAddress) {
    await ensureCode(provider, newImplementationAddress, "New implementation");
  }
  const newImplementationVersion = newImplementationAddress
    ? await readVersion(runner, targetArtifact, newImplementationAddress)
    : null;
  if (newImplementationAddress) {
    assertExpectedVersion("new implementation", newImplementationVersion, config.target.expectedNewVersion);
  }

  const proposalParams = newImplementationAddress
    ? buildUpgradeParams(proxyAddress, newImplementationAddress, upgradeCalldata)
    : [];

  if (proposalMode === "legacy" && upgradeCalldata !== EMPTY_CALLDATA && !config.allowLegacyCalldata) {
    throw new Error(
      "legacy proposal mode with non-empty calldata requires allowLegacyCalldata=true",
    );
  }

  if (options.action === "prepare") {
    if (!wallet) throw new Error("prepare requires a signer");
    if (!newImplementationAddress) throw new Error("prepare requires a new implementation");
    printHeader("Prepare upgrade proposal");
    const { txHash, receipt } = await prepareUpgradeProposal(
      committee,
      proxyAddress,
      newImplementationAddress,
      upgradeCalldata,
      proposalMode,
      config,
    );
    txHashes.prepareProposal = txHash;
    proposalId = extractProposalId(receipt, committee) ?? proposalId;
  }

  if (options.action === "support" || options.action === "reject") {
    if (!wallet) throw new Error(`${options.action} requires a signer`);
    if (!newImplementationAddress) throw new Error(`${options.action} requires newImplementationAddress`);
    if (proposalId === null) throw new Error(`${options.action} requires proposalId`);
    printHeader(`${options.action === "support" ? "Support" : "Reject"} upgrade proposal`);
    const { txHash } = await voteUpgradeProposal(
      committee,
      proposalId,
      proposalParams,
      options.action,
      config,
    );
    txHashes[options.action] = txHash;
  }

  if (options.action === "status") {
    printHeader("Queued upgrade proposal");
    try {
      const queued = await committee.getContractUpgradeProposal(proxyAddress);
      console.log(JSON.stringify(queued, jsonReplacer, 2));
    } catch (error) {
      console.log(`Could not read queued proposal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (options.action === "execute") {
    if (!wallet) throw new Error("execute requires a signer");
    if (!newImplementationAddress) throw new Error("execute requires newImplementationAddress");
    const targetProxy = new ethers.Contract(
      proxyAddress,
      [
        "function upgradeToAndCall(address newImplementation, bytes data) payable",
        "function upgradeTo(address newImplementation)",
        "function version() view returns (string)",
      ],
      wallet,
    );
    printHeader("Execute proxy upgrade");
    const { txHash } = await executeUpgrade(
      targetProxy,
      newImplementationAddress,
      upgradeCalldata,
      executeMode,
      config,
    );
    txHashes.executeUpgrade = txHash;
    const implementationAfter = await getImplementationAddress(provider, proxyAddress);
    assertAddressEqual("implementation after upgrade", implementationAfter, newImplementationAddress);
  }

  const finalImplementationAddress = await getImplementationAddress(provider, proxyAddress);
  const finalVersion = await readVersion(runner, targetArtifact, proxyAddress);
  const summary: PreparedUpgrade = {
    action: options.action,
    chainId,
    daoAddress: ethers.getAddress(config.daoAddress),
    committeeAddress,
    targetModule: config.target.module,
    proxyAddress,
    currentImplementationAddress,
    currentVersion,
    newImplementationAddress,
    newImplementationVersion:
      options.action === "execute" ? finalVersion : newImplementationVersion,
    proposalMode,
    executeMode,
    upgradeCalldata,
    calldataHash: ethers.keccak256(upgradeCalldata),
    proposalId: proposalId?.toString() ?? null,
    proposalParams,
    txHashes,
    finalImplementationAddress,
  };

  printSummary(summary);
  await writeOutput(config.outputPath, summary);
}

main().catch((error) => {
  console.error("\nExisting SourceDAO upgrade script failed.");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
