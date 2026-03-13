import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

function upgradeParams(proxyAddress: string, implementationAddress: string) {
    return [
        ethers.zeroPadValue(proxyAddress, 32),
        ethers.zeroPadValue(implementationAddress, 32),
        ethers.encodeBytes32String("upgradeContract")
    ];
}

async function deployUpgradeFixture() {
    const signers = await ethers.getSigners();
    const members = signers.slice(0, 3);

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        members.map((signer: { address: string }) => signer.address),
        1,
        200,
        ethers.encodeBytes32String("main"),
        1,
        150,
        await dao.getAddress()
    ]);

    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();

    const nextImplementation = await (await ethers.getContractFactory("SourceDaoCommitteeV2Mock")).deploy();
    await nextImplementation.waitForDeployment();

    const nextDaoImplementation = await (await ethers.getContractFactory("SourceDaoV2Mock")).deploy();
    await nextDaoImplementation.waitForDeployment();

    return {
        committee,
        dao,
        members,
        outsider: signers[4],
        nextImplementationAddress: await nextImplementation.getAddress(),
        nextDaoImplementationAddress: await nextDaoImplementation.getAddress()
    };
}

describe("upgrade", function () {
    it("only allows committee members to start an upgrade proposal", async function () {
        const { committee, outsider, nextImplementationAddress } = await networkHelpers.loadFixture(deployUpgradeFixture);

        await expect(
            committee.connect(outsider).prepareContractUpgrade(await committee.getAddress(), nextImplementationAddress)
        ).to.be.revertedWith("only committee can upgrade contract");
    });

    it("upgrades the committee proxy after majority approval", async function () {
        const { committee, members, nextImplementationAddress } = await networkHelpers.loadFixture(deployUpgradeFixture);
        const committeeAddress = await committee.getAddress();
        const params = upgradeParams(committeeAddress, nextImplementationAddress);
        const proposalId = 1n;

        await expect(committee.connect(members[0]).prepareContractUpgrade(committeeAddress, nextImplementationAddress))
            .to.emit(committee, "ProposalStart")
            .withArgs(proposalId, false);

        const queuedProposal = await committee.getContractUpgradeProposal(committeeAddress);
        expect(queuedProposal.state).to.equal(1n);
        expect(queuedProposal.fromGroup).to.equal(committeeAddress);

        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        await expect(committee.upgradeToAndCall(nextImplementationAddress, "0x"))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(committee, "ProposalExecuted")
            .withArgs(proposalId);

        expect(await committee.version()).to.equal("2.1.0");

        const executedProposal = await committee.proposalOf(proposalId);
        expect(executedProposal.state).to.equal(4n);

        const clearedProposal = await committee.getContractUpgradeProposal(committeeAddress);
        expect(clearedProposal.state).to.equal(0n);
    });

    it("rejects an upgrade when the proposal has no accepted result", async function () {
        const { committee, members, nextImplementationAddress } = await networkHelpers.loadFixture(deployUpgradeFixture);
        const committeeAddress = await committee.getAddress();
        const proposalId = 1n;
        const params = upgradeParams(committeeAddress, nextImplementationAddress);

        await (await committee.connect(members[0]).prepareContractUpgrade(committeeAddress, nextImplementationAddress)).wait();
        await (await committee.connect(members[0]).reject(proposalId, params)).wait();
        await (await committee.connect(members[1]).reject(proposalId, params)).wait();

        await expect(committee.settleProposal(proposalId))
            .to.emit(committee, "ProposalReject")
            .withArgs(proposalId);

        await expect(committee.upgradeToAndCall(nextImplementationAddress, "0x")).to.be.revertedWith(
            "verify proposal fail"
        );

        expect(await committee.version()).to.equal("2.0.0");

        const rejectedProposal = await committee.proposalOf(proposalId);
        expect(rejectedProposal.state).to.equal(3n);

        const clearedProposal = await committee.getContractUpgradeProposal(committeeAddress);
        expect(clearedProposal.state).to.equal(3n);
    });

    it("keeps a queued upgrade proposal when verification params do not match", async function () {
        const { committee, members, nextImplementationAddress } = await networkHelpers.loadFixture(deployUpgradeFixture);
        const committeeAddress = await committee.getAddress();
        const otherImplementation = await (await ethers.getContractFactory("SourceDaoCommitteeV2Mock")).deploy();
        await otherImplementation.waitForDeployment();
        const proposalId = 1n;
        const params = upgradeParams(committeeAddress, nextImplementationAddress);

        await (await committee.connect(members[0]).prepareContractUpgrade(committeeAddress, nextImplementationAddress)).wait();
        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        await expect(committee.upgradeToAndCall(await otherImplementation.getAddress(), "0x")).to.be.revertedWith(
            "verify proposal fail"
        );

        const stillQueued = await committee.getContractUpgradeProposal(committeeAddress);
        expect(stillQueued.state).to.equal(1n);

        await expect(committee.upgradeToAndCall(nextImplementationAddress, "0x"))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(committee, "ProposalExecuted")
            .withArgs(proposalId);
    });

    it("clears an expired upgrade proposal when a committee member cancels it", async function () {
        const { committee, members, nextImplementationAddress } = await networkHelpers.loadFixture(deployUpgradeFixture);
        const committeeAddress = await committee.getAddress();
        const proposalId = 1n;

        await (await committee.connect(members[0]).prepareContractUpgrade(committeeAddress, nextImplementationAddress)).wait();

        await networkHelpers.time.increase(7 * 24 * 60 * 60 + 1);

        await committee.connect(members[1]).cancelContractUpgrade(committeeAddress);

        const clearedProposal = await committee.getContractUpgradeProposal(committeeAddress);
        expect(clearedProposal.state).to.equal(0n);

        await expect(committee.connect(members[0]).prepareContractUpgrade(committeeAddress, nextImplementationAddress))
            .to.emit(committee, "ProposalStart")
            .withArgs(proposalId + 1n, false);
    });

    it("upgrades the dao proxy after committee approval", async function () {
        const { committee, dao, members, outsider, nextDaoImplementationAddress } = await networkHelpers.loadFixture(deployUpgradeFixture);
        const daoAddress = await dao.getAddress();
        const proposalId = 1n;
        const params = upgradeParams(daoAddress, nextDaoImplementationAddress);

        await expect(dao.connect(outsider).setMainContractAddress(outsider.address)).to.be.revertedWith("can set once");

        await expect(committee.connect(members[0]).prepareContractUpgrade(daoAddress, nextDaoImplementationAddress))
            .to.emit(committee, "ProposalStart")
            .withArgs(proposalId, false);

        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        await expect(dao.upgradeToAndCall(nextDaoImplementationAddress, "0x"))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId);

        const upgradedDao = await ethers.getContractAt("SourceDaoV2Mock", daoAddress);
        expect(await upgradedDao.version()).to.equal("2.1.0");
    });
});
