import { exit } from "node:process";
import { createInterface } from "node:readline/promises";

import hre from "hardhat";
import {
    encodeProposalParams,
    fetchProposalParams,
    getDaoAddress,
    getLoadedConfigPath,
    getProposalApiBase,
    parseProposalId
} from "./vote_common.js";

const connection = await hre.network.connect();
const { ethers } = connection;

function getRpcUrl(): string {
    const maybeUrl = (connection.networkConfig as { url?: unknown }).url;
    if (typeof maybeUrl === "string") {
        return maybeUrl;
    }

    return "N/A";
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
    const loadedConfigPath = getLoadedConfigPath();

    console.log(`Using network ${connection.networkName}, endpoint: ${getRpcUrl()}`);
    console.log(`Using DAO address: ${daoAddress}`);
    console.log(`Using proposal API: ${proposalApiBase}`);
    if (loadedConfigPath !== undefined) {
        console.log(`Using config file: ${loadedConfigPath}`);
    }

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
