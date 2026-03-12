import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const MAIN_PROJECT_NAME = ethers.encodeBytes32String("main");

function addMemberParams(member: string) {
    return [
        ethers.zeroPadValue(member, 32),
        ethers.encodeBytes32String("addMember")
    ];
}

function removeMemberParams(member: string) {
    return [
        ethers.zeroPadValue(member, 32),
        ethers.encodeBytes32String("removeMember")
    ];
}

function setCommitteesParams(members: string[]) {
    return [
        ...members.map((member) => ethers.zeroPadValue(member, 32)),
        ethers.encodeBytes32String("setCommittees")
    ];
}

function setDevRatioParams(devRatio: bigint) {
    return [
        ethers.zeroPadValue(ethers.toBeHex(devRatio), 32),
        ethers.encodeBytes32String("setDevRatio")
    ];
}

function fullProposalParams(label: string) {
    return [ethers.encodeBytes32String(label)];
}

async function deployCommitteeFixture() {
    const signers = await ethers.getSigners();
    const members = signers.slice(1, 4);
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

    return {
        committee,
        dao,
        members,
        candidate: signers[4],
        outsider: signers[5]
    };
}

async function deployCommitteeGovernanceFixture() {
    const signers = await ethers.getSigners();
    const members = signers.slice(1, 4);
    const dao = await deployUUPSProxy(ethers, "SourceDao");
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

    return {
        committee,
        dao,
        devToken,
        normalToken,
        project,
        proposalCaller,
        members,
        outsider: signers[4]
    };
}

async function passAddMemberProposal(
    committee: any,
    voters: any[],
    member: string,
    proposalId: bigint = 1n
) {
    const params = addMemberParams(member);

    await (await committee.connect(voters[0]).prepareAddMember(member)).wait();

    for (const voter of voters.slice(0, 2)) {
        await (await committee.connect(voter).support(proposalId, params)).wait();
    }

    await (await committee.addCommitteeMember(member, proposalId)).wait();
}

