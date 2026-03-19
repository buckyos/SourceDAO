import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";
import {
    formatCommitteeStatus,
    formatDaoStatus,
    formatProjectStatus,
    formatProposalStatus,
    readCommitteeStatus,
    readDaoStatus,
    readProjectStatus,
    readProposalStatus
} from "../tools/status_common.js";

const { ethers, networkHelpers } = await hre.network.connect();
const THIRTY_DAYS = 30 * 24 * 60 * 60;

function setDevRatioParams(devRatio: bigint) {
    return [
        ethers.zeroPadValue(ethers.toBeHex(devRatio), 32),
        ethers.encodeBytes32String("setDevRatio")
    ];
}

function setCommitteesParams(members: string[]) {
    return [
        ...members.map((member) => ethers.zeroPadValue(member, 32)),
        ethers.encodeBytes32String("setCommittees")
    ];
}

async function deployModuleMocks(count: number) {
    const factory = await ethers.getContractFactory("NativeReceiverMock");
    const deployments = [];
    for (let i = 0; i < count; i++) {
        const contract = await factory.deploy();
        await contract.waitForDeployment();
        deployments.push(await contract.getAddress());
    }

    return deployments;
}

async function deployDaoStatusFixture() {
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const modules = await deployModuleMocks(7);

    await (await dao.setDevTokenAddress(modules[0])).wait();
    await (await dao.setNormalTokenAddress(modules[1])).wait();
    await (await dao.setCommitteeAddress(modules[2])).wait();
    await (await dao.setProjectAddress(modules[3])).wait();
    await (await dao.setTokenLockupAddress(modules[4])).wait();
    await (await dao.setTokenDividendAddress(modules[5])).wait();
    await (await dao.setAcquiredAddress(modules[6])).wait();

    return {
        dao,
        modules
    };
}

async function deployMiswiredCommitteeStatusFixture() {
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const wrongCommittee = await (await ethers.getContractFactory("NativeReceiverMock")).deploy();
    await wrongCommittee.waitForDeployment();

    const modules = await deployModuleMocks(6);
    await (await dao.setDevTokenAddress(modules[0])).wait();
    await (await dao.setNormalTokenAddress(modules[1])).wait();
    await (await dao.setCommitteeAddress(await wrongCommittee.getAddress())).wait();
    await (await dao.setProjectAddress(modules[2])).wait();
    await (await dao.setTokenLockupAddress(modules[3])).wait();
    await (await dao.setTokenDividendAddress(modules[4])).wait();
    await (await dao.setAcquiredAddress(modules[5])).wait();

    return {
        dao,
        wrongCommittee
    };
}

async function deployProposalStatusFixture() {
    const signers = await ethers.getSigners();
    const members = signers.slice(1, 4);
    const outsider = signers[5];
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        members.map((signer: { address: string }) => signer.address),
        1,
        200,
        ethers.encodeBytes32String("main"),
        1,
        150,
        daoAddress
    ]);
    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();

    const project = await (await ethers.getContractFactory("ProjectVersionMock")).deploy();
    await project.waitForDeployment();
    await (await dao.setProjectAddress(await project.getAddress())).wait();

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

    return {
        dao,
        committee,
        project,
        devToken,
        normalToken,
        members,
        outsider
    };
}

async function deployProjectStatusFixture() {
    const signers = await ethers.getSigners();
    const manager = signers[1];
    const contributor = signers[2];
    const members = signers.slice(3, 6);
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        members.map((signer: { address: string }) => signer.address),
        1,
        200,
        ethers.encodeBytes32String("main"),
        1,
        150,
        daoAddress
    ]);
    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();

    const project = await deployUUPSProxy(ethers, "ProjectManagement", [1, daoAddress]);
    await (await dao.setProjectAddress(await project.getAddress())).wait();

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

    const now = await networkHelpers.time.latest();
    await project.connect(manager).createProject(
        200,
        ethers.encodeBytes32String("main"),
        1,
        now,
        now + THIRTY_DAYS,
        [],
        []
    );

    await committee.connect(members[0]).support(1, setCreateProjectParams(1n, "main", 1n, BigInt(now), BigInt(now + THIRTY_DAYS)));
    await committee.connect(members[1]).support(1, setCreateProjectParams(1n, "main", 1n, BigInt(now), BigInt(now + THIRTY_DAYS)));
    await project.connect(manager).promoteProject(1);

    await project.connect(manager).acceptProject(1, 4, [
        { contributor: manager.address, value: 40 },
        { contributor: contributor.address, value: 60 }
    ]);

    await committee.connect(members[0]).support(2, setAcceptProjectParams(1n, "main", 1n, BigInt(now), BigInt(now + THIRTY_DAYS)));
    await committee.connect(members[1]).support(2, setAcceptProjectParams(1n, "main", 1n, BigInt(now), BigInt(now + THIRTY_DAYS)));
    await project.connect(manager).promoteProject(1);
    await project.connect(contributor).withdrawContributions([1]);

    return {
        dao,
        committee,
        project,
        manager,
        contributor,
        members
    };
}

