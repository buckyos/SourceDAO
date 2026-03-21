import hre from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers } = await hre.network.connect("localhost");

const PROJECT_NAME = ethers.encodeBytes32String("Buckyos");
const VERSION_ONE = 100001;
const VERSION_TWO = 100002;
const ONE_HOUR = 3600;
const DEFAULT_FRONTEND_ENV_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../buckydaowww/src/.env.local",
);
const DEFAULT_FRONTEND_SERVER_URL = "http://127.0.0.1:3333";
const DEFAULT_HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
const TOKEN_DECIMALS = 18;

function tokenUnits(value: number | string | bigint) {
    return ethers.parseUnits(value.toString(), TOKEN_DECIMALS);
}

type CliOptions = {
    writeFrontendEnv: boolean;
    frontendEnvOutput?: string;
};

function printHeader(title: string) {
    console.log(`\n=== ${title} ===`);
}

function deriveDefaultHardhatAccounts(count: number) {
    const accounts = new Map<string, string>();
    for (let index = 0; index < count; index += 1) {
        const wallet = ethers.HDNodeWallet.fromPhrase(
            DEFAULT_HARDHAT_MNEMONIC,
            undefined,
            `m/44'/60'/0'/0/${index}`,
        );
        accounts.set(wallet.address.toLowerCase(), wallet.privateKey);
    }
    return accounts;
}

function buildProjectParams(
    projectId: bigint,
    projectName: string,
    version: bigint,
    startDate: bigint,
    endDate: bigint,
    action: string,
) {
    return [
        ethers.zeroPadValue(ethers.toBeHex(projectId), 32),
        projectName,
        ethers.zeroPadValue(ethers.toBeHex(version), 32),
        ethers.zeroPadValue(ethers.toBeHex(startDate), 32),
        ethers.zeroPadValue(ethers.toBeHex(endDate), 32),
        ethers.encodeBytes32String(action),
    ];
}

function parseCliOptions(argv: string[]): CliOptions {
    const options: CliOptions = { writeFrontendEnv: false };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--write-frontend-env") {
            options.writeFrontendEnv = true;
            const next = argv[i + 1];
            if (next && !next.startsWith("--")) {
                options.frontendEnvOutput = next;
                i += 1;
            }
            continue;
        }

        if (arg === "--frontend-env-output") {
            const next = argv[i + 1];
            if (!next || next.startsWith("--")) {
                throw new Error("--frontend-env-output requires a file path");
            }
            options.writeFrontendEnv = true;
            options.frontendEnvOutput = next;
            i += 1;
        }
    }

    return options;
}

function resolveEnvOutputPath(options: CliOptions): string | undefined {
    const envOutput =
        process.env.FRONTEND_ENV_OUTPUT?.trim()
        || process.env.npm_config_frontend_env_output?.trim();
    if (envOutput) {
        if (envOutput === "default") {
            return DEFAULT_FRONTEND_ENV_PATH;
        }
        return path.resolve(process.cwd(), envOutput);
    }

    if (!options.writeFrontendEnv) {
        return undefined;
    }

    if (!options.frontendEnvOutput) {
        return DEFAULT_FRONTEND_ENV_PATH;
    }

    return path.resolve(process.cwd(), options.frontendEnvOutput);
}

