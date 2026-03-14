import { exit } from "node:process";
import { createInterface } from "node:readline/promises";

import hre from "hardhat";

import {
    getConfiguredProjectId,
    getConfiguredStatusAddress,
    getDaoAddress,
    getLoadedConfigPaths,
    getToolOutputFormat,
    parseProjectId
} from "./vote_common.js";
import { formatProjectStatus, readProjectStatus } from "./status_common.js";

async function resolveProjectId(): Promise<number> {
    const configured = getConfiguredProjectId();
    if (configured !== undefined) {
        return configured;
    }

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        return parseProjectId(await rl.question("Please input the project id to inspect: "));
    } finally {
        rl.close();
    }
}

async function main(): Promise<void> {
    const connection = await hre.network.connect();
    const { ethers } = connection;
    const daoAddress = getDaoAddress();
    const projectId = await resolveProjectId();
    const observedAddress = getConfiguredStatusAddress();
    const outputFormat = getToolOutputFormat();
    const loadedConfigPaths = getLoadedConfigPaths();

    const status = await readProjectStatus(ethers, daoAddress, projectId, observedAddress);

    if (outputFormat === "json") {
        console.log(JSON.stringify(status, null, 2));
        return;
    }

    console.log(`Using network ${connection.networkName}`);
    if (loadedConfigPaths.length > 0) {
        console.log(`Using config files: ${loadedConfigPaths.join(", ")}`);
    }
    console.log(formatProjectStatus(status));
}

main()
    .then(() => {
        exit(0);
    })
    .catch((error: unknown) => {
        console.error(error);
        exit(1);
    });
