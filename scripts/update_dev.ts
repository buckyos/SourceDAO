import { ethers, upgrades } from "hardhat";

const MAIN_ADDRESS = "0x775114C065e3446CadD470DE891540Da81812E33"

async function main() {
    const mainDao = (await ethers.getContractFactory("SourceDao")).attach(MAIN_ADDRESS);

    // change this line to get sub contract`s proxy address
    const contractProxyAddress = await mainDao.devGroup();
    console.log("get contract proxy address", contractProxyAddress);
    
    // change this line to get sub contract`s contract factory
    const contractFactory = await ethers.getContractFactory("ProjectManagement");
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