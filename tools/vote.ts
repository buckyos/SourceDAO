import { exit } from "node:process";
import { createInterface } from "node:readline/promises";

import hre from "hardhat";

const DEFAULT_DAO_ADDRESS = "0x2fc3186176B80EA829A7952b874F36f7cb8bd184";
const DEFAULT_PROPOSAL_API_BASE = "https://dao.buckyos.org/api";

type SupportedProposalType =
    | "createProject"
    | "acceptProject"
    | "upgradeContract"
    | "setCommittees";

interface ProposalApiSuccess {
    code: 0;
    data: {
        params: unknown[];
    };
    message?: string;
}

interface ProposalApiFailure {
    code: number;
    message?: string;
    data?: {
        params?: unknown[];
    };
}

type ProposalApiResponse = ProposalApiSuccess | ProposalApiFailure;

const connection = await hre.network.connect();
const { ethers } = connection;

function convertVersion(version: string): number {
    const segments = version.split(".");
    if (segments.length < 3) {
        throw new Error(`Invalid version format: ${version}. Expected format is 'major.minor.patch'.`);
    }

    const major = parseInt(segments[0], 10);
    const minor = parseInt(segments[1], 10);
    const patch = parseInt(segments[2], 10);

    return major * 10000000000 + minor * 100000 + patch;
}

function zeroPadUint256(value: number | string | bigint): string {
    const hex = ethers.toBeHex(ethers.toBigInt(value));
    return ethers.zeroPadValue(hex, 32);
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== "string") {
        throw new Error(`Invalid ${label}: expected string, got ${typeof value}.`);
    }

    return value;
}

function requireAddress(value: unknown, label: string): string {
    return ethers.getAddress(requireString(value, label));
}

function getDaoAddress(): string {
    return ethers.getAddress(process.env.SOURCE_DAO_ADDRESS ?? DEFAULT_DAO_ADDRESS);
}

function getProposalApiBase(): string {
    return process.env.SOURCE_DAO_API_BASE ?? DEFAULT_PROPOSAL_API_BASE;
}

function getRpcUrl(): string {
    const maybeUrl = (connection.networkConfig as { url?: unknown }).url;
    if (typeof maybeUrl === "string") {
        return maybeUrl;
    }

    return "N/A";
}

function getProposalType(params: unknown[]): SupportedProposalType {
    const proposalType = requireString(params[params.length - 1], "proposal type");
    switch (proposalType) {
        case "createProject":
        case "acceptProject":
        case "upgradeContract":
        case "setCommittees":
            return proposalType;
        default:
            throw new Error(`Unsupported proposal type: ${proposalType}.`);
    }
}

function encodeProposalParams(params: unknown[]): string[] {
    const proposalType = getProposalType(params);
    switch (proposalType) {
        case "createProject":
        case "acceptProject":
            if (params.length !== 7) {
                throw new Error(`Invalid ${proposalType} params length: expected 7, got ${params.length}.`);
            }

            return [
                zeroPadUint256(requireString(params[0], "project id")),
                ethers.encodeBytes32String(requireString(params[1], "project name")),
                zeroPadUint256(convertVersion(requireString(params[2], "version"))),
                zeroPadUint256(requireString(params[3], "start date")),
                zeroPadUint256(requireString(params[4], "end date")),
                ethers.encodeBytes32String(requireString(params[5], "action")),
            ];
        case "upgradeContract":
            if (params.length !== 3) {
                throw new Error(`Invalid upgradeContract params length: expected 3, got ${params.length}.`);
            }

            return [
                ethers.zeroPadValue(requireAddress(params[0], "old contract address"), 32),
                ethers.zeroPadValue(requireAddress(params[1], "new contract address"), 32),
                ethers.encodeBytes32String(proposalType),
            ];
        case "setCommittees":
            if (params.length < 2) {
                throw new Error("Invalid setCommittees params: expected at least one committee address.");
            }

            return params
                .slice(0, -1)
                .map((param, index) => ethers.zeroPadValue(requireAddress(param, `committee address ${index}`), 32))
                .concat(ethers.encodeBytes32String(proposalType));
    }
}

function parseProposalId(value: string): number {
    const proposalId = parseInt(value, 10);
    if (Number.isNaN(proposalId) || proposalId <= 0) {
        throw new Error("Invalid proposal id. Please input a valid number greater than 0.");
    }

    return proposalId;
}

async function fetchProposalParams(apiBase: string, proposalId: number): Promise<unknown[]> {
    const response = await fetch(`${apiBase}/proposal/${proposalId}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch proposal ${proposalId}: HTTP ${response.status}.`);
    }

    const proposalResult = (await response.json()) as ProposalApiResponse;
    if (proposalResult.code !== 0) {
        throw new Error(
            `Failed to get proposal ${proposalId} parameters: err code ${proposalResult.code}, ${proposalResult.message ?? "unknown error"}.`
        );
    }

    return proposalResult.data.params;
}

