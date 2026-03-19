import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();
const SEVEN_DAYS = 7 * 24 * 60 * 60;
const MAIN_PROJECT_NAME = ethers.encodeBytes32String("main");
const PROJECT_NAME = ethers.encodeBytes32String("SourceDao");
const VERSION_ONE = 100001n;
const VERSION_TWO = 200001n;
const THIRTY_DAYS = 30n * 24n * 60n * 60n;
const ONE_HOUR = 3600n;
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

function upgradeParams(
    proxyAddress: string,
    implementationAddress: string,
    upgradeData: string = "0x"
) {
    return [
        ethers.zeroPadValue(proxyAddress, 32),
        ethers.zeroPadValue(implementationAddress, 32),
        ethers.keccak256(upgradeData),
        ethers.encodeBytes32String("upgradeContract")
    ];
}

function toBytes32(value: bigint) {
    return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

async function getImplementationAddress(proxyAddress: string) {
    const raw = await ethers.provider.getStorage(proxyAddress, IMPLEMENTATION_SLOT);
    return ethers.getAddress(`0x${raw.slice(-40)}`);
}

function projectParams(
    projectId: bigint,
    version: bigint,
    startDate: bigint,
    endDate: bigint,
    action: "createProject" | "acceptProject"
) {
    return [
        toBytes32(projectId),
        PROJECT_NAME,
        toBytes32(version),
        toBytes32(startDate),
        toBytes32(endDate),
        ethers.encodeBytes32String(action)
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

async function deployConfiguredUpgradeFixture() {
    const signers = await ethers.getSigners();
    const [manager, memberTwo, memberThree, contributor, buyer] = signers;
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        [manager.address, memberTwo.address, memberThree.address],
        1,
        200,
        PROJECT_NAME,
        Number(VERSION_TWO),
        150,
        daoAddress
    ]);
    const project = await deployUUPSProxy(ethers, "ProjectManagement", [1, daoAddress]);
    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        1_000_000,
        [manager.address],
        [5_000],
        daoAddress
    ]);
    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["BDT", "BDT", daoAddress]);
    const lockup = await deployUUPSProxy(ethers, "SourceTokenLockup", [PROJECT_NAME, VERSION_TWO, daoAddress]);
    const dividend = await deployUUPSProxy(ethers, "DividendContract", [Number(ONE_HOUR), daoAddress]);
    const acquired = await deployUUPSProxy(ethers, "Acquired", [1, daoAddress]);

    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();
    await (await dao.setProjectAddress(await project.getAddress())).wait();
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();
    await (await dao.setTokenLockupAddress(await lockup.getAddress())).wait();
    await (await dao.setTokenDividendAddress(await dividend.getAddress())).wait();
    await (await dao.setAcquiredAddress(await acquired.getAddress())).wait();

    await (await devToken.dev2normal(1_000)).wait();
    await (await normalToken.transfer(buyer.address, 200)).wait();

    const saleToken = await (await ethers.getContractFactory("TestToken")).deploy(
        "SaleToken",
        "SALE",
        18,
        1_000_000n,
        manager.address
    );
    await saleToken.waitForDeployment();

    const nextCommitteeImplementation = await (await ethers.getContractFactory("SourceDaoCommitteeV2Mock")).deploy();
    await nextCommitteeImplementation.waitForDeployment();

    const nextDaoImplementation = await (await ethers.getContractFactory("SourceDaoV2Mock")).deploy();
    await nextDaoImplementation.waitForDeployment();

    return {
        manager,
        memberTwo,
        memberThree,
        contributor,
        buyer,
        dao,
        committee,
        project,
        devToken,
        normalToken,
        lockup,
        dividend,
        acquired,
        saleToken,
        nextCommitteeImplementationAddress: await nextCommitteeImplementation.getAddress(),
        nextDaoImplementationAddress: await nextDaoImplementation.getAddress()
    };
}

