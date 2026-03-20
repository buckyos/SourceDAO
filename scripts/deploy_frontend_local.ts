import hre from "hardhat";
import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers } = await hre.network.connect("localhost");

const PROJECT_NAME = ethers.encodeBytes32String("Buckyos");
const VERSION_ONE = 100001;
const ONE_HOUR = 3600;

function printHeader(title: string) {
    console.log(`\n=== ${title} ===`);
}

async function main() {
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
        VERSION_ONE,
        150,
        daoAddress,
    ]);

    const project = await deployUUPSProxy(ethers, "ProjectManagement", [1, daoAddress]);
    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "Bucky Dev Token",
        "BDDT",
        1_000_000,
        [deployer.address, committeeTwo.address, committeeThree.address],
        [50_000, 20_000, 20_000],
        daoAddress,
    ]);
    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["Bucky Token", "BDT", daoAddress]);
    const lockup = await deployUUPSProxy(ethers, "SourceTokenLockup", [PROJECT_NAME, VERSION_ONE, daoAddress]);
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
    await (await devToken.dev2normal(5_000)).wait();
    await (await normalToken.transfer(viewer.address, 1_000)).wait();

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
    console.log(`NEXT_PUBLIC_CHAIN='Hardhat Local'`);
    console.log(`NEXT_PUBLIC_NETWORK_ID='31337'`);
    console.log(`NEXT_PUBLIC_RPC_URL='http://127.0.0.1:8545'`);
    console.log(`NEXT_PUBLIC_MAIN='${daoAddress}'`);
    console.log(`NEXT_PUBLIC_COMMITTEE='${await committee.getAddress()}'`);
    console.log(`NEXT_PUBLIC_DEV_TOKEN='${await devToken.getAddress()}'`);
    console.log(`NEXT_PUBLIC_NORMAL_TOKEN='${await normalToken.getAddress()}'`);
    console.log(`NEXT_PUBLIC_ACQUIRED='${await acquired.getAddress()}'`);
    console.log(`NEXT_PUBLIC_LOCKUP='${await lockup.getAddress()}'`);
    console.log(`NEXT_PUBLIC_DIVIDEND='${await dividend.getAddress()}'`);
    console.log(`NEXT_PUBLIC_PROJECT='${await project.getAddress()}'`);
    console.log(`NEXT_PUBLIC_TOKEN_ADDRESS_LINK=''`);
    console.log(`NEXT_PUBLIC_ADDRESS_LINK=''`);

    printHeader("Useful local accounts");
    console.log(`Deployer / committee member 1: ${deployer.address}`);
    console.log(`Committee member 2          : ${committeeTwo.address}`);
    console.log(`Committee member 3          : ${committeeThree.address}`);
    console.log(`Viewer / token holder       : ${viewer.address}`);
    console.log("\nImport the corresponding private keys from the `hardhat node` output into MetaMask or OKX Wallet.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
