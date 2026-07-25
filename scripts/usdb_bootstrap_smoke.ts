import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

type CliOptions = {
    configPath: string;
    rpcUrl?: string;
};

type USDBLocalConfig = {
    schemaVersion: number;
    chainId: number;
    rpcUrl: string;
    artifactsDir?: string;
    daoAddress: string;
    dividendAddress: string;
    bootstrapAdminAddress: string;
    cycleMinLength: number;
    nativeDepositWei: string;
    transactionGasLimit?: number;
    nativeTransferGasLimit?: number;
};

type HardhatArtifact = {
    contractName?: string;
    abi: unknown[];
};

const ZERO_ADDRESS = ethers.ZeroAddress;
const DEFAULT_CONFIG_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../tools/config/sourcedao-local.json",
);
const DEFAULT_ARTIFACTS_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../artifacts-usdb",
);
const DEFAULT_TRANSACTION_GAS_LIMIT = 8_000_000n;
const DEFAULT_NATIVE_TRANSFER_GAS_LIMIT = 200_000n;
const BOOTSTRAP_PRIVATE_KEY_ENV = "SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY";
const SOURCE_DAO_BOOTSTRAP_SCHEMA_VERSION = 1;

function printHeader(title: string) {
    console.log(`\n=== ${title} ===`);
}

function parseCliOptions(argv: string[]): CliOptions {
    let configPath =
        process.env.SOURCE_DAO_USDB_CONFIG?.trim() || DEFAULT_CONFIG_PATH;
    let rpcUrl = process.env.SOURCE_DAO_USDB_RPC_URL?.trim() || undefined;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--config") {
            const next = argv[index + 1];
            if (!next || next.startsWith("--")) {
                throw new Error("--config requires a file path");
            }
            configPath = path.resolve(process.cwd(), next);
            index += 1;
            continue;
        }
        if (arg === "--rpc-url") {
            const next = argv[index + 1];
            if (!next || next.startsWith("--")) {
                throw new Error("--rpc-url requires a URL");
            }
            rpcUrl = next;
            index += 1;
        }
    }

    return { configPath, rpcUrl };
}

async function loadJsonFile<T>(filePath: string): Promise<T> {
    const blob = await readFile(filePath, "utf8");
    return JSON.parse(blob) as T;
}

