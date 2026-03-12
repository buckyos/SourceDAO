import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "./helpers/uups.js";

const { ethers } = await hre.network.connect();

describe("Hardhat 3 smoke", function () {
    it("deploys SourceDao through an ERC1967 proxy", async function () {
        const dao = await deployUUPSProxy(ethers, "SourceDao");

        expect(await dao.version()).to.equal("2.0.0");
    });
});