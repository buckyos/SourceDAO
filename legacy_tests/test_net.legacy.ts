import hre from "hardhat";
import { SourceDaoCommittee, ProjectManagement, Investment, MultiSigWallet } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

const BigNumber = hre.ethers.BigNumber;

let endTime = Math.ceil(new Date().getTime() / 1000) + 10000;

let assetAddress = "0x0000000000000000000000000000000000000000";
let testEth = false;

describe("Investment", () => {

    it("Create Investment on Goerli", async () => {
        const SourceDaoFactory = await hre.ethers.getContractFactory("SourceDao");
        const SourceDao = SourceDaoFactory.attach("0xb28e23E1A949cBF716d2d412D3e841FbE03F08C8");

        const Investment = await hre.ethers.getContractFactory("Investment");
        const investment = Investment.attach(await SourceDao.investment());

        console.log('investment addr:', investment.address);

        let tx = await investment.createInvestment(86400, {
            totalTokenAmount: hre.ethers.utils.parseEther("1000"),
            priceType: 0,
            tokenExchangeRate: 1,
            assetExchangeRate: 1,
            startTime: 0,
            endTime: 1686699322,
            minAssetPerInvestor: hre.ethers.utils.parseEther("0.01"),
            maxAssetPerInvestor: hre.ethers.utils.parseEther("0.1"),
            goalAssetAmount: hre.ethers.utils.parseEther("100"),
            assetAddress: "0x15461B7dB8163b911268B77834DCD7bCE4d987Cc",
            onlyWhitelist: true,
        });
        let ret = await tx.wait();

        let event = ret.events![1];
        console.log('JSON stringify:', JSON.stringify(event));
        console.log(event.event, event.args![0], event.args![1]);
    });
});