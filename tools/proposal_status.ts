import { exit } from "node:process";
import { createInterface } from "node:readline/promises";

import hre from "hardhat";

import {
    getConfiguredProposalId,
    getDaoAddress,
    getLoadedConfigPaths,
    getToolOutputFormat,
    parseProposalId
} from "./vote_common.js";
import { formatProposalStatus, readProposalStatus } from "./status_common.js";

async function resolveProposalId(): Promise<number> {
    const configured = getConfiguredProposalId();
    if (configured !== undefined) {
        return configured;
    }

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        return parseProposalId(await rl.question("Please input the proposal id to inspect: "));
    } finally {
        rl.close();
    }
}

async function main(): Promise<void> {
    const connection = await hre.network.connect();
    const { ethers } = connection;
    const daoAddress = getDaoAddress();
    const proposalId = await resolveProposalId();
    const outputFormat = getToolOutputFormat();
    const loadedConfigPaths = getLoadedConfigPaths();

    const status = await readProposalStatus(ethers, daoAddress, proposalId);

    if (outputFormat === "json") {
        console.log(JSON.stringify(status, null, 2));
        return;
    }

    console.log(`Using network ${connection.networkName}`);
    if (loadedConfigPaths.length > 0) {
        console.log(`Using config files: ${loadedConfigPaths.join(", ")}`);
    }
    console.log(formatProposalStatus(status));
}

main()
    .then(() => {
        exit(0);
    })
    .catch((error: unknown) => {
        console.error(error);
        exit(1);
    });
