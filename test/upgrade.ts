import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();
const SEVEN_DAYS = 7 * 24 * 60 * 60;
const MAIN_PROJECT_NAME = ethers.encodeBytes32String("main");

function upgradeParams(proxyAddress: string, implementationAddress: string) {
    return [
        ethers.zeroPadValue(proxyAddress, 32),
        ethers.zeroPadValue(implementationAddress, 32),
        ethers.encodeBytes32String("upgradeContract")
    ];
}

async function deployDummyModuleAddresses(count: number) {
    const factory = await ethers.getContractFactory("NativeReceiverMock");
    const deployments = [];
    for (let i = 0; i < count; i++) {
        const contract = await factory.deploy();
        await contract.waitForDeployment();
        deployments.push(await contract.getAddress());
    }
    return deployments;
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

async function deployLegacyCommitteeUpgradeFixture() {
    const signers = await ethers.getSigners();
    const members = signers.slice(0, 3);

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();
    const committee = await deployUUPSProxy(ethers, "SourceDaoCommitteeLegacyMock", [
        members.map((signer: { address: string }) => signer.address),
        1,
        200,
        MAIN_PROJECT_NAME,
        1,
        150,
        daoAddress
    ]);

    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();

    const project: any = await (await ethers.getContractFactory("ProjectVersionMock")).deploy();
    await project.waitForDeployment();
    await (await dao.setProjectAddress(await project.getAddress())).wait();

    const proposalCaller: any = await (await ethers.getContractFactory("CommitteeProposalCallerMock")).deploy();
    await proposalCaller.waitForDeployment();
    await (await dao.setAcquiredAddress(await proposalCaller.getAddress())).wait();

    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        10_000,
        members.map((member: { address: string }) => member.address),
        [2_000, 1_000, 1_000],
        daoAddress
    ]);
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["BDT", "BDT", daoAddress]);
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();

    const nextImplementation = await (await ethers.getContractFactory("SourceDaoCommitteeV2Mock")).deploy();
    await nextImplementation.waitForDeployment();

    return {
        committee,
        dao,
        devToken,
        normalToken,
        project,
        proposalCaller,
        members,
        outsider: signers[4],
        nextImplementationAddress: await nextImplementation.getAddress()
    };
}

