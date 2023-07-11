import hre from "hardhat";
import { SourceDaoCommittee } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { normalizeToBigInt } from "hardhat/common";

function wait(interval: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, interval*1000);
  });
}

describe("Committee", () => {
  async function deployContracts() {
    const signers = await hre.ethers.getSigners();
    let committees = [];
    for (let i = 1; i < 6; i++) {
      committees.push(signers[i].address);
    }

    const Committee = await hre.ethers.getContractFactory("SourceDaoCommittee");
    const committee = (await hre.upgrades.deployProxy(Committee, [committees], {kind: "uups"})) as SourceDaoCommittee;
    await committee.deployed();

    return {signers, committees, committee};
  }

  it("member check", async () => {
    const {signers, committees, committee} = await loadFixture(deployContracts);
    for (let member of committees) {
      expect(await committee.isMember(member)).to.equal(true);
    }

    for (let signer of signers) {
      let isCommettee = false;
      for (let member of committees) {
        if (member == signer.address) {
          isCommettee = true;
          break;
        }
      }
      expect(await committee.isMember(signer.address)).to.equal(isCommettee);
    }

    let members = await committee.members();
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
    }

  });

  it("propose support test", async () => {
    const {signers, committees, committee} = await loadFixture(deployContracts);

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
    let proposalId;
    {
      let tx = await committee.propose(10, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      proposalId = ret.events![0].args![0];
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(1);
    }
    {
      for (let signer of signers) {
        let isMember = false;
        for (let member of committees) {
          if (member === signer.address) {
            isMember = true;
            break;
          }
        }

        if (isMember) {
          let tx = await committee.connect(signer).support(proposalId);
          await tx.wait();
        }
      }
    }

    {
      let tx = await committee.takeResult(proposalId, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      expect(ret.events![0].event).to.equal("ProposalAccept");
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(2);
    }
  });

  it("propose reject test", async () => {
    const {signers, committees, committee} = await loadFixture(deployContracts);

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
    let proposalId;
    {
      let tx = await committee.propose(10, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      proposalId = ret.events![0].args![0];
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(1);
    }
    {
      for (let signer of signers) {
        let isMember = false;
        for (let member of committees) {
          if (member === signer.address) {
            isMember = true;
            break;
          }
        }

        if (isMember) {
          let tx = await committee.connect(signer).reject(proposalId);
          await tx.wait();
        }
      }
    }

    {
      let tx = await committee.takeResult(proposalId, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      expect(ret.events![0].event).to.equal("ProposalReject");
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(3);
    }
  });

  it("propose most reject test", async () => {
    const {signers, committees, committee} = await loadFixture(deployContracts);

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
    let proposalId;
    {
      let tx = await committee.propose(10, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      proposalId = ret.events![0].args![0];
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(1);
    }
    {
      let i = 0;
      for (let signer of signers) {
        let isMember = false;
        for (let member of committees) {
          if (member === signer.address) {
            isMember = true;
            break;
          }
        }

        if (isMember) {
          if (i < 3) {
            let tx = await committee.connect(signer).reject(proposalId);
            await tx.wait();
          } else {
            let tx = await committee.connect(signer).support(proposalId);
            await tx.wait();
          }
          i += 1;
        }
      }
    }

    {
      let tx = await committee.takeResult(proposalId, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      expect(ret.events![0].event).to.equal("ProposalReject");
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(3);
    }
  });

  it("propose most support test", async () => {
    const {signers, committees, committee} = await loadFixture(deployContracts);

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
    let proposalId;
    {
      let tx = await committee.propose(10, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      proposalId = ret.events![0].args![0];
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(1);
    }
    {
      let i = 0;
      for (let signer of signers) {
        let isMember = false;
        for (let member of committees) {
          if (member === signer.address) {
            isMember = true;
            break;
          }
        }

        if (isMember) {
          if (i < 3) {
            let tx = await committee.connect(signer).support(proposalId);
            await tx.wait();
          } else {
            let tx = await committee.connect(signer).reject(proposalId);
            await tx.wait();
          }
          i += 1;
        }
      }
    }

    {
      let tx = await committee.takeResult(proposalId, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      expect(ret.events![0].event).to.equal("ProposalAccept");
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(2);
    }
  });

  it("propose expire test", async () => {
    const {signers, committees, committee} = await loadFixture(deployContracts);

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
    let proposalId;
    {
      let tx = await committee.propose(1, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      proposalId = ret.events![0].args![0];
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(1);
    }
    await wait(10);
    {
      let tx = await committee.takeResult(proposalId, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      expect(ret.events![0].event).to.equal("ProposalExpire");
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(5);
    }
  });

  it("propose abnormal vote test", async () => {
    const {signers, committees, committee} = await loadFixture(deployContracts);

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
    let proposalId;
    {
      let tx = await committee.propose(100, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      proposalId = ret.events![0].args![0];
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(1);
    }
    {
      for (let signer of signers) {
        let isMember = false;
        for (let member of committees) {
          if (member === signer.address) {
            isMember = true;
            break;
          }
        }

        if (!isMember) {
          let error = false;
          try {
            let tx = await committee.connect(signer).reject(proposalId);
            await tx.wait();
          } catch (e) {
            error = true;
          }
          expect(error).to.equal(false);
        }
      }
    }

    {
      let tx = await committee.takeResult(proposalId, params);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(0);
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(1);
    }
  });

  it("propose add member test", async () => {
    let {signers, committees, committee} = await loadFixture(deployContracts);

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
    {
      let error = false;
      try {
        let tx = await committee.perpareAddMember(signers[7].address);
        let ret = await tx.wait();
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    let proposalId;
    {
      let tx = await committee.connect(signers[1]).perpareAddMember(signers[7].address);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      proposalId = ret.events![0].args![0];
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(1);
    }
    {
      for (let signer of signers) {
        let isMember = false;
        for (let member of committees) {
          if (member === signer.address) {
            isMember = true;
            break;
          }
        }

        if (isMember) {
          try {
            let tx = await committee.connect(signer).support(proposalId);
            await tx.wait();
          } catch (e) {
          }
        }
      }
    }

    {
      let tx = await committee.addCommitteeMember(signers[7].address, proposalId);
      let ret = await tx.wait();
    }

    {
      expect(await committee.isMember(signers[7].address)).to.equal(true);
    }
    committees = committees.slice();
    committees.push(signers[7].address);

    let members = await committee.members();
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
    }
  });
  it("propose remove member test", async () => {
    let {signers, committees, committee} = await loadFixture(deployContracts);

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
    {
      let error = false;
      try {
        let tx = await committee.perpareRemoveMember(committees[0]);
        let ret = await tx.wait();
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    let proposalId;
    {
      let tx = await committee.connect(signers[1]).perpareRemoveMember(committees[0]);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(1);
      proposalId = ret.events![0].args![0];
    }

    {
      let info = await committee.proposalOf(proposalId);
      expect(info.state).to.equal(1);
    }
    {
      for (let signer of signers) {
        let isMember = false;
        for (let member of committees) {
          if (member === signer.address) {
            isMember = true;
            break;
          }
        }

        if (isMember) {
          try {
            let tx = await committee.connect(signer).support(proposalId);
            await tx.wait();
          } catch (e) {
          }
        }
      }
    }

    {
      let tx = await committee.connect(signers[2]).removeCommitteeMember(committees[0], proposalId);
      let ret = await tx.wait();
    }

    {
      expect(await committee.isMember(committees[0])).to.equal(false);
    }
    committees = committees.slice(1);

    let members = await committee.members();
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
    }
  });
});