async function printFullProposalVotingPower(daoAddress: string, signerAddress: string): Promise<void> {
    const dao = await ethers.getContractAt("SourceDao", daoAddress);
    const committee = await ethers.getContractAt("SourceDaoCommittee", await dao.committee());
    const devToken = await ethers.getContractAt("DevToken", await dao.devToken());
    const normalToken = await ethers.getContractAt("NormalToken", await dao.normalToken());

    const devBalance = await devToken.balanceOf(signerAddress);
    const normalBalance = await normalToken.balanceOf(signerAddress);
    const ratio = BigInt(await committee.devRatio());
    const totalVotes = (BigInt(devBalance) * ratio) / 100n + BigInt(normalBalance);

    console.log("This is a full proposal.");
    console.log("Current balances are shown as an estimate only. Final settlement follows the contract's on-chain logic.");
    console.log(
        `You have ${ethers.formatUnits(devBalance, 18)} dev tokens and ${ethers.formatUnits(normalBalance, 18)} normal tokens, estimated votes: ${ethers.formatUnits(totalVotes, 18)}`
    );
}

async function runVoteTool(): Promise<void> {
    const daoAddress = getDaoAddress();
    const proposalApiBase = getProposalApiBase();

    console.log(`Using network ${connection.networkName}, endpoint: ${getRpcUrl()}`);
    console.log(`Using DAO address: ${daoAddress}`);
    console.log(`Using proposal API: ${proposalApiBase}`);

    const signer = (await ethers.getSigners())[0];
    if (!signer) {
        throw new Error("No signer found. Please add your private key to the Hardhat network config.");
    }

    const signerAddress = await signer.getAddress();
    console.log(`Signer address: ${signerAddress}`);

    const dao = await ethers.getContractAt("SourceDao", daoAddress);
    const committee = await ethers.getContractAt("SourceDaoCommittee", await dao.committee());
    console.log(`Using Committee contract address: ${await committee.getAddress()}`);

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const proposalId = parseProposalId(await rl.question("Please input the proposal id to vote for: "));

        const proposalInfo = await committee.proposalOf(proposalId);
        if (proposalInfo.origin === ethers.ZeroAddress) {
            throw new Error(`Proposal ${proposalId} not found.`);
        }

        console.log(`Proposal ${proposalId} info:`);
        console.log(`\torigin: ${proposalInfo.origin}`);
        console.log(`\tstate: ${proposalInfo.state}`);
        console.log(`\texpired at: ${new Date(Number(proposalInfo.expired) * 1000).toLocaleString()}`);

        const extra = await committee.proposalExtraOf(proposalId);
        if (extra.from !== ethers.ZeroAddress) {
            await printFullProposalVotingPower(daoAddress, signerAddress);
        }

        let isSupport: boolean | undefined;
        while (isSupport === undefined) {
            const voteInput = await rl.question("Please input your vote (s for support, r for reject): ");
            if (voteInput === "s" || voteInput === "support") {
                isSupport = true;
            } else if (voteInput === "r" || voteInput === "reject") {
                isSupport = false;
            } else {
                console.error("Invalid input. Please input 's' for support or 'r' for reject.");
            }
        }

        console.log("Getting proposal parameters from BuckyOS SourceDAO backend...");
        const proposalParams = await fetchProposalParams(proposalApiBase, proposalId);
        console.log(`Please check proposal ${proposalId} parameters:`, proposalParams);

        const confirm = await rl.question(
            `Do you confirm to vote ${isSupport ? "support" : "reject"} for proposal ${proposalId}? (y/n): `
        );
        if (confirm !== "y" && confirm !== "yes") {
            console.log("Vote cancelled.");
            return;
        }

        const encodedParams = encodeProposalParams(proposalParams);
        const txResponse = isSupport
            ? await committee.support(proposalId, encodedParams)
            : await committee.reject(proposalId, encodedParams);

        console.log(
            `${isSupport ? "Supporting" : "Rejecting"} proposal ${proposalId}... waiting for transaction ${txResponse.hash}`
        );
        await txResponse.wait();
        console.log(`Successfully ${isSupport ? "supported" : "rejected"} proposal ${proposalId}.`);
    } finally {
        rl.close();
    }
}

runVoteTool()
    .then(() => {
        console.log("Vote finished.");
        exit(0);
    })
    .catch((error: unknown) => {
        console.error(error);
        exit(1);
    });
