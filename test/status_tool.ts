import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";
import {
    formatCommitteeStatus,
    formatDaoStatus,
    formatProposalStatus,
    readCommitteeStatus,
    readDaoStatus,
    readProposalStatus
} from "../tools/status_common.js";

const { ethers, networkHelpers } = await hre.network.connect();

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
    await (await dao.finalizeInitialization()).wait();

    return {
        dao,
        modules
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

describe("status tools", function () {
    it("reads finalized dao status across all configured modules", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoStatusFixture);
        const status = await readDaoStatus(ethers, await fixture.dao.getAddress());

        expect(status.daoAddress).to.equal(await fixture.dao.getAddress());
        expect(status.version).to.equal("2.0.0");
        expect(status.bootstrapFinalized).to.equal(true);
        expect(status.selfRecognizedAsDaoContract).to.equal(true);
        expect(status.modules).to.have.length(7);
        expect(status.modules.every((module) => module.configured)).to.equal(true);
        expect(status.modules.every((module) => module.hasCode)).to.equal(true);
        expect(status.modules.every((module) => module.isDaoContract)).to.equal(true);
        expect(status.modules.every((module) => module.version === null)).to.equal(true);
        expect(formatDaoStatus(status)).to.contain("Bootstrap finalized: true");
        expect(formatDaoStatus(status)).to.contain("Modules:");
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
});