function assertPublicBootstrapConfig(config: unknown): asserts config is USDBLocalConfig {
    if (config === null || typeof config !== "object") {
        throw new Error("SourceDAO bootstrap config must be a JSON object");
    }
    if ("bootstrapAdminPrivateKey" in config) {
        throw new Error(
            `bootstrapAdminPrivateKey is forbidden in config; inject ${BOOTSTRAP_PRIVATE_KEY_ENV} at runtime`,
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
    if (!artifactsDir) {
        return DEFAULT_ARTIFACTS_DIR;
    }
    if (path.isAbsolute(artifactsDir)) {
        return artifactsDir;
    }
    return path.resolve(path.dirname(configPath), artifactsDir);
}

async function ensureCode(provider: ethers.JsonRpcProvider, address: string, label: string) {
    const code = await provider.getCode(address);
    if (code === "0x") {
        throw new Error(`${label} at ${address} has no deployed code`);
    }
}

function loadBootstrapPrivateKey() {
    const configured = process.env[BOOTSTRAP_PRIVATE_KEY_ENV]?.trim();
    if (!configured) {
        throw new Error(`${BOOTSTRAP_PRIVATE_KEY_ENV} is required`);
    }
    return configured.startsWith("0x") ? configured : `0x${configured}`;
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
}

async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const sourceConfig = await loadJsonFile<unknown>(options.configPath);
    assertPublicBootstrapConfig(sourceConfig);
    const config = sourceConfig;
    const artifactsDir = normalizeArtifactsDir(options.configPath, config.artifactsDir);
    const rpcUrl = options.rpcUrl || config.rpcUrl;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    if (chainId !== config.chainId) {
        throw new Error(`unexpected chainId ${chainId}, expected ${config.chainId}`);
    }

    const expectedBootstrapAdmin = ethers.getAddress(config.bootstrapAdminAddress);
    const wallet = new ethers.Wallet(loadBootstrapPrivateKey(), provider);
    if (wallet.address !== expectedBootstrapAdmin) {
        throw new Error(
            `bootstrap signer mismatch: derived ${wallet.address}, expected ${expectedBootstrapAdmin}`,
        );
    }
    const daoArtifact = await loadArtifact(artifactsDir, "contracts/Dao.sol/SourceDao.json");
    const dividendArtifact = await loadArtifact(artifactsDir, "contracts/Dividend.sol/DividendContract.json");

    const dao = new ethers.Contract(config.daoAddress, daoArtifact.abi, wallet);
    const dividend = new ethers.Contract(config.dividendAddress, dividendArtifact.abi, wallet);

    printHeader("USDB bootstrap config");
    console.log(`RPC URL            ${rpcUrl}`);
    console.log(`Chain ID           ${config.chainId}`);
    console.log(`Artifacts dir      ${artifactsDir}`);
    console.log(`Bootstrap admin    ${wallet.address}`);
    console.log(`DAO                ${config.daoAddress}`);
    console.log(`Dividend           ${config.dividendAddress}`);
    console.log(`Cycle min length   ${config.cycleMinLength}`);

    printHeader("Preflight checks");
    await ensureCode(provider, config.daoAddress, "DAO");
    await ensureCode(provider, config.dividendAddress, "Dividend");

    const daoBootstrapAdmin = await dao.bootstrapAdmin();
    if (daoBootstrapAdmin === ZERO_ADDRESS) {
        await dao.initialize.staticCall();
        await sendAndWait("Dao.initialize", async () =>
            dao.initialize({
                gasLimit: BigInt(config.transactionGasLimit ?? Number(DEFAULT_TRANSACTION_GAS_LIMIT)),
            }),
        );
    } else if (daoBootstrapAdmin.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error(`dao bootstrap admin mismatch: have ${daoBootstrapAdmin}, expected ${wallet.address}`);
    } else {
        console.log(`Dao.initialize: already initialized by ${daoBootstrapAdmin}`);
    }

    const cycleMinLength = BigInt(await dividend.cycleMinLength());
    if (cycleMinLength === 0n) {
        await dividend.initialize.staticCall(config.cycleMinLength, config.daoAddress);
        await sendAndWait("Dividend.initialize", async () =>
            dividend.initialize(config.cycleMinLength, config.daoAddress, {
                gasLimit: BigInt(config.transactionGasLimit ?? Number(DEFAULT_TRANSACTION_GAS_LIMIT)),
            }),
        );
    } else if (cycleMinLength !== BigInt(config.cycleMinLength)) {
        throw new Error(`dividend cycleMinLength mismatch: have ${cycleMinLength}, expected ${config.cycleMinLength}`);
    } else {
        console.log(`Dividend.initialize: already initialized with cycleMinLength=${cycleMinLength}`);
    }

    const daoDividend = await dao.dividend();
    if (daoDividend === ZERO_ADDRESS) {
        await dao.setTokenDividendAddress.staticCall(config.dividendAddress);
        await sendAndWait("Dao.setTokenDividendAddress", async () =>
            dao.setTokenDividendAddress(config.dividendAddress, {
                gasLimit: BigInt(config.transactionGasLimit ?? Number(DEFAULT_TRANSACTION_GAS_LIMIT)),
            }),
        );
    } else if (daoDividend.toLowerCase() !== config.dividendAddress.toLowerCase()) {
        throw new Error(`dao dividend mismatch: have ${daoDividend}, expected ${config.dividendAddress}`);
    } else {
        console.log(`Dao.setTokenDividendAddress: already wired to ${daoDividend}`);
    }

    const bootstrappedAdmin = await dao.bootstrapAdmin();
    const bootstrappedDividend = await dao.dividend();
    const currentCycleIndex = await dividend.getCurrentCycleIndex();

    if (bootstrappedAdmin.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error(`unexpected bootstrap admin after initialization: ${bootstrappedAdmin}`);
    }
    if (bootstrappedDividend.toLowerCase() !== config.dividendAddress.toLowerCase()) {
        throw new Error(`unexpected dao dividend after initialization: ${bootstrappedDividend}`);
    }

    printHeader("Native deposit smoke");
    const nativeDepositWei = BigInt(config.nativeDepositWei);
    const beforeBalance = await provider.getBalance(config.dividendAddress);
    await sendAndWait("Dividend native deposit", async () =>
        wallet.sendTransaction({
            to: config.dividendAddress,
            value: nativeDepositWei,
            gasLimit: BigInt(config.nativeTransferGasLimit ?? Number(DEFAULT_NATIVE_TRANSFER_GAS_LIMIT)),
        }),
    );
    const afterBalance = await provider.getBalance(config.dividendAddress);
    const balanceDelta = afterBalance - beforeBalance;
    if (balanceDelta < nativeDepositWei) {
        throw new Error(`dividend native balance delta too small: have ${balanceDelta}, expected at least ${nativeDepositWei}`);
    }

    printHeader("Smoke summary");
    console.log(`Bootstrap admin    ${bootstrappedAdmin}`);
    console.log(`DAO dividend       ${bootstrappedDividend}`);
    console.log(`Current cycle      ${currentCycleIndex}`);
    console.log(`Native deposit     ${nativeDepositWei}`);
    console.log(`Balance delta      ${balanceDelta}`);
    console.log("USDB bootstrap smoke succeeded.");
}

main().catch((error) => {
    console.error("\nUSDB bootstrap smoke failed.");
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});
