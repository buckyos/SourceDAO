import { ethers, upgrades } from "hardhat";
import { SourceDaoCommittee, SourceDao } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import fs from 'node:fs';

describe("upgrade", () => {
    async function deployContracts() {
        const signers = await ethers.getSigners();
        let committees = [];
        for (let i = 0; i < 5; i++) {
        committees.push(signers[i].address);
        }
        console.log(`comittees ${JSON.stringify(committees)}`);

        console.log('deploy main contract')
        const MainFactory = await ethers.getContractFactory("SourceDao");

        const dao = await (await upgrades.deployProxy(MainFactory, undefined, {kind: "uups"})).deployed() as SourceDao;
        console.log('main proxy address', dao.address);

        console.log('deploy committee contract')
        const CommitteeFactory = await ethers.getContractFactory("SourceDaoCommittee");

        const committee = await (await upgrades.deployProxy(CommitteeFactory, [committees, dao.address], {kind: "uups"})).deployed() as SourceDaoCommittee;
        console.log('committee proxy address', committee.address);

        console.log('set committee address to main');
        await (await dao.setCommitteeAddress(committee.address)).wait();

        // console.log('set main address to committee');
        // await (await committee.setMainContractAddress(dao.address)).wait();

        return {signers, committees, committee, dao};
    }


    it("deploy and committee and upgrade", async function () {
        const {signers, committees, committee, dao} = await loadFixture(deployContracts);

        console.log("begin upgrade");
        console.log("deploy new impl contract first");

        const CommitteeFactory = await ethers.getContractFactory("SourceDaoCommittee");
        const newProxyAddress = await upgrades.deployImplementation(CommitteeFactory, {kind: 'uups'});
        console.log("deployed impl contract address:", newProxyAddress);

        let receipt = await (await committee.prepareContractUpgrade(committee.address, newProxyAddress as string)).wait();
        let proposalId = receipt.events![0].args![0];
        console.log('upgrade proposal id', proposalId);

        for (const signer of signers) {
            if (committees.includes(signer.address)) {
                console.log(`committee ${signer.address} support upgrade`);
                await (await committee.connect(signer).support(proposalId)).wait()
            }
        }

        console.log('execute upgrade');
        await (await committee.upgradeTo(newProxyAddress as string)).wait();
        console.log('upgrade complete')
    })

})