describe("Committee", function () {
    it("tracks the initialized committee membership", async function () {
        const { committee, members, outsider } = await networkHelpers.loadFixture(deployCommitteeFixture);

        expect(await committee.members()).to.deep.equal(
            members.map((member: { address: string }) => member.address)
        );

        for (const member of members) {
            expect(await committee.isMember(member.address)).to.equal(true);
        }

        expect(await committee.isMember(outsider.address)).to.equal(false);
    });

    it("accepts an add-member proposal once a committee majority supports it", async function () {
        const { committee, members, candidate, outsider } = await networkHelpers.loadFixture(deployCommitteeFixture);
        const proposalId = 1n;
        const params = addMemberParams(candidate.address);

        await expect(committee.connect(outsider).prepareAddMember(candidate.address)).to.be.revertedWith(
            "only committee can add member"
        );

        await expect(committee.connect(members[0]).prepareAddMember(candidate.address))
            .to.emit(committee, "ProposalStart")
            .withArgs(proposalId, false);

        await expect(committee.connect(outsider).reject(proposalId, params))
            .to.emit(committee, "ProposalVoted")
            .withArgs(outsider.address, proposalId, false);

        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        const inProgressProposal = await committee.proposalOf(proposalId);
        expect(inProgressProposal.state).to.equal(1n);
        expect(inProgressProposal.support).to.deep.equal([
            members[0].address,
            members[1].address
        ]);
        expect(inProgressProposal.reject).to.deep.equal([outsider.address]);

        await expect(committee.addCommitteeMember(candidate.address, proposalId))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(committee, "MemberAdded")
            .withArgs(candidate.address);

        const executedProposal = await committee.proposalOf(proposalId);
        expect(executedProposal.state).to.equal(4n);
        expect(await committee.isMember(candidate.address)).to.equal(true);
        expect(await committee.members()).to.deep.equal([
            members[0].address,
            members[1].address,
            members[2].address,
            candidate.address
        ]);
    });

    it("removes a member after a new majority accepts the removal proposal", async function () {
        const { committee, members, candidate } = await networkHelpers.loadFixture(deployCommitteeFixture);

        await passAddMemberProposal(committee, members, candidate.address);

        const proposalId = 2n;
        const params = removeMemberParams(candidate.address);

        await expect(committee.connect(members[0]).prepareRemoveMember(candidate.address))
            .to.emit(committee, "ProposalStart")
            .withArgs(proposalId, false);

        for (const voter of members) {
            await (await committee.connect(voter).support(proposalId, params)).wait();
        }

        await expect(committee.removeCommitteeMember(candidate.address, proposalId))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(committee, "MemberRemoved")
            .withArgs(candidate.address);

        const executedProposal = await committee.proposalOf(proposalId);
        expect(executedProposal.state).to.equal(4n);
        expect(await committee.isMember(candidate.address)).to.equal(false);
        expect(await committee.members()).to.deep.equal([
            members[0].address,
            members[1].address,
            members[2].address
        ]);
    });

    it("expires an untouched proposal after the voting window closes", async function () {
        const { committee, members, candidate } = await networkHelpers.loadFixture(deployCommitteeFixture);
        const proposalId = 1n;
        const params = addMemberParams(candidate.address);

        await (await committee.connect(members[0]).prepareAddMember(candidate.address)).wait();
        await networkHelpers.time.increase(SEVEN_DAYS + 1);

        await expect(committee.connect(members[0]).support(proposalId, params)).to.be.revertedWith(
            "proposal expired"
        );

        await expect(committee.settleProposal(proposalId))
            .to.emit(committee, "ProposalExpire")
            .withArgs(proposalId);

        const expiredProposal = await committee.proposalOf(proposalId);
        expect(expiredProposal.state).to.equal(5n);
    });

    it("replaces the committee set after majority approval", async function () {
        const { committee, members, candidate, outsider } = await networkHelpers.loadFixture(deployCommitteeFixture);
        const replacementMembers = [members[0].address, candidate.address, outsider.address];
        const params = setCommitteesParams(replacementMembers);
        const proposalId = 1n;

        await expect(committee.connect(outsider).prepareSetCommittees(replacementMembers, false)).to.be.revertedWith(
            "only committee can set member"
        );

        await expect(committee.connect(members[0]).prepareSetCommittees(replacementMembers, false))
            .to.emit(committee, "ProposalStart")
            .withArgs(proposalId, false);

        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        await expect(committee.setCommittees(replacementMembers, proposalId))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(committee, "MemberChanged");

        expect(await committee.members()).to.deep.equal(replacementMembers);
        expect(await committee.isMember(members[1].address)).to.equal(false);
        expect(await committee.isMember(members[2].address)).to.equal(false);
        expect(await committee.isMember(candidate.address)).to.equal(true);
        expect(await committee.isMember(outsider.address)).to.equal(true);

        await expect(committee.connect(members[1]).prepareAddMember(members[2].address)).to.be.revertedWith(
            "only committee can add member"
        );
    });

    it("rejects removing a non-member before and after proposal execution", async function () {
        const { committee, members, candidate, outsider } = await networkHelpers.loadFixture(deployCommitteeFixture);

        await expect(committee.connect(members[0]).prepareRemoveMember(candidate.address)).to.be.revertedWith(
            "member not found"
        );

        await passAddMemberProposal(committee, members, candidate.address);

        const removeProposalId = 2n;
        const removeParams = removeMemberParams(candidate.address);

        await (await committee.connect(members[0]).prepareRemoveMember(candidate.address)).wait();
        await (await committee.connect(members[0]).support(removeProposalId, removeParams)).wait();
        await (await committee.connect(members[1]).support(removeProposalId, removeParams)).wait();
        await (await committee.connect(candidate).support(removeProposalId, removeParams)).wait();

        const replacementMembers = [members[0].address, members[1].address, outsider.address];
        const setProposalId = 3n;
        const setParams = setCommitteesParams(replacementMembers);

        await (await committee.connect(members[0]).prepareSetCommittees(replacementMembers, false)).wait();
        await (await committee.connect(members[0]).support(setProposalId, setParams)).wait();
        await (await committee.connect(members[1]).support(setProposalId, setParams)).wait();
        await (await committee.connect(candidate).support(setProposalId, setParams)).wait();
        await (await committee.setCommittees(replacementMembers, setProposalId)).wait();

        await expect(committee.removeCommitteeMember(candidate.address, removeProposalId)).to.be.revertedWith(
            "member not found"
        );
    });

    it("updates devRatio after majority approval and enforces its guardrails", async function () {
        const { committee, members, outsider } = await networkHelpers.loadFixture(deployCommitteeGovernanceFixture);
        const proposalId = 1n;
        const newRatio = 180n;
        const params = setDevRatioParams(newRatio);

        await expect(committee.connect(outsider).prepareSetDevRatio(newRatio)).to.be.revertedWith(
            "only committee can set dev ratio"
        );
        await expect(committee.connect(members[0]).prepareSetDevRatio(200)).to.be.revertedWith(
            "new dev ratio must less then old one"
        );
        await expect(committee.connect(members[0]).prepareSetDevRatio(149)).to.be.revertedWith(
            "new dev ratio must greater then final one"
        );

        await expect(committee.connect(members[0]).prepareSetDevRatio(newRatio))
            .to.emit(committee, "ProposalStart")
            .withArgs(proposalId, false);

        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        await expect(committee.setDevRatio(newRatio, proposalId))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(committee, "DevRatioChanged")
            .withArgs(200n, newRatio)
            .to.emit(committee, "ProposalExecuted")
            .withArgs(proposalId);

        expect(await committee.devRatio()).to.equal(newRatio);
        expect((await committee.proposalOf(proposalId)).state).to.equal(4n);
    });

    it("locks devRatio to finalRatio once the final version is released", async function () {
        const { committee, members, project } = await networkHelpers.loadFixture(deployCommitteeGovernanceFixture);
        const proposalId = 1n;
        const pendingRatio = 180n;
        const params = setDevRatioParams(pendingRatio);
        const latestBlock = await ethers.provider.getBlock("latest");

        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        await (await committee.connect(members[0]).prepareSetDevRatio(pendingRatio)).wait();
        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).support(proposalId, params)).wait();

        await (await project.setVersionReleasedTime(MAIN_PROJECT_NAME, 1, latestBlock.timestamp)).wait();

        await expect(committee.connect(members[2]).prepareSetDevRatio(170)).to.be.revertedWith(
            "cannot set dev ratio after final version released"
        );

        await expect(committee.setDevRatio(pendingRatio, proposalId))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId)
            .to.emit(committee, "DevRatioChanged")
            .withArgs(200n, 150n)
            .to.emit(committee, "ProposalExecuted")
            .withArgs(proposalId);

        expect(await committee.devRatio()).to.equal(150n);
        expect((await committee.proposalOf(proposalId)).state).to.equal(4n);
    });

    it("settles full proposals by token-weighted turnout and vote balance", async function () {
        const { committee, proposalCaller, members, outsider } = await networkHelpers.loadFixture(deployCommitteeGovernanceFixture);
        const acceptedProposalId = 1n;
        const expiredProposalId = 2n;
        const acceptedParams = fullProposalParams("full-accept");
        const expiredParams = fullProposalParams("full-expire");

        await expect(committee.connect(outsider).fullPropose(SEVEN_DAYS, acceptedParams, 40)).to.be.revertedWith(
            "only DAO contract can propose"
        );

        await expect(proposalCaller.connect(outsider).fullPropose(await committee.getAddress(), SEVEN_DAYS, acceptedParams, 40))
            .to.emit(committee, "ProposalStart")
            .withArgs(acceptedProposalId, true);

        await (await committee.connect(members[0]).support(acceptedProposalId, acceptedParams)).wait();
        await (await committee.connect(members[1]).reject(acceptedProposalId, acceptedParams)).wait();

        await expect(proposalCaller.connect(outsider).fullPropose(await committee.getAddress(), SEVEN_DAYS, expiredParams, 80))
            .to.emit(committee, "ProposalStart")
            .withArgs(expiredProposalId, true);

        await (await committee.connect(members[1]).support(expiredProposalId, expiredParams)).wait();

        await networkHelpers.time.increase(SEVEN_DAYS + 1);

        await expect(committee.endFullPropose(acceptedProposalId, [members[0].address, members[1].address]))
            .to.emit(committee, "ProposalAccept")
            .withArgs(acceptedProposalId);

        const acceptedExtra = await committee.proposalExtraOf(acceptedProposalId);
        expect(acceptedExtra.agree).to.equal(4_000n);
        expect(acceptedExtra.reject).to.equal(2_000n);
        expect(acceptedExtra.settled).to.equal(2n);
        expect(acceptedExtra.totalReleasedToken).to.equal(8_000n);
        expect((await committee.proposalOf(acceptedProposalId)).state).to.equal(2n);

        await expect(committee.endFullPropose(expiredProposalId, [members[1].address]))
            .to.emit(committee, "ProposalExpire")
            .withArgs(expiredProposalId);

        const expiredExtra = await committee.proposalExtraOf(expiredProposalId);
        expect(expiredExtra.agree).to.equal(2_000n);
        expect(expiredExtra.reject).to.equal(0n);
        expect(expiredExtra.totalReleasedToken).to.equal(8_000n);
        expect((await committee.proposalOf(expiredProposalId)).state).to.equal(5n);
    });

    it("settles full proposals across batches without double counting repeated voters", async function () {
        const { committee, proposalCaller, members } = await networkHelpers.loadFixture(deployCommitteeGovernanceFixture);
        const proposalId = 1n;
        const params = fullProposalParams("full-batched");

        await (await proposalCaller.fullPropose(await committee.getAddress(), SEVEN_DAYS, params, 40)).wait();
        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).reject(proposalId, params)).wait();
        await (await committee.connect(members[2]).support(proposalId, params)).wait();

        await networkHelpers.time.increase(SEVEN_DAYS + 1);

        await (await committee.endFullPropose(proposalId, [members[0].address])).wait();

        const partialExtra = await committee.proposalExtraOf(proposalId);
        expect(partialExtra.agree).to.equal(4_000n);
        expect(partialExtra.reject).to.equal(0n);
        expect(partialExtra.settled).to.equal(1n);
        expect(partialExtra.totalReleasedToken).to.equal(8_000n);
        expect((await committee.proposalOf(proposalId)).state).to.equal(1n);

        await expect(committee.endFullPropose(proposalId, [
            members[0].address,
            members[1].address,
            members[2].address,
            members[0].address
        ]))
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId);

        const finalExtra = await committee.proposalExtraOf(proposalId);
        expect(finalExtra.agree).to.equal(6_000n);
        expect(finalExtra.reject).to.equal(2_000n);
        expect(finalExtra.settled).to.equal(3n);
        expect(finalExtra.totalReleasedToken).to.equal(8_000n);
        expect((await committee.proposalOf(proposalId)).state).to.equal(2n);
    });

    it("rejects a full proposal when turnout clears the threshold but weighted votes tie", async function () {
        const { committee, proposalCaller, devToken, members } = await networkHelpers.loadFixture(deployCommitteeGovernanceFixture);
        const proposalId = 1n;
        const params = fullProposalParams("full-tie");

        await (await devToken.connect(members[0]).dev2normal(1_000)).wait();

        await (await proposalCaller.fullPropose(await committee.getAddress(), SEVEN_DAYS, params, 85)).wait();
        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).reject(proposalId, params)).wait();
        await (await committee.connect(members[2]).reject(proposalId, params)).wait();

        await networkHelpers.time.increase(SEVEN_DAYS + 1);

        await expect(committee.endFullPropose(proposalId, [members[0].address, members[1].address, members[2].address]))
            .to.emit(committee, "ProposalReject")
            .withArgs(proposalId);

        const extra = await committee.proposalExtraOf(proposalId);
        expect(extra.agree).to.equal(3_000n);
        expect(extra.reject).to.equal(4_000n);
        expect(extra.totalReleasedToken).to.equal(7_000n);
        expect((await committee.proposalOf(proposalId)).state).to.equal(3n);
    });

    it("uses finalRatio weights when settling a full proposal after the final release", async function () {
        const { committee, proposalCaller, members, project } = await networkHelpers.loadFixture(deployCommitteeGovernanceFixture);
        const proposalId = 1n;
        const params = fullProposalParams("full-final-ratio");
        const latestBlock = await ethers.provider.getBlock("latest");

        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        await (await proposalCaller.fullPropose(await committee.getAddress(), SEVEN_DAYS, params, 75)).wait();
        await (await committee.connect(members[0]).support(proposalId, params)).wait();
        await (await committee.connect(members[1]).reject(proposalId, params)).wait();
        await (await project.setVersionReleasedTime(MAIN_PROJECT_NAME, 1, latestBlock.timestamp)).wait();

        await networkHelpers.time.increase(SEVEN_DAYS + 1);

        await expect(committee.endFullPropose(proposalId, [members[0].address, members[1].address]))
            .to.emit(committee, "DevRatioChanged")
            .withArgs(200n, 150n)
            .to.emit(committee, "ProposalAccept")
            .withArgs(proposalId);

        const extra = await committee.proposalExtraOf(proposalId);
        expect(extra.agree).to.equal(3_000n);
        expect(extra.reject).to.equal(1_500n);
        expect(extra.totalReleasedToken).to.equal(6_000n);
        expect(await committee.devRatio()).to.equal(150n);
        expect((await committee.proposalOf(proposalId)).state).to.equal(2n);
    });
});
