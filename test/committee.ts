import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

const SEVEN_DAYS = 7 * 24 * 60 * 60;

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
});