async function deployLegacyDaoUpgradeFixture() {
    const signers = await ethers.getSigners();
    const members = signers.slice(0, 3);

    const dao = await deployUUPSProxy(ethers, "SourceDaoLegacyMock");
    const daoAddress = await dao.getAddress();
    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        members.map((signer: { address: string }) => signer.address),
        1,
        200,
        MAIN_PROJECT_NAME,
        1,
        150,
        daoAddress
    ]);

    const moduleAddresses = await deployDummyModuleAddresses(6);

    await (await dao.setDevTokenAddress(moduleAddresses[0])).wait();
    await (await dao.setNormalTokenAddress(moduleAddresses[1])).wait();
    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();
    await (await dao.setProjectAddress(moduleAddresses[2])).wait();
    await (await dao.setTokenLockupAddress(moduleAddresses[3])).wait();
    await (await dao.setTokenDividendAddress(moduleAddresses[4])).wait();
    await (await dao.setAcquiredAddress(moduleAddresses[5])).wait();

    const nextDaoImplementation = await (await ethers.getContractFactory("SourceDaoV2Mock")).deploy();
    await nextDaoImplementation.waitForDeployment();

    return {
        dao,
        committee,
        members,
        moduleAddresses,
        nextDaoImplementation,
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

    it("migrates a fully configured legacy dao proxy into finalized bootstrap state on upgrade", async function () {
        const {
            dao,
            committee,
            members,
            moduleAddresses,
            nextDaoImplementation,
            nextDaoImplementationAddress
        } = await networkHelpers.loadFixture(deployLegacyDaoUpgradeFixture);
        const daoAddress = await dao.getAddress();
        const committeeAddress = await committee.getAddress();
        const proposalId = 1n;
        const params = upgradeParams(daoAddress, nextDaoImplementationAddress);
        const migrationData = nextDaoImplementation.interface.encodeFunctionData("migrateLegacyBootstrap");

        await expect(committee.connect(members[0]).prepareContractUpgrade(daoAddress, nextDaoImplementationAddress))
            .to.emit(committee, "ProposalStart")
            .withArgs(proposalId, false);

        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        await expect(dao.upgradeToAndCall(nextDaoImplementationAddress, migrationData))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId);

        const upgradedDao = await ethers.getContractAt("SourceDaoV2Mock", daoAddress);
        expect(await upgradedDao.version()).to.equal("2.1.0");
        expect(await upgradedDao.bootstrapAdmin()).to.equal(ethers.ZeroAddress);
        expect(await upgradedDao.bootstrapFinalized()).to.equal(true);
        expect(await upgradedDao.devToken()).to.equal(moduleAddresses[0]);
        expect(await upgradedDao.normalToken()).to.equal(moduleAddresses[1]);
        expect(await upgradedDao.committee()).to.equal(committeeAddress);
        expect(await upgradedDao.project()).to.equal(moduleAddresses[2]);
        expect(await upgradedDao.lockup()).to.equal(moduleAddresses[3]);
        expect(await upgradedDao.dividend()).to.equal(moduleAddresses[4]);
        expect(await upgradedDao.acquired()).to.equal(moduleAddresses[5]);

        await expect(upgradedDao.setDevTokenAddress(moduleAddresses[0])).to.be.revertedWith("bootstrap finalized");
        await expect(upgradedDao.finalizeInitialization()).to.be.revertedWith("bootstrap finalized");
    });

    it("preserves legacy committee storage across upgrade to the snapshot implementation", async function () {
        const {
            committee,
            proposalCaller,
            members,
            outsider,
            nextImplementationAddress
        } = await networkHelpers.loadFixture(deployLegacyCommitteeUpgradeFixture);
        const committeeAddress = await committee.getAddress();
        const ordinaryProposalId = 1n;
        const fullProposalId = 2n;
        const upgradeProposalId = 3n;
        const newRatio = 180n;
        const ordinaryParams = [
            ethers.zeroPadValue(ethers.toBeHex(newRatio), 32),
            ethers.encodeBytes32String("setDevRatio")
        ];
        const fullParams = [ethers.encodeBytes32String("legacy-full-storage")];
        const params = upgradeParams(committeeAddress, nextImplementationAddress);

        await (await committee.connect(members[0]).prepareSetDevRatio(newRatio)).wait();
        await (await committee.connect(members[0]).support(ordinaryProposalId, ordinaryParams)).wait();

        await (await proposalCaller.fullPropose(committeeAddress, SEVEN_DAYS, fullParams, 40)).wait();
        await (await committee.connect(members[0]).support(fullProposalId, fullParams)).wait();
        await (await committee.connect(members[1]).reject(fullProposalId, fullParams)).wait();

        await (await committee.connect(members[0]).prepareContractUpgrade(committeeAddress, nextImplementationAddress)).wait();
        await (await committee.connect(members[0]).support(upgradeProposalId, params)).wait();
        await (await committee.connect(members[1]).support(upgradeProposalId, params)).wait();

        expect(await committee.members()).to.deep.equal(members.map((member: { address: string }) => member.address));
        expect(await committee.mainProjectName()).to.equal(MAIN_PROJECT_NAME);
        expect(await committee.finalVersion()).to.equal(1n);
        expect(await committee.devRatio()).to.equal(200n);
        expect(await committee.finalRatio()).to.equal(150n);
        expect((await committee.proposalOf(ordinaryProposalId)).support).to.deep.equal([members[0].address]);
        expect((await committee.proposalOf(fullProposalId)).reject).to.deep.equal([members[1].address]);

        await expect(committee.upgradeToAndCall(nextImplementationAddress, "0x"))
            .to.emit(committee, "ProposalAccept")
            .withArgs(upgradeProposalId)
            .to.emit(committee, "ProposalExecuted")
            .withArgs(upgradeProposalId);

        const upgradedCommittee = await ethers.getContractAt("SourceDaoCommitteeV2Mock", committeeAddress);

        expect(await upgradedCommittee.version()).to.equal("2.1.0");
        expect(await upgradedCommittee.members()).to.deep.equal(members.map((member: { address: string }) => member.address));
        expect(await upgradedCommittee.mainProjectName()).to.equal(MAIN_PROJECT_NAME);
        expect(await upgradedCommittee.finalVersion()).to.equal(1n);
        expect(await upgradedCommittee.devRatio()).to.equal(200n);
        expect(await upgradedCommittee.finalRatio()).to.equal(150n);
        expect(await upgradedCommittee.committeeVersion()).to.equal(0n);
        expect((await upgradedCommittee.proposalOf(ordinaryProposalId)).support).to.deep.equal([members[0].address]);
        expect((await upgradedCommittee.proposalOf(fullProposalId)).reject).to.deep.equal([members[1].address]);

        await expect(
            upgradedCommittee.connect(outsider).support(ordinaryProposalId, ordinaryParams)
        ).to.be.revertedWith("only committee can vote");

        await (await upgradedCommittee.connect(members[1]).support(ordinaryProposalId, ordinaryParams)).wait();
        expect(await upgradedCommittee.committeeVersion()).to.equal(1n);

        await networkHelpers.time.increase(SEVEN_DAYS + 1);

        await expect(upgradedCommittee.endFullPropose(fullProposalId, [members[0].address, members[1].address]))
            .to.emit(upgradedCommittee, "ProposalAccept")
            .withArgs(fullProposalId);

        const fullExtra = await upgradedCommittee.proposalExtraOf(fullProposalId);
        expect(fullExtra.agree).to.equal(4_000n);
        expect(fullExtra.reject).to.equal(2_000n);
        expect(fullExtra.totalReleasedToken).to.equal(8_000n);
        expect((await upgradedCommittee.proposalOf(fullProposalId)).state).to.equal(2n);

        await expect(upgradedCommittee.setDevRatio(newRatio, ordinaryProposalId))
            .to.emit(upgradedCommittee, "ProposalAccept")
            .withArgs(ordinaryProposalId)
            .to.emit(upgradedCommittee, "DevRatioChanged")
            .withArgs(200n, newRatio)
            .to.emit(upgradedCommittee, "ProposalExecuted")
            .withArgs(ordinaryProposalId);
    });
});
