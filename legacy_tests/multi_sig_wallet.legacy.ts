import hre from "hardhat";
import { SourceDaoCommittee, ProjectManagement, SourceDaoToken, MultiSigWallet } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

describe("MultiSigWallet", () => {
  async function deployContracts() {
    const signers = await hre.ethers.getSigners();
    let committees = [];
    for (let i = 1; i < 6; i++) {
      committees.push(signers[i].address);
    }
    const CyfsDao = await hre.ethers.getContractFactory("SourceDao");
    let cyfsDao = await CyfsDao.deploy();
    const CyfsDaoToken = await hre.ethers.getContractFactory("SourceDaoToken");
    const daoToken = (await hre.upgrades.deployProxy(CyfsDaoToken, [1000000, cyfsDao.address], {kind: "uups"})) as SourceDaoToken;
    // await daoToken.setMainContractAddress(cyfsDao.address);
    await cyfsDao.setTokenAddress(daoToken.address);

    const Committee = await hre.ethers.getContractFactory("SourceDaoCommittee");
    const committee = (await hre.upgrades.deployProxy(Committee, [committees, cyfsDao.address], { kind: "uups" })) as SourceDaoCommittee;
    await committee.deployed();
    // await committee.setMainContractAddress(cyfsDao.address);
    await cyfsDao.setCommitteeAddress(committee.address);

    const TestToken = await hre.ethers.getContractFactory("TestToken");
    const testToken = await TestToken.deploy(10000000);

    const MultiSigWallet = await hre.ethers.getContractFactory("MultiSigWallet");
    const multiSigWallet = (await hre.upgrades.deployProxy(MultiSigWallet, ["test", cyfsDao.address], {kind: "uups"})) as MultiSigWallet;
    // await multiSigWallet.setMainContractAddress(cyfsDao.address);
    await cyfsDao.setAssetWallet(multiSigWallet.address, 0);

    return {signers, committee, daoToken, committees, testToken, multiSigWallet};
  }

  it("should test transfer token", async ()=> {
    let {signers, committee, daoToken, committees, testToken, multiSigWallet} = await loadFixture(deployContracts);

    await testToken.transfer(multiSigWallet.address, 10000);
    expect(await testToken.balanceOf(multiSigWallet.address)).to.equal(10000);
    expect(await multiSigWallet.getTokenBalance(testToken.address)).to.equal(10000);

    {
      let ret = multiSigWallet.prepareTransfer(7*24*3600, testToken.address, signers[9].address, 5000);
      await expect(ret).to.be.revertedWith("Caller is not an owner");
    }
    let proposalId;
    {
      let tx = await multiSigWallet.connect(signers[1]).prepareTransfer(7*24*3600, testToken.address, signers[9].address, 5000);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      expect(ret.events![1].event).to.equal("TransferRequested");
      proposalId = ret.events![1].args![0];
    }

    {
      await expect(multiSigWallet.connect(signers[1]).executeTransfer(proposalId, testToken.address, signers[9].address, 1000)).to.revertedWith("Proposal must be passed");
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
      let ret = multiSigWallet.executeTransfer(proposalId, testToken.address, signers[9].address, 5000);
      await expect(ret).to.be.revertedWith("Caller is not an owner");
    }

    {
      await multiSigWallet.connect(signers[1]).executeTransfer(proposalId, testToken.address, signers[9].address, 5000);
    }

    expect(await testToken.balanceOf(multiSigWallet.address)).to.equal(5000);
    expect(await testToken.balanceOf(signers[9].address)).to.equal(5000);
    expect(await multiSigWallet.getTokenBalance(testToken.address)).to.equal(5000);

    {
      await expect(multiSigWallet.connect(signers[1]).executeTransfer(proposalId, testToken.address, signers[9].address, 1000)).to.revertedWith("Proposal must be passed");
    }

  });

  it("should test transfer eth", async ()=> {
    let {signers, committee, daoToken, committees, testToken, multiSigWallet} = await loadFixture(deployContracts);

    signers[0].sendTransaction({
      to: multiSigWallet.address,
      value: hre.ethers.utils.parseEther("0.1")
    });

    expect(await hre.ethers.provider.getBalance(multiSigWallet.address)).to.equal(hre.ethers.utils.parseEther("0.1"));
    expect(await multiSigWallet.getTokenBalance("0x0000000000000000000000000000000000000000")).to.equal(hre.ethers.utils.parseEther("0.1"));

    {
      let ret = multiSigWallet.prepareTransfer(7*24*3600, "0x0000000000000000000000000000000000000000", signers[9].address, hre.ethers.utils.parseEther("0.01"));
      await expect(ret).to.be.revertedWith("Caller is not an owner");
    }
    let proposalId;
    {
      let tx = await multiSigWallet.connect(signers[1]).prepareTransfer(7*24*3600, "0x0000000000000000000000000000000000000000", signers[9].address, hre.ethers.utils.parseEther("0.01"));
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      expect(ret.events![1].event).to.equal("TransferRequested");
      proposalId = ret.events![1].args![0];
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
      let ret = multiSigWallet.executeTransfer(proposalId, "0x0000000000000000000000000000000000000000", signers[9].address, hre.ethers.utils.parseEther("0.01"));
      await expect(ret).to.be.revertedWith("Caller is not an owner");
    }

    let balance = await signers[9].getBalance();
    {
      await multiSigWallet.connect(signers[1]).executeTransfer(proposalId, "0x0000000000000000000000000000000000000000", signers[9].address, hre.ethers.utils.parseEther("0.01"));
    }

    expect(await hre.ethers.provider.getBalance(multiSigWallet.address)).to.equal(hre.ethers.utils.parseEther("0.09"));
    expect(await multiSigWallet.getTokenBalance("0x0000000000000000000000000000000000000000")).to.equal(hre.ethers.utils.parseEther("0.09"));
    expect(await signers[9].getBalance()).equal(balance.add(hre.ethers.utils.parseEther("0.01")));

    {
      await expect(multiSigWallet.connect(signers[1]).executeTransfer(proposalId, "0x0000000000000000000000000000000000000000", signers[9].address, hre.ethers.utils.parseEther("0.01"))).to.revertedWith("Proposal must be passed");
    }

  });
});
