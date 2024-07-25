import { ethers, upgrades } from "hardhat";
import { SourceDaoCommittee } from "../typechain-types";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { normalizeToBigInt } from "hardhat/common";
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import chai from "chai";
import deepEqualInAnyOrder from 'deep-equal-in-any-order';

chai.use(deepEqualInAnyOrder);

describe("Committee", () => {
    let signers: HardhatEthersSigner[];
    let committee: SourceDaoCommittee;
    let committeeAddrs: string[] = [];
    let committeeSigners: HardhatEthersSigner[] = [];

    before(async () => {
        signers = await ethers.getSigners();
        // signers1,2,3为committee
        for (let i = 1; i <= 3; i++) {
            committeeAddrs.push(signers[i].address);
            committeeSigners.push(signers[i]);
        }

        committee = (await upgrades.deployProxy(
            await ethers.getContractFactory("SourceDaoCommittee"),
            [committeeAddrs, ethers.ZeroAddress],
            { kind: "uups" })) as unknown as SourceDaoCommittee;
    })

    it("member check", async () => {
        for (let member of committeeAddrs) {
            expect(await committee.isMember(member)).to.equal(true);
        }

        for (let signer of signers) {
            let isCommettee = committeeAddrs.includes(signer.address);
            expect(await committee.isMember(signer.address)).to.equal(isCommettee);
        }

        expect(await committee.members()).deep.equal(committeeAddrs);
        /*
        expect(members.length).to.equal(committees.length);
        for (let committee of committees) {
          let exist = false;
          for (let member of members) {
            if (member === committee) {
              exist = true;
              break;
            }
          }
          expect(exist).to.equal(true);
        }*/

    });

    it("proposal support test", async () => {
        let params = [];
        {
            let data = Buffer.alloc(32);
            data.write("test");
            params.push(data);
        }

        {
            let data = Buffer.alloc(32);
            data.writeBigInt64LE(normalizeToBigInt(1234));
            params.push(data);
        }

        await expect(committee.propose(10, params)).to.emit(committee, "ProposalStart").withArgs(1, false);

        expect((await committee.proposalOf(1)).state).to.equal(1);

        for (let signer of committeeSigners) {
            await (await committee.connect(signer).support(1, params)).wait();
        }

        await expect(committee.takeResult(1, params)).to.be.emit(committee, "ProposalAccept").withArgs(1);

        expect((await committee.proposalOf(1)).state).to.equal(2);
    });

    it("propose reject test", async () => {
        let params = [];
        {
            let data = Buffer.alloc(32);
            data.write("test");
            params.push(data);
        }
        {
            let data = Buffer.alloc(32);
            data.writeBigInt64LE(normalizeToBigInt(1234));
            params.push(data);
        }

        await expect(committee.propose(10, params)).to.emit(committee, "ProposalStart").withArgs(2, false);

        expect((await committee.proposalOf(2)).state).to.equal(1);
        for (let signer of committeeSigners) {
            await (await committee.connect(signer).reject(2, params)).wait();
        }

        await expect(committee.takeResult(2, params)).to.be.emit(committee, "ProposalReject").withArgs(2);

        expect((await committee.proposalOf(2)).state).to.equal(3);
    });

    it("propose most reject test", async () => {
        let params = [];
        {
            let data = Buffer.alloc(32);
            data.write("test");
            params.push(data);
        }
        {
            let data = Buffer.alloc(32);
            data.writeBigInt64LE(normalizeToBigInt(1234));
            params.push(data);
        }
        await expect(committee.propose(10, params)).to.emit(committee, "ProposalStart").withArgs(3, false);

        expect((await committee.proposalOf(3)).state).to.equal(1);

        let i = 0;
        for (let signer of committeeSigners) {
            if (i < 2) {
                await (await committee.connect(signer).reject(3, params)).wait();
            } else {
                await (await committee.connect(signer).support(3, params)).wait();
            }
            
            i++;
        }

        await expect(committee.takeResult(3, params)).to.be.emit(committee, "ProposalReject").withArgs(3);

        expect((await committee.proposalOf(3)).state).to.equal(3);
    });

    it("propose most support test", async () => {

        let params = [];
        {
            let data = Buffer.alloc(32);
            data.write("test");
            params.push(data);
        }
        {
            let data = Buffer.alloc(32);
            data.writeBigInt64LE(normalizeToBigInt(1234));
            params.push(data);
        }
        await expect(committee.propose(10, params)).to.emit(committee, "ProposalStart").withArgs(4, false);

        expect((await committee.proposalOf(4)).state).to.equal(1);

        let i = 0;
        for (let signer of committeeSigners) {
            if (i < 2) {
                await (await committee.connect(signer).support(4, params)).wait();
            } else {
                await (await committee.connect(signer).reject(4, params)).wait();
            }
            
            i++;
        }

        await expect(committee.takeResult(4, params)).to.be.emit(committee, "ProposalAccept").withArgs(4);

        expect((await committee.proposalOf(4)).state).to.equal(2);
    });

    it("propose expire test", async () => {
        let params = [];
        {
            let data = Buffer.alloc(32);
            data.write("test");
            params.push(data);
        }
        {
            let data = Buffer.alloc(32);
            data.writeBigInt64LE(normalizeToBigInt(1234));
            params.push(data);
        }
        await expect(committee.propose(10, params)).to.emit(committee, "ProposalStart").withArgs(5, false);

        expect((await committee.proposalOf(5)).state).to.equal(1);
        await mine(2, {interval: 10});

        await expect(committee.takeResult(5, params)).to.be.emit(committee, "ProposalExpire").withArgs(5);

        expect((await committee.proposalOf(5)).state).to.equal(5);
    });

    it("propose abnormal vote test", async () => {
        let params = [];
        {
            let data = Buffer.alloc(32);
            data.write("test");
            params.push(data);
        }
        {
            let data = Buffer.alloc(32);
            data.writeBigInt64LE(normalizeToBigInt(1234));
            params.push(data);
        }
        await expect(committee.propose(100, params)).to.emit(committee, "ProposalStart").withArgs(6, false);

        expect((await committee.proposalOf(6)).state).to.equal(1);
        for (let signer of signers) {
            if (!committeeAddrs.includes(signer.address)) {
                await(await committee.connect(signer).reject(6, params)).wait();
            }
        }

        await expect(committee.takeResult(6, params)).to.be.ok;
        expect((await committee.proposalOf(6)).state).to.equal(1);
    });

    it("propose add member test", async () => {
        // 添加signer4到委员会
        await expect(committee.connect(signers[1]).perpareAddMember(signers[4].address)).to.emit(committee, "ProposalStart").withArgs(7, false);

        expect((await committee.proposalOf(7)).state).to.equal(1);
        for (const signer of committeeSigners) {
            await(await committee.connect(signer).support(7, [
                ethers.zeroPadValue(signers[4].address, 32),
                ethers.encodeBytes32String("addMember")])).wait();
        }

        await (await committee.addCommitteeMember(signers[4].address, 7)).wait();
        expect(await committee.isMember(signers[4].address)).to.equal(true);

        committeeAddrs.push(signers[4].address);
        committeeSigners.push(signers[4]);

        expect(await committee.members()).deep.equal(committeeAddrs);
    });

    it("propose remove member test", async () => {
        await expect(committee.perpareRemoveMember(committeeAddrs[0])).to.be.revertedWith("only committee can remove member");

        // 移除signer1到委员会
        await expect(committee.connect(signers[1]).perpareRemoveMember(committeeAddrs[0])).to.emit(committee, "ProposalStart").withArgs(8, false);

        expect((await committee.proposalOf(8)).state).to.equal(1);
        for (const signer of committeeSigners) {
            await(await committee.connect(signer).support(8, [
                ethers.zeroPadValue(committeeAddrs[0], 32),
                ethers.encodeBytes32String("removeMember")])).wait();
        }

        await (await committee.connect(signers[2]).removeCommitteeMember(committeeAddrs[0], 8)).wait();

        expect(await committee.isMember(committeeAddrs[0])).to.equal(false);
        committeeAddrs = committeeAddrs.slice(1);
        committeeSigners = committeeSigners.slice(1);

        expect(await committee.members()).deep.equalInAnyOrder(committeeAddrs);
    });

    it("propose change member test", async () => {
        // 将signers3,6,7设置为委员会
        let newCommittee = [signers[3], signers[6], signers[7]];
        let newCommitteeAddress = newCommittee.map((signer) => signer.address);

        await expect(committee.connect(signers[2]).prepareSetCommittees(newCommitteeAddress)).to.emit(committee, "ProposalStart").withArgs(9, false);

        expect((await committee.proposalOf(9)).state).to.equal(1);
        let params = newCommitteeAddress.map((addr) => ethers.zeroPadValue(addr, 32))
        params.push(ethers.encodeBytes32String("setCommittees"));
        for (const signer of committeeSigners) {
            await(await committee.connect(signer).support(9, params)).wait();
        }

        await (await committee.connect(signers[2]).setCommittees(newCommitteeAddress, 9)).wait();

        expect(await committee.isMember(committeeAddrs[0])).to.equal(false);
        committeeAddrs = newCommitteeAddress;
        committeeSigners = newCommittee;

        expect(await committee.members()).deep.equalInAnyOrder(committeeAddrs);
        for (const addr of committeeAddrs) {
            expect(await committee.isMember(addr)).to.equal(true);
        }
    });
});