function setCreateProjectParams(
    projectId: bigint,
    projectName: string,
    version: bigint,
    startDate: bigint,
    endDate: bigint
) {
    return [
        ethers.zeroPadValue(ethers.toBeHex(projectId), 32),
        ethers.encodeBytes32String(projectName),
        ethers.zeroPadValue(ethers.toBeHex(version), 32),
        ethers.zeroPadValue(ethers.toBeHex(startDate), 32),
        ethers.zeroPadValue(ethers.toBeHex(endDate), 32),
        ethers.encodeBytes32String("createProject")
    ];
}

function setAcceptProjectParams(
    projectId: bigint,
    projectName: string,
    version: bigint,
    startDate: bigint,
    endDate: bigint
) {
    return [
        ethers.zeroPadValue(ethers.toBeHex(projectId), 32),
        ethers.encodeBytes32String(projectName),
        ethers.zeroPadValue(ethers.toBeHex(version), 32),
        ethers.zeroPadValue(ethers.toBeHex(startDate), 32),
        ethers.zeroPadValue(ethers.toBeHex(endDate), 32),
        ethers.encodeBytes32String("acceptProject")
    ];
}

describe("status tools", function () {
    it("reads dao status across all configured modules", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoStatusFixture);
        const status = await readDaoStatus(ethers, await fixture.dao.getAddress());

        expect(status.daoAddress).to.equal(await fixture.dao.getAddress());
        expect(status.version).to.equal("2.0.0");
        expect(status.selfRecognizedAsDaoContract).to.equal(true);
        expect(status.modules).to.have.length(7);
        expect(status.modules.every((module) => module.configured)).to.equal(true);
        expect(status.modules.every((module) => module.hasCode)).to.equal(true);
        expect(status.modules.every((module) => module.isDaoContract)).to.equal(true);
        expect(status.modules.every((module) => module.version === null)).to.equal(true);
        expect(formatDaoStatus(status)).to.contain("Modules:");
    });

    it("surfaces a miswired committee slot in dao status and fails fast in committee status", async function () {
        const fixture = await networkHelpers.loadFixture(deployMiswiredCommitteeStatusFixture);
        const daoAddress = await fixture.dao.getAddress();
        const status = await readDaoStatus(ethers, daoAddress);
        const committeeModule = status.modules.find((module) => module.key === "committee");

        expect(committeeModule).to.not.equal(undefined);
        expect(committeeModule?.address).to.equal(await fixture.wrongCommittee.getAddress());
        expect(committeeModule?.configured).to.equal(true);
        expect(committeeModule?.hasCode).to.equal(true);
        expect(committeeModule?.isDaoContract).to.equal(true);
        expect(committeeModule?.version).to.equal(null);
        expect(formatDaoStatus(status)).to.contain(`committee: ${await fixture.wrongCommittee.getAddress()}`);
        expect(formatDaoStatus(status)).to.contain("version=n/a");

        let failed = false;
        try {
            await readCommitteeStatus(ethers, daoAddress);
        } catch {
            failed = true;
        }
        expect(failed).to.equal(true);
    });

    it("reads ordinary proposal status from committee governance", async function () {
        const fixture = await networkHelpers.loadFixture(deployProposalStatusFixture);
        await fixture.committee.connect(fixture.members[0]).prepareSetDevRatio(180);
        const proposalId = 1;

        await fixture.committee
            .connect(fixture.members[0])
            .support(proposalId, setDevRatioParams(180n));

        const status = await readProposalStatus(ethers, await fixture.dao.getAddress(), proposalId);

        expect(status.exists).to.equal(true);
        expect(status.kind).to.equal("ordinary");
        expect(status.stateName).to.equal("InProgress");
        expect(status.supportCount).to.equal(1);
        expect(status.rejectCount).to.equal(0);
        expect(status.supportAddresses).to.deep.equal([fixture.members[0].address]);
        expect(status.full).to.equal(null);
        expect(formatProposalStatus(status)).to.contain("Snapshot version: not exposed");
    });

    it("reads full proposal status and pending settle count", async function () {
        const fixture = await networkHelpers.loadFixture(deployProposalStatusFixture);
        const newCommittees = fixture.members.map((member: { address: string }) => member.address);
        await fixture.committee.connect(fixture.outsider).prepareSetCommittees(newCommittees, true);
        const proposalId = 1;

        await fixture.committee
            .connect(fixture.members[0])
            .support(proposalId, setCommitteesParams(newCommittees));

        const status = await readProposalStatus(ethers, await fixture.dao.getAddress(), proposalId);

        expect(status.kind).to.equal("full");
        expect(status.supportCount).to.equal(1);
        expect(status.full).to.not.equal(null);
        expect(status.full?.proposer).to.equal(fixture.outsider.address);
        expect(status.full?.threshold).to.equal("40");
        expect(status.full?.pendingSettleCount).to.equal(1);
        expect(formatProposalStatus(status)).to.contain("Pending settle count: 1");
    });

    it("reads committee governance status and observed voter eligibility", async function () {
        const fixture = await networkHelpers.loadFixture(deployProposalStatusFixture);
        const status = await readCommitteeStatus(ethers, await fixture.dao.getAddress(), fixture.members[0].address);

        expect(status.committeeAddress).to.equal(await fixture.committee.getAddress());
        expect(status.version).to.equal("2.0.0");
        expect(status.committeeVersion).to.equal("1");
        expect(status.memberCount).to.equal(3);
        expect(status.members).to.deep.equal(fixture.members.map((member: { address: string }) => member.address));
        expect(status.devRatio).to.equal("200");
        expect(status.finalRatio).to.equal("150");
        expect(status.finalRatioCurrentlyApplied).to.equal(false);
        expect(status.mainProjectName).to.equal("main");
        expect(status.finalVersionText).to.equal("0.0.1");
        expect(status.finalVersionReleased).to.equal(false);
        expect(status.observed?.address).to.equal(fixture.members[0].address);
        expect(status.observed?.isCurrentMember).to.equal(true);
        expect(status.observed?.currentOrdinaryProposalEligible).to.equal(true);
        expect(status.observed?.currentFullProposalEligible).to.equal(true);
        expect(status.observed?.devTokenBalance).to.equal("2000");
        expect(status.observed?.normalTokenBalance).to.equal("0");
        expect(status.observed?.currentFullProposalVotingPower).to.equal("4000");
        expect(formatCommitteeStatus(status)).to.contain("Committee version: 1");
        expect(formatCommitteeStatus(status)).to.contain("Observed full proposal voting power: 4000");
    });

    it("reports final version release and outsider ineligibility in committee status", async function () {
        const fixture = await networkHelpers.loadFixture(deployProposalStatusFixture);
        await fixture.project.setVersionReleasedTime(ethers.encodeBytes32String("main"), 1, 1234);

        const status = await readCommitteeStatus(ethers, await fixture.dao.getAddress(), fixture.outsider.address);

        expect(status.finalVersionReleased).to.equal(true);
        expect(status.finalVersionReleasedAt).to.equal("1234");
        expect(status.finalVersionReleasedAtIso).to.equal(new Date(1234 * 1000).toISOString());
        expect(status.observed?.isCurrentMember).to.equal(false);
        expect(status.observed?.currentOrdinaryProposalEligible).to.equal(false);
        expect(status.observed?.currentFullProposalEligible).to.equal(false);
        expect(status.observed?.currentFullProposalVotingPower).to.equal("0");
        expect(formatCommitteeStatus(status)).to.contain("Final version released: true");
        expect(formatCommitteeStatus(status)).to.contain("Observed full proposal eligible: false");
    });

    it("reads project lifecycle status, contribution details, and observed contributor claim state", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectStatusFixture);
        const status = await readProjectStatus(ethers, await fixture.dao.getAddress(), 1, fixture.contributor.address);

        expect(status.projectAddress).to.equal(await fixture.project.getAddress());
        expect(status.projectId).to.equal(1);
        expect(status.exists).to.equal(true);
        expect(status.manager).to.equal(fixture.manager.address);
        expect(status.projectName).to.equal("main");
        expect(status.versionText).to.equal("0.0.1");
        expect(status.stateName).to.equal("Finished");
        expect(status.resultName).to.equal("Good");
        expect(status.proposalStateName).to.equal("Executed");
        expect(status.contributionCount).to.equal(2);
        expect(status.totalContribution).to.equal("100");
        expect(status.requestedVersionReleased).to.equal(true);
        expect(status.latestKnownVersionText).to.equal("0.0.1");
        expect(status.observed?.address).to.equal(fixture.contributor.address);
        expect(status.observed?.contributionValue).to.equal("60");
        expect(status.observed?.hasClaim).to.equal(true);
        expect(formatProjectStatus(status)).to.contain("State: Finished (3)");
        expect(formatProjectStatus(status)).to.contain("Observed has claimed: true");
    });
});