async function finishProject(
    fixture: any,
    committee: any,
    version: bigint = VERSION_ONE
) {
    const projectId = await fixture.project.projectIdCounter();
    const latestBlock = await ethers.provider.getBlock("latest");
    if (latestBlock === null) {
        throw new Error("latest block not found");
    }

    const startDate = BigInt(latestBlock.timestamp);
    const endDate = startDate + THIRTY_DAYS;

    await (await fixture.project.createProject(
        1_000n,
        PROJECT_NAME,
        version,
        startDate,
        endDate,
        [],
        []
    )).wait();

    const createProposalId = (await fixture.project.projectOf(projectId)).proposalId;
    const createParams = projectParams(projectId, version, startDate, endDate, "createProject");
    await (await committee.connect(fixture.manager).support(createProposalId, createParams)).wait();
    await (await committee.connect(fixture.memberTwo).support(createProposalId, createParams)).wait();
    await (await fixture.project.promoteProject(projectId)).wait();

    await (await fixture.project.acceptProject(projectId, 4, [
        { contributor: fixture.contributor.address, value: 100 }
    ])).wait();

    const acceptProposalId = (await fixture.project.projectOf(projectId)).proposalId;
    const acceptParams = projectParams(projectId, version, startDate, endDate, "acceptProject");
    await (await committee.connect(fixture.manager).support(acceptProposalId, acceptParams)).wait();
    await (await committee.connect(fixture.memberTwo).support(acceptProposalId, acceptParams)).wait();
    await (await fixture.project.promoteProject(projectId)).wait();

    return {
        projectId,
        releaseTime: await fixture.project.versionReleasedTime(PROJECT_NAME, version)
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

    it("rejects upgrade calldata that was not approved with the implementation", async function () {
        const { committee, members } = await networkHelpers.loadFixture(deployUpgradeFixture);
        const committeeAddress = await committee.getAddress();
        const nextImplementation = await (await ethers.getContractFactory("SourceDaoCommitteeV2InitMock")).deploy();
        await nextImplementation.waitForDeployment();
        const nextImplementationAddress = await nextImplementation.getAddress();
        const proposalId = 1n;
        const params = upgradeParams(committeeAddress, nextImplementationAddress);
        const initData = nextImplementation.interface.encodeFunctionData("initializeMarker", [123n]);

        await (await committee.connect(members[0]).prepareContractUpgrade(committeeAddress, nextImplementationAddress)).wait();
        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        await expect(committee.upgradeToAndCall(nextImplementationAddress, initData)).to.be.revertedWith(
            "verify proposal fail"
        );

        const stillQueued = await committee.getContractUpgradeProposal(committeeAddress);
        expect(stillQueued.state).to.equal(1n);

        await expect(committee.upgradeToAndCall(nextImplementationAddress, "0x"))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(committee, "ProposalExecuted")
            .withArgs(proposalId);

        const upgradedCommittee = await ethers.getContractAt("SourceDaoCommitteeV2InitMock", committeeAddress);
        expect(await upgradedCommittee.upgradeMarker()).to.equal(0n);
    });

    it("allows upgrade calldata that was explicitly approved by governance", async function () {
        const { committee, members } = await networkHelpers.loadFixture(deployUpgradeFixture);
        const committeeAddress = await committee.getAddress();
        const nextImplementation = await (await ethers.getContractFactory("SourceDaoCommitteeV2InitMock")).deploy();
        await nextImplementation.waitForDeployment();
        const nextImplementationAddress = await nextImplementation.getAddress();
        const proposalId = 1n;
        const initData = nextImplementation.interface.encodeFunctionData("initializeMarker", [321n]);
        const params = upgradeParams(committeeAddress, nextImplementationAddress, initData);

        await expect(
            committee.connect(members[0])["prepareContractUpgrade(address,address,bytes32)"](
                committeeAddress,
                nextImplementationAddress,
                ethers.keccak256(initData)
            )
        )
            .to.emit(committee, "ProposalStart")
            .withArgs(proposalId, false);

        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        await expect(committee.upgradeToAndCall(nextImplementationAddress, initData))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(committee, "ProposalExecuted")
            .withArgs(proposalId);

        const upgradedCommittee = await ethers.getContractAt("SourceDaoCommitteeV2InitMock", committeeAddress);
        expect(await upgradedCommittee.version()).to.equal("2.1.1");
        expect(await upgradedCommittee.upgradeMarker()).to.equal(321n);
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

    it("fails upgrades cleanly when the committee slot points to a contract that does not implement upgrade verification", async function () {
        const dao = await deployUUPSProxy(ethers, "SourceDao");
        const daoAddress = await dao.getAddress();
        const wrongCommittee = await (await ethers.getContractFactory("NativeReceiverMock")).deploy();
        await wrongCommittee.waitForDeployment();
        await (await dao.setCommitteeAddress(await wrongCommittee.getAddress())).wait();

        const nextDaoImplementation = await (await ethers.getContractFactory("SourceDaoV2Mock")).deploy();
        await nextDaoImplementation.waitForDeployment();
        const nextDaoImplementationAddress = await nextDaoImplementation.getAddress();

        const implementationBefore = await getImplementationAddress(daoAddress);

        await expect(dao.upgradeToAndCall(nextDaoImplementationAddress, "0x")).to.be.revertedWithoutReason(ethers);

        expect(await getImplementationAddress(daoAddress)).to.equal(implementationBefore);
        expect(await dao.version()).to.equal("2.0.0");
    });

    it("migrates a fully configured legacy dao proxy into bootstrap-admin state on upgrade", async function () {
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
        const migrationData = nextDaoImplementation.interface.encodeFunctionData(
            "migrateBootstrapAdmin(address)",
            [members[0].address]
        );
        const params = upgradeParams(daoAddress, nextDaoImplementationAddress, migrationData);

        await expect(
            committee.connect(members[0])["prepareContractUpgrade(address,address,bytes32)"](
                daoAddress,
                nextDaoImplementationAddress,
                ethers.keccak256(migrationData)
            )
        )
            .to.emit(committee, "ProposalStart")
            .withArgs(proposalId, false);

        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        await expect(dao.upgradeToAndCall(nextDaoImplementationAddress, "0x")).to.be.revertedWith(
            "verify proposal fail"
        );

        await expect(dao.upgradeToAndCall(nextDaoImplementationAddress, migrationData))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId);

        const upgradedDao = await ethers.getContractAt("SourceDaoV2Mock", daoAddress);
        expect(await upgradedDao.version()).to.equal("2.1.0");
        expect(await upgradedDao.bootstrapAdmin()).to.equal(members[0].address);
        expect(await upgradedDao.devToken()).to.equal(moduleAddresses[0]);
        expect(await upgradedDao.normalToken()).to.equal(moduleAddresses[1]);
        expect(await upgradedDao.committee()).to.equal(committeeAddress);
        expect(await upgradedDao.project()).to.equal(moduleAddresses[2]);
        expect(await upgradedDao.lockup()).to.equal(moduleAddresses[3]);
        expect(await upgradedDao.dividend()).to.equal(moduleAddresses[4]);
        expect(await upgradedDao.acquired()).to.equal(moduleAddresses[5]);

        await expect(upgradedDao.setDevTokenAddress(moduleAddresses[0])).to.be.revertedWith("can set once");
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

    it("keeps configured dao wiring and acquired flows operational across dao upgrade", async function () {
        const fixture = await networkHelpers.loadFixture(deployConfiguredUpgradeFixture);
        const daoAddress = await fixture.dao.getAddress();
        const committeeAddress = await fixture.committee.getAddress();
        const proposalId = 1n;
        const params = upgradeParams(daoAddress, fixture.nextDaoImplementationAddress);

        await expect(fixture.committee.connect(fixture.manager).prepareContractUpgrade(daoAddress, fixture.nextDaoImplementationAddress))
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(proposalId, false);

        await (await fixture.committee.connect(fixture.manager).support(proposalId, params)).wait();
        await (await fixture.committee.connect(fixture.memberTwo).support(proposalId, params)).wait();

        await expect(fixture.dao.upgradeToAndCall(fixture.nextDaoImplementationAddress, "0x"))
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(proposalId);

        const upgradedDao = await ethers.getContractAt("SourceDaoV2Mock", daoAddress);
        expect(await upgradedDao.version()).to.equal("2.1.0");
        expect(await upgradedDao.committee()).to.equal(committeeAddress);
        expect(await upgradedDao.project()).to.equal(await fixture.project.getAddress());
        expect(await upgradedDao.devToken()).to.equal(await fixture.devToken.getAddress());
        expect(await upgradedDao.normalToken()).to.equal(await fixture.normalToken.getAddress());
        expect(await upgradedDao.lockup()).to.equal(await fixture.lockup.getAddress());
        expect(await upgradedDao.dividend()).to.equal(await fixture.dividend.getAddress());
        expect(await upgradedDao.acquired()).to.equal(await fixture.acquired.getAddress());
        await expect(upgradedDao.setDevTokenAddress(await fixture.devToken.getAddress())).to.be.revertedWith("can set once");

        const managerNormalBeforeSale = await fixture.normalToken.balanceOf(fixture.manager.address);

        await (await fixture.saleToken.approve(await fixture.acquired.getAddress(), 100n)).wait();
        await (await fixture.acquired.startInvestment({
            whitelist: [fixture.buyer.address],
            firstPercent: [10_000],
            tokenAddress: await fixture.saleToken.getAddress(),
            tokenAmount: 100n,
            tokenRatio: { tokenAmount: 5n, daoTokenAmount: 1n },
            step1Duration: Number(ONE_HOUR),
            step2Duration: Number(ONE_HOUR),
            canEndEarly: false
        })).wait();

        await (await fixture.normalToken.connect(fixture.buyer).approve(await fixture.acquired.getAddress(), 20n)).wait();
        await (await fixture.acquired.connect(fixture.buyer).invest(1n, 20n)).wait();
        await (await fixture.acquired.endInvestment(1n)).wait();

        expect(await fixture.saleToken.balanceOf(fixture.buyer.address)).to.equal(100n);
        expect((await fixture.acquired.getInvestmentInfo(1n)).end).to.equal(true);
        expect(await fixture.normalToken.balanceOf(fixture.manager.address)).to.equal(managerNormalBeforeSale + 20n);
    });

    it("lets bootstrapAdmin initialize a newly added dao module slot after upgrade", async function () {
        const fixture = await networkHelpers.loadFixture(deployConfiguredUpgradeFixture);
        const daoAddress = await fixture.dao.getAddress();
        const proposalId = 1n;
        const nextDaoImplementation = await (await ethers.getContractFactory("SourceDaoV3ExtendedMock")).deploy();
        await nextDaoImplementation.waitForDeployment();
        const nextDaoImplementationAddress = await nextDaoImplementation.getAddress();
        const relayAddress = (await deployDummyModuleAddresses(1))[0];
        const params = upgradeParams(daoAddress, nextDaoImplementationAddress);

        await expect(
            fixture.committee.connect(fixture.manager).prepareContractUpgrade(daoAddress, nextDaoImplementationAddress)
        )
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(proposalId, false);

        await (await fixture.committee.connect(fixture.manager).support(proposalId, params)).wait();
        await (await fixture.committee.connect(fixture.memberTwo).support(proposalId, params)).wait();

        await expect(fixture.dao.upgradeToAndCall(nextDaoImplementationAddress, "0x"))
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(proposalId);

        const upgradedDao = await ethers.getContractAt("SourceDaoV3ExtendedMock", daoAddress);
        expect(await upgradedDao.version()).to.equal("2.2.0");
        expect(await upgradedDao.governanceRelay()).to.equal(ethers.ZeroAddress);
        expect(await upgradedDao.committee()).to.equal(await fixture.committee.getAddress());
        expect(await upgradedDao.project()).to.equal(await fixture.project.getAddress());
        expect(await upgradedDao.devToken()).to.equal(await fixture.devToken.getAddress());

        await expect(
            upgradedDao.connect(fixture.memberTwo).setGovernanceRelayAddress(relayAddress)
        ).to.be.revertedWith("only bootstrap admin");

        await (await upgradedDao.setGovernanceRelayAddress(relayAddress)).wait();
        expect(await upgradedDao.governanceRelay()).to.equal(relayAddress);

        await expect(upgradedDao.setGovernanceRelayAddress(relayAddress)).to.be.revertedWith("can set once");
    });

    it("keeps configured project governance operational across committee upgrade", async function () {
        const fixture = await networkHelpers.loadFixture(deployConfiguredUpgradeFixture);
        const committeeAddress = await fixture.committee.getAddress();
        const proposalId = 1n;
        const params = upgradeParams(committeeAddress, fixture.nextCommitteeImplementationAddress);

        await expect(fixture.committee.connect(fixture.manager).prepareContractUpgrade(
            committeeAddress,
            fixture.nextCommitteeImplementationAddress
        ))
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(proposalId, false);

        await (await fixture.committee.connect(fixture.manager).support(proposalId, params)).wait();
        await (await fixture.committee.connect(fixture.memberTwo).support(proposalId, params)).wait();

        await expect(fixture.committee.upgradeToAndCall(fixture.nextCommitteeImplementationAddress, "0x"))
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(fixture.committee, "ProposalExecuted")
            .withArgs(proposalId);

        const upgradedCommittee = await ethers.getContractAt("SourceDaoCommitteeV2Mock", committeeAddress);
        expect(await upgradedCommittee.version()).to.equal("2.1.0");
        expect(await upgradedCommittee.members()).to.deep.equal([
            fixture.manager.address,
            fixture.memberTwo.address,
            fixture.memberThree.address
        ]);

        const projectRun = await finishProject(fixture, upgradedCommittee);
        expect(projectRun.releaseTime).to.be.greaterThan(0n);
        expect((await fixture.project.projectOf(projectRun.projectId)).state).to.equal(3n);

        await (await fixture.project.connect(fixture.contributor).withdrawContributions([projectRun.projectId])).wait();
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(1_000n);
    });

    it("keeps configured project governance operational across committee upgrade with approved migration calldata", async function () {
        const fixture = await networkHelpers.loadFixture(deployConfiguredUpgradeFixture);
        const committeeAddress = await fixture.committee.getAddress();
        const nextCommitteeImplementation = await (await ethers.getContractFactory("SourceDaoCommitteeV2InitMock")).deploy();
        await nextCommitteeImplementation.waitForDeployment();
        const nextCommitteeImplementationAddress = await nextCommitteeImplementation.getAddress();
        const initData = nextCommitteeImplementation.interface.encodeFunctionData("initializeMarker", [777n]);
        const proposalId = 1n;
        const params = upgradeParams(committeeAddress, nextCommitteeImplementationAddress, initData);

        await expect(
            fixture.committee.connect(fixture.manager)["prepareContractUpgrade(address,address,bytes32)"](
                committeeAddress,
                nextCommitteeImplementationAddress,
                ethers.keccak256(initData)
            )
        )
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(proposalId, false);

        await (await fixture.committee.connect(fixture.manager).support(proposalId, params)).wait();
        await (await fixture.committee.connect(fixture.memberTwo).support(proposalId, params)).wait();

        await expect(fixture.committee.upgradeToAndCall(nextCommitteeImplementationAddress, "0x")).to.be.revertedWith(
            "verify proposal fail"
        );

        await expect(fixture.committee.upgradeToAndCall(nextCommitteeImplementationAddress, initData))
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(fixture.committee, "ProposalExecuted")
            .withArgs(proposalId);

        const upgradedCommittee = await ethers.getContractAt("SourceDaoCommitteeV2InitMock", committeeAddress);
        expect(await upgradedCommittee.version()).to.equal("2.1.1");
        expect(await upgradedCommittee.upgradeMarker()).to.equal(777n);

        const projectRun = await finishProject(fixture, upgradedCommittee);
        expect(projectRun.releaseTime).to.be.greaterThan(0n);
        expect((await fixture.project.projectOf(projectRun.projectId)).state).to.equal(3n);

        await (await fixture.project.connect(fixture.contributor).withdrawContributions([projectRun.projectId])).wait();
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(1_000n);
    });
});