async function main() {
    const cliOptions = parseCliOptions(process.argv.slice(2));
    const frontendServerUrl =
        process.env.FRONTEND_BACKEND_URL?.trim() || DEFAULT_FRONTEND_SERVER_URL;
    const localAuthMode =
        process.env.FRONTEND_LOCAL_AUTH_MODE?.trim()
        || process.env.SOURCE_DAO_LOCAL_AUTH_MODE?.trim()
        || "dev";
    const signers = await ethers.getSigners();
    const [deployer, committeeTwo, committeeThree, viewer] = signers;

    printHeader("Deploying SourceDAO local stack for frontend");

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        [deployer.address, committeeTwo.address, committeeThree.address],
        1,
        200,
        PROJECT_NAME,
        VERSION_TWO,
        150,
        daoAddress,
    ]);

    const project = await deployUUPSProxy(ethers, "ProjectManagement", [1, daoAddress]);
    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "Bucky Dev Token",
        "BDDT",
        tokenUnits(1_000_000),
        [deployer.address, committeeTwo.address, committeeThree.address],
        [tokenUnits(50_000), tokenUnits(20_000), tokenUnits(20_000)],
        daoAddress,
    ]);
    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["Bucky Token", "BDT", daoAddress]);
    const lockup = await deployUUPSProxy(ethers, "SourceTokenLockup", [PROJECT_NAME, VERSION_TWO, daoAddress]);
    const dividend = await deployUUPSProxy(ethers, "DividendContract", [ONE_HOUR, daoAddress]);
    const acquired = await deployUUPSProxy(ethers, "Acquired", [1, daoAddress]);

    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();
    await (await dao.setProjectAddress(await project.getAddress())).wait();
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();
    await (await dao.setTokenLockupAddress(await lockup.getAddress())).wait();
    await (await dao.setTokenDividendAddress(await dividend.getAddress())).wait();
    await (await dao.setAcquiredAddress(await acquired.getAddress())).wait();

    // Seed a small amount of BDT so a non-committee wallet can still exercise
    // balance reads and token-holder gated UI.
    await (await devToken.dev2normal(tokenUnits(5_000))).wait();
    await (await normalToken.transfer(viewer.address, tokenUnits(1_000))).wait();

    // Seed a lockup position for the viewer so /user/info shows assigned/locked
    // values without requiring a separate backend flow.
    await (await normalToken.approve(await lockup.getAddress(), tokenUnits(250))).wait();
    await (await lockup.transferAndLock([viewer.address], [tokenUnits(250)])).wait();

    // Seed a finished project that pays dev rewards to the viewer. This makes
    // the local chain useful for committee recognition + project reward reads
    // without requiring the proposal backend.
    const now = BigInt(Math.floor(Date.now() / 1000));
    const startDate = now - 2n * 24n * 60n * 60n;
    const endDate = now - 1n * 24n * 60n * 60n;
    await (await project.createProject(tokenUnits(600), PROJECT_NAME, VERSION_ONE, startDate, endDate, [], [])).wait();
    const createBrief = await project.projectOf(1);
    const createParams = buildProjectParams(
        1n,
        PROJECT_NAME,
        BigInt(VERSION_ONE),
        startDate,
        endDate,
        "createProject",
    );
    await (await committee.support(createBrief.proposalId, createParams)).wait();
    await (await committee.connect(committeeTwo).support(createBrief.proposalId, createParams)).wait();
    await (await project.promoteProject(1)).wait();

    await (
        await project.acceptProject(1, 4, [{ contributor: viewer.address, value: 100 }])
    ).wait();
    const acceptBrief = await project.projectOf(1);
    const acceptParams = buildProjectParams(
        1n,
        PROJECT_NAME,
        BigInt(VERSION_ONE),
        startDate,
        endDate,
        "acceptProject",
    );
    await (await committee.support(acceptBrief.proposalId, acceptParams)).wait();
    await (await committee.connect(committeeTwo).support(acceptBrief.proposalId, acceptParams)).wait();
    await (await project.promoteProject(1)).wait();
    await (await project.connect(viewer).withdrawContributions([1])).wait();

    const viewerDevToken = await devToken.balanceOf(viewer.address);
    const viewerNormalToken = await normalToken.balanceOf(viewer.address);
    const viewerAssignedLockup = await lockup.totalAssigned(viewer.address);
    const localPrivateKeys = deriveDefaultHardhatAccounts(signers.length);

    printHeader("Module addresses");
    console.log("SourceDao        ", daoAddress);
    console.log("Committee        ", await committee.getAddress());
    console.log("Project          ", await project.getAddress());
    console.log("DevToken         ", await devToken.getAddress());
    console.log("NormalToken      ", await normalToken.getAddress());
    console.log("Lockup           ", await lockup.getAddress());
    console.log("Dividend         ", await dividend.getAddress());
    console.log("Acquired         ", await acquired.getAddress());

    printHeader("Suggested frontend .env.local");
    const frontendEnvLines = [
        `NEXT_PUBLIC_CHAIN='Hardhat Local'`,
        `NEXT_PUBLIC_NETWORK_ID='31337'`,
        `NEXT_PUBLIC_LOCAL_AUTH_MODE='${localAuthMode}'`,
        `NEXT_PUBLIC_RPC_URL='http://127.0.0.1:8545'`,
        `NEXT_PUBLIC_SERVER='${frontendServerUrl}'`,
        `NEXT_PUBLIC_MAIN='${daoAddress}'`,
        `NEXT_PUBLIC_COMMITTEE='${await committee.getAddress()}'`,
        `NEXT_PUBLIC_DEV_TOKEN='${await devToken.getAddress()}'`,
        `NEXT_PUBLIC_NORMAL_TOKEN='${await normalToken.getAddress()}'`,
        `NEXT_PUBLIC_ACQUIRED='${await acquired.getAddress()}'`,
        `NEXT_PUBLIC_LOCKUP='${await lockup.getAddress()}'`,
        `NEXT_PUBLIC_DIVIDEND='${await dividend.getAddress()}'`,
        `NEXT_PUBLIC_PROJECT='${await project.getAddress()}'`,
        `NEXT_PUBLIC_TOKEN_ADDRESS_LINK=''`,
        `NEXT_PUBLIC_ADDRESS_LINK=''`,
    ];
    console.log(frontendEnvLines.join("\n"));

    const envOutputPath = resolveEnvOutputPath(cliOptions);
    if (envOutputPath) {
        await mkdir(path.dirname(envOutputPath), { recursive: true });
        await writeFile(envOutputPath, `${frontendEnvLines.join("\n")}\n`, "utf8");
        printHeader("Wrote frontend env file");
        console.log(envOutputPath);
    }

    printHeader("Seeded local-chain state");
    console.log(`Viewer dev token balance    : ${viewerDevToken}`);
    console.log(`Viewer normal token balance : ${viewerNormalToken}`);
    console.log(`Viewer assigned lockup      : ${viewerAssignedLockup}`);
    console.log(`Sample finished project ID  : 1`);

    printHeader("Useful local accounts");
    const usefulAccounts = [
        ["Deployer / committee member 1", deployer.address],
        ["Committee member 2", committeeTwo.address],
        ["Committee member 3", committeeThree.address],
        ["Viewer / token holder", viewer.address],
    ] as const;
    for (const [label, address] of usefulAccounts) {
        const privateKey = localPrivateKeys.get(address.toLowerCase()) ?? "<private key unavailable>";
        console.log(`${label.padEnd(30)}: ${address}`);
        console.log(`${"Private key".padEnd(30)}: ${privateKey}`);
        console.log("");
    }

    printHeader("Full local accounts");
    const namedAccounts = new Map<string, string>([
        [deployer.address.toLowerCase(), "deployer / committee member 1"],
        [committeeTwo.address.toLowerCase(), "committee member 2"],
        [committeeThree.address.toLowerCase(), "committee member 3"],
        [viewer.address.toLowerCase(), "viewer / token holder"],
    ]);
    signers.forEach((signer, index) => {
        const address = signer.address;
        const privateKey = localPrivateKeys.get(address.toLowerCase()) ?? "<private key unavailable>";
        const label = namedAccounts.get(address.toLowerCase()) ?? `account ${index}`;
        console.log(`[${index}] ${label}`);
        console.log(`  Address     : ${address}`);
        console.log(`  Private key : ${privateKey}`);
    });

    console.log("\nYou can import any of the above private keys into MetaMask or OKX Wallet.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
