import { exit } from "node:process";

import hre from "hardhat";

import { getDaoAddress, getLoadedConfigPaths, getToolOutputFormat } from "./vote_common.js";
import { formatDaoStatus, readDaoStatus } from "./status_common.js";

async function main(): Promise<void> {
    const connection = await hre.network.connect();
    const { ethers } = connection;
    const daoAddress = getDaoAddress();
    const outputFormat = getToolOutputFormat();
    const loadedConfigPaths = getLoadedConfigPaths();

    const status = await readDaoStatus(ethers, daoAddress);

    if (outputFormat === "json") {
        console.log(JSON.stringify(status, null, 2));
        return;
    }

    console.log(`Using network ${connection.networkName}`);
    if (loadedConfigPaths.length > 0) {
        console.log(`Using config files: ${loadedConfigPaths.join(", ")}`);
    }
    console.log(formatDaoStatus(status));
}

main()
    .then(() => {
        exit(0);
    })
    .catch((error: unknown) => {
        console.error(error);
        exit(1);
    });
