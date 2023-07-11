import { ethers, upgrades } from "hardhat";

const MAIN_ADDRESS = "0xb28e23E1A949cBF716d2d412D3e841FbE03F08C8"

async function main() {
    const mainDao = (await ethers.getContractFactory("SourceDao")).attach(MAIN_ADDRESS);

    const contractProxyAddress = await mainDao.committee();
    console.log("get contract proxy address", contractProxyAddress);
    
    const contractFactory = await ethers.getContractFactory("SourceDaoCommittee");
    const oldContract = contractFactory.attach(contractProxyAddress);
    const implAddress = await upgrades.deployImplementation(contractFactory, {kind: 'uups'}) as string;
    console.log("depolyed contract impl address", implAddress);

    const committee = (await ethers.getContractFactory("SourceDaoCommittee")).attach(await mainDao.committee());
    
    console.log("begin update purpose");
    let receipt = await (await committee.perpareContractUpgrade(contractProxyAddress, implAddress)).wait();
    console.log("receipt log: ", JSON.stringify(receipt.logs));
    let proposalId = receipt.events![0].args![0];

    let signers = await ethers.getSigners();
    for (const signer of signers) {
        console.log(`committee ${signer.address} support upgrade`);
        await (await committee.connect(signer).support(proposalId)).wait();
    }

    console.log('execute upgrade');
    await (await oldContract.upgradeTo(implAddress)).wait();
    console.log('upgrade complete')
    
    const newImplAddr = await upgrades.erc1967.getImplementationAddress(contractProxyAddress);
    console.log("check new impl addr:", newImplAddr);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});