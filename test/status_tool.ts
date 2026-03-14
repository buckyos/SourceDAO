import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";
import { formatDaoStatus, formatProposalStatus, readDaoStatus, readProposalStatus } from "../tools/status_common.js";

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
});
