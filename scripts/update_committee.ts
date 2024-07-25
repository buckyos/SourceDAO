import { ethers, upgrades } from "hardhat";
import { SourceDao } from "../typechain-types";

const MAIN_ADDRESS = "0x785423901a501bcef29ab2a8cafa25d5a8c027d3"   // amoy main contract

async function main() {
    const mainDao = (await ethers.getContractFactory("SourceDao")).attach(MAIN_ADDRESS) as SourceDao;

    const contractProxyAddress = await mainDao.committee();
    console.log("get contract proxy address", contractProxyAddress);
    
    const contractFactory = await ethers.getContractFactory("SourceDaoCommittee");
    const implAddress = await upgrades.deployImplementation(contractFactory, {kind: 'uups'}) as string;
    console.log("depolyed contract impl address", implAddress);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});