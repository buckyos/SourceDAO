import { ethers, upgrades } from "hardhat";

const MAIN_ADDRESS = "0x235B40E7a51f58Ab4761FB046B9c283E1D500EcB"

async function main() {
    const mainDao = (await ethers.getContractFactory("SourceDao")).attach(MAIN_ADDRESS);

    const invsementProxyAddress = await mainDao.investment();
    console.log("get invsement proxy address", invsementProxyAddress);
    
    const invsementFactory = await ethers.getContractFactory("Investment");
    const oldInvsement = invsementFactory.attach(invsementProxyAddress);
    const implAddress = await upgrades.deployImplementation(invsementFactory, {kind: 'uups'}) as string;
    console.log("depolyed invsement impl address", implAddress);

    const committee = (await ethers.getContractFactory("SourceDaoCommittee")).attach(await mainDao.committee());

    console.log("begin update purpose");
    let receipt = await (await committee.perpareContractUpgrade(invsementProxyAddress, implAddress)).wait();
    let proposalId = receipt.events![0].args![0];

    let signers = await ethers.getSigners();
    for (const signer of signers) {
        console.log(`invsement ${signer.address} support upgrade`);
        await (await committee.connect(signer).support(proposalId, [
            ethers.utils.zeroPad(invsementProxyAddress, 32),
            ethers.utils.zeroPad(implAddress, 32),
            ethers.utils.formatBytes32String("upgradeContract")
        ])).wait();
    }

    console.log('execute upgrade');
    await (await oldInvsement.upgradeTo(implAddress)).wait();
    console.log('upgrade complete')
    
    const newImplAddr = await upgrades.erc1967.getImplementationAddress(invsementProxyAddress);
    console.log("check new impl addr:", newImplAddr);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});