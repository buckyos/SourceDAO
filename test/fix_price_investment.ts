import hre from "hardhat";
import {
  SourceDaoCommittee,
  FixedPriceInvestment,
  ProjectManagement,
  Investment,
  SourceDaoToken, MultiSigWallet
} from "../typechain-types";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

function wait(interval: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, interval*1000);
  });
}

describe("FixedPriceInvestment", () => {
  async function deployContracts() {
    const signers = await hre.ethers.getSigners();
    let committees = [];
    for (let i = 1; i < 6; i++) {
      committees.push(signers[i].address);
    }
    const SourceDao = await hre.ethers.getContractFactory("SourceDao");
    let sourceDao = await SourceDao.deploy();
    const SourceDaoToken = await hre.ethers.getContractFactory("SourceDaoToken");
    const daoToken = (await hre.upgrades.deployProxy(SourceDaoToken, [1000000], {kind: "uups"})) as SourceDaoToken;
    await daoToken.setMainContractAddress(sourceDao.address);
    await sourceDao.setTokenAddress(daoToken.address);

    const ProjectManager = await hre.ethers.getContractFactory("ProjectManagement");
    const projectManager = (await hre.upgrades.deployProxy(ProjectManager, { kind: "uups" })) as ProjectManagement;
    await projectManager.deployed();
    await sourceDao.setDevAddress(projectManager.address);
    await projectManager.setMainContractAddress(sourceDao.address);

    const Committee = await hre.ethers.getContractFactory("SourceDaoCommittee");
    const committee = (await hre.upgrades.deployProxy(Committee, [committees], { kind: "uups" })) as SourceDaoCommittee;
    await committee.deployed();
    await committee.setMainContractAddress(sourceDao.address);
    await sourceDao.setCommitteeAddress(committee.address);

    const Investment = await hre.ethers.getContractFactory("Investment");
    const investment = (await hre.upgrades.deployProxy(Investment, { kind: "uups" })) as Investment;
    await investment.setMainContractAddress(sourceDao.address);
    await sourceDao.setInvestmentAddress(investment.address);

    const TestToken = await hre.ethers.getContractFactory("TestToken");
    const testToken = await TestToken.deploy(10000000);

    const MultiSigWallet = await hre.ethers.getContractFactory("MultiSigWallet");
    const multiSigWallet = (await hre.upgrades.deployProxy(MultiSigWallet, ["test"], {kind: "uups"})) as MultiSigWallet;
    await multiSigWallet.setMainContractAddress(sourceDao.address);
    await sourceDao.setAssetWallet(multiSigWallet.address, 0);

    return {signers, investment, committee, daoToken, committees, testToken, multiSigWallet};
  }

  it("investment eth test", async () => {
    const {signers, investment: investment, committee, daoToken, committees, testToken, multiSigWallet} = await loadFixture(deployContracts);
    let investmentId, proposalId;

    let startTime = Math.ceil(new Date().getTime()/1000);

    if ((await time.latest()) < startTime) {
      await time.setNextBlockTimestamp(startTime);
    } else {
      startTime = await time.latest();
    }

    {
      let tx = await investment.connect(signers[1]).createInvestment(100, {
        priceType: 0,
        assetAddress: "0x0000000000000000000000000000000000000000",
        assetExchangeRate: 1,
        endTime: startTime + 30,
        goalAssetAmount: 10000,
        minAssetPerInvestor: 100,
        maxAssetPerInvestor: 10000,
        onlyWhitelist: true,
        startTime: startTime,
        tokenExchangeRate: 2,
        totalTokenAmount: 20000
      });
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      let event = ret.events![1];
      expect(event.event).to.eq("CreateInvestmentEvent");
      investmentId = event.args![0];
      proposalId = event.args![1];
    }

    {
      let error = false;
      try {
        await investment.startInvestment(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
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
      await investment.startInvestment(investmentId);
    }

    // {
    //   let availableInvestment = await investment.getAvailableInvestment(investmentId);
    //   expect(availableInvestment).to.equal(20000);
    // }

    let balance = await signers[0].getBalance();
    {
      let error = false;
      try {
        await investment.invest(investmentId, 1000);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      let error = false;
      try {
        await investment.addWhitelist(investmentId, [signers[0].address], [0], [0]);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      await investment.connect(signers[1]).addWhitelist(investmentId, [signers[0].address], [0], [10000]);
      await investment.connect(signers[1]).addWhitelist(investmentId, [signers[9].address], [0], [10000]);
    }
    await investment.invest(investmentId, 1000, {value: 1000});

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(18000);
    }

    {
      let error = false;
      try {
        await investment.finishInvestment(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }

    {
      let error = false;
      try {
        await investment.withdrawTokens(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }

    await investment.connect(signers[9]).invest(investmentId, 9000, {value: 9000});

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(0);
    }
    {
      let ret = await investment.viewInvestment(investmentId);
      expect(ret.state).to.equal(1);
    }

    await time.setNextBlockTimestamp(startTime + 35);
    await investment.finishInvestment(investmentId);
    {
      let ret = await investment.viewInvestment(investmentId);
      expect(ret.state).to.equal(2);
    }

    await investment.withdrawTokens(investmentId);
    {
      let token = await daoToken.balanceOf(signers[0].address);
      expect(token).to.equal(2000);
    }
    await investment.connect(signers[9]).withdrawTokens(investmentId);
    {
      let token = await daoToken.balanceOf(signers[9].address);
      expect(token).to.equal(18000);
    }

    await investment.withdrawAsset(investmentId, {gasLimit: 30000000});

    // multiSigWallet
  });

  it("investment token test", async () => {
    const {signers, investment: investment, committee, daoToken, committees, testToken} = await loadFixture(deployContracts);
    let investmentId, proposalId;

    let startTime = Math.ceil(new Date().getTime()/1000);

    if ((await time.latest()) < startTime) {
      await time.setNextBlockTimestamp(startTime);
    } else {
      startTime = await time.latest();
    }
    {
      let tx = await investment.connect(signers[1]).createInvestment(100, {
        priceType: 0,
        assetAddress: testToken.address,
        assetExchangeRate: 1,
        endTime: startTime + 30,
        goalAssetAmount: 10000,
        minAssetPerInvestor: 100,
        maxAssetPerInvestor: 10000,
        onlyWhitelist: true,
        startTime: startTime,
        tokenExchangeRate: 2,
        totalTokenAmount: 20000
      });
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      let event = ret.events![1];
      expect(event.event).to.eq("CreateInvestmentEvent");
      investmentId = event.args![0];
      proposalId = event.args![1];
    }

    {
      let error = false;
      try {
        await investment.startInvestment(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
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
    let ret = await investment.viewInvestment(investmentId);
    {
      let tx = await investment.startInvestment(investmentId);
      let ret = await tx.wait();
    }

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(20000);
    }

    {
      let error = false;
      try {
        await investment.invest(investmentId, 1000);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      let error = false;
      try {
        await investment.addWhitelist(investmentId, [signers[0].address], [], []);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      await investment.connect(signers[1]).addWhitelist(investmentId, [signers[0].address], [0], [10000]);
      await investment.connect(signers[1]).addWhitelist(investmentId, [signers[9].address], [0], [10000]);
    }
    await testToken.approve(investment.address, 1000);
    await investment.invest(investmentId, 1000);

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(18000);
    }

    {
      let error = false;
      try {
        await investment.finishInvestment(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }

    {
      let error = false;
      try {
        await investment.withdrawTokens(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }

    await testToken.transfer(signers[9].address, 9000);
    await testToken.connect(signers[9]).approve(investment.address, 9000);
    await investment.connect(signers[9]).invest(investmentId, 9000);

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(0);
    }
    {
      let ret = await investment.viewInvestment(investmentId);
      expect(ret.state).to.equal(1);
    }

    await time.setNextBlockTimestamp(startTime + 35);
    await investment.finishInvestment(investmentId);
    {
      let ret = await investment.viewInvestment(investmentId);
      expect(ret.state).to.equal(2);
    }

    await investment.withdrawTokens(investmentId);
    {
      let token = await daoToken.balanceOf(signers[0].address);
      expect(token).to.equal(2000);
    }
    await investment.connect(signers[9]).withdrawTokens(investmentId);
    {
      let token = await daoToken.balanceOf(signers[9].address);
      expect(token).to.equal(18000);
    }
  });

  it("investment token failed test", async () => {
    const {signers, investment: investment, committee, daoToken, committees, testToken} = await loadFixture(deployContracts);
    let investmentId, proposalId;

    let startTime = Math.ceil(new Date().getTime()/1000);

    if ((await time.latest()) < startTime) {
      await time.setNextBlockTimestamp(startTime);
    } else {
      startTime = await time.latest();
    }
    {
      let tx = await investment.connect(signers[1]).createInvestment(100, {
        priceType: 0,
        assetAddress: testToken.address,
        assetExchangeRate: 1,
        endTime: startTime + 100,
        goalAssetAmount: 10000,
        minAssetPerInvestor: 100,
        maxAssetPerInvestor: 10000,
        onlyWhitelist: true,
        startTime: startTime,
        tokenExchangeRate: 2,
        totalTokenAmount: 20000
      });
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      let event = ret.events![1];
      expect(event.event).to.eq("CreateInvestmentEvent");
      investmentId = event.args![0];
      proposalId = event.args![1];
    }

    {
      let error = false;
      try {
        await investment.startInvestment(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
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
    let ret = await investment.viewInvestment(investmentId);
    {
      let tx = await investment.startInvestment(investmentId);
      let ret = await tx.wait();
    }

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(20000);
    }

    {
      let error = false;
      try {
        await investment.invest(investmentId, 1000);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      let error = false;
      try {
        await investment.addWhitelist(investmentId, [signers[0].address], [], []);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      await investment.connect(signers[1]).addWhitelist(investmentId, [signers[0].address], [0], [10000]);
      await investment.connect(signers[1]).addWhitelist(investmentId, [signers[9].address], [0], [10000]);
    }
    await testToken.approve(investment.address, 1000);
    await investment.invest(investmentId, 1000);

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(18000);
    }

    {
      let error = false;
      try {
        await investment.finishInvestment(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }

    {
      let error = false;
      try {
        await investment.withdrawTokens(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }

    await testToken.transfer(signers[9].address, 5000);
    await testToken.connect(signers[9]).approve(investment.address, 5000);
    await investment.connect(signers[9]).invest(investmentId, 5000);

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(8000);
    }
    {
      let ret = await investment.viewInvestment(investmentId);
      expect(ret.state).to.equal(1);
    }

    await time.setNextBlockTimestamp(startTime + 120);
    await investment.finishInvestment(investmentId);
    {
      let ret = await investment.viewInvestment(investmentId);
      expect(ret.state).to.equal(3);
    }

    {
      let [minLimit, maxLimit, asset] = await investment.viewSelfInfo(investmentId);
      expect(asset).to.equal(1000);
      let [minLimit9, maxLimit9, asset9] = await investment.connect(signers[9]).viewSelfInfo(investmentId);
      expect(asset9).to.equal(5000);
      let balance = await testToken.balanceOf(signers[0].address);
      let balance9 = await testToken.balanceOf(signers[9].address);
      await investment.refundAsset(investmentId);
      expect(await testToken.balanceOf(signers[0].address)).to.equal(balance.add(1000));
      await investment.connect(signers[9]).refundAsset(investmentId);
      expect(await testToken.balanceOf(signers[9].address)).to.equal(balance9.add(5000));
    }
  });

  it("investment abort test", async () => {
    const {signers, investment: investment, committee, daoToken, committees, testToken} = await loadFixture(deployContracts);
    let investmentId, proposalId;

    let startTime = Math.ceil(new Date().getTime()/1000);

    if ((await time.latest()) < startTime) {
      await time.setNextBlockTimestamp(startTime);
    } else {
      startTime = await time.latest();
    }
    {
      let tx = await investment.connect(signers[1]).createInvestment(100, {
        priceType: 0,
        assetAddress: testToken.address,
        assetExchangeRate: 1,
        endTime: startTime + 100,
        goalAssetAmount: 10000,
        minAssetPerInvestor: 100,
        maxAssetPerInvestor: 10000,
        onlyWhitelist: true,
        startTime: startTime,
        tokenExchangeRate: 2,
        totalTokenAmount: 20000
      });
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      let event = ret.events![1];
      expect(event.event).to.eq("CreateInvestmentEvent");
      investmentId = event.args![0];
      proposalId = event.args![1];
    }

    {
      let error = false;
      try {
        await investment.startInvestment(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
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
    let ret = await investment.viewInvestment(investmentId);
    {
      let tx = await investment.startInvestment(investmentId);
      let ret = await tx.wait();
    }

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(20000);
    }

    {
      let error = false;
      try {
        await investment.invest(investmentId, 1000);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      let error = false;
      try {
        await investment.addWhitelist(investmentId, [signers[0].address], [], []);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      await investment.connect(signers[1]).addWhitelist(investmentId, [signers[0].address], [0], [10000]);
      await investment.connect(signers[1]).addWhitelist(investmentId, [signers[9].address], [0], [10000]);
    }
    await testToken.approve(investment.address, 1000);
    await investment.invest(investmentId, 1000);

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(18000);
    }

    {
      let error = false;
      try {
        await investment.finishInvestment(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }

    {
      let error = false;
      try {
        await investment.withdrawTokens(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }

    await testToken.transfer(signers[9].address, 5000);
    await testToken.connect(signers[9]).approve(investment.address, 5000);
    await investment.connect(signers[9]).invest(investmentId, 5000);

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(8000);
    }
    {
      let ret = await investment.viewInvestment(investmentId);
      expect(ret.state).to.equal(1);
    }

    {
      let tx = await investment.connect(signers[1]).proposeAbortInvestment(investmentId, 7*24*3600, true);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      let event = ret.events![1];
      let proposalId = event.args![1];

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
      await investment.abortInvestment(investmentId, proposalId, true);
    }
    {
      let ret = await investment.viewInvestment(investmentId);
      expect(ret.state).to.equal(3);
    }

    {
      let [minLimit, maxLimit, asset] = await investment.viewSelfInfo(investmentId);
      expect(asset).to.equal(1000);
      let [minLimit9, maxLimit9, asset9] = await investment.connect(signers[9]).viewSelfInfo(investmentId);
      expect(asset9).to.equal(5000);
      let balance = await testToken.balanceOf(signers[0].address);
      let balance9 = await testToken.balanceOf(signers[9].address);
      await investment.refundAsset(investmentId);
      expect(await testToken.balanceOf(signers[0].address)).to.equal(balance.add(1000));
      {
        let error = false;
        try {
          await investment.withdrawTokens(investmentId);
        } catch (e) {
          error = true;
        }
        expect(error).to.equal(true);
      }
      await investment.connect(signers[9]).refundAsset(investmentId);
      expect(await testToken.balanceOf(signers[9].address)).to.equal(balance9.add(5000));
      {
        let error = false;
        try {
          await investment.connect(signers[9]).withdrawTokens(investmentId);
        } catch (e) {
          error = true;
        }
        expect(error).to.equal(true);
      }
    }
  });

  it("investment abort test2", async () => {
    const {signers, investment: investment, committee, daoToken, committees, testToken, multiSigWallet} = await loadFixture(deployContracts);
    let investmentId, proposalId;

    let startTime = Math.ceil(new Date().getTime()/1000);

    if ((await time.latest()) < startTime) {
      await time.setNextBlockTimestamp(startTime);
    } else {
      startTime = await time.latest();
    }
    {
      let tx = await investment.connect(signers[1]).createInvestment(100, {
        priceType: 0,
        assetAddress: testToken.address,
        assetExchangeRate: 1,
        endTime: startTime + 100,
        goalAssetAmount: 10000,
        minAssetPerInvestor: 100,
        maxAssetPerInvestor: 10000,
        onlyWhitelist: true,
        startTime: startTime,
        tokenExchangeRate: 2,
        totalTokenAmount: 30000
      });
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      let event = ret.events![1];
      expect(event.event).to.eq("CreateInvestmentEvent");
      investmentId = event.args![0];
      proposalId = event.args![1];
    }

    {
      let error = false;
      try {
        await investment.startInvestment(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
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
    let ret = await investment.viewInvestment(investmentId);
    {
      let tx = await investment.startInvestment(investmentId);
      let ret = await tx.wait();
    }

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(30000);
    }

    {
      let error = false;
      try {
        await investment.invest(investmentId, 1000);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      let error = false;
      try {
        await investment.addWhitelist(investmentId, [signers[0].address], [], []);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      await investment.connect(signers[1]).addWhitelist(investmentId, [signers[0].address], [100], [10000]);
      await investment.connect(signers[1]).addWhitelist(investmentId, [signers[9].address], [10], [10000]);
    }
    {
      let error = false;
      try {
        await investment.getWhitelistLimit(investmentId, [signers[0].address]);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      let [min, max] = await investment.connect(signers[1]).getWhitelistLimit(investmentId, [signers[0].address]);
      expect(min[0]).to.equal(100);
      expect(max[0]).to.equal(10000);
    }
    {
      let [min, max] = await investment.connect(signers[2]).getWhitelistLimit(investmentId, [signers[9].address]);
      expect(min[0]).to.equal(10);
      expect(max[0]).to.equal(10000);
    }
    await testToken.approve(investment.address, 1000);
    await investment.invest(investmentId, 1000);

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(28000);
    }

    {
      let error = false;
      try {
        await investment.finishInvestment(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }

    {
      let error = false;
      try {
        await investment.withdrawTokens(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }

    await testToken.transfer(signers[9].address, 9000);
    await testToken.connect(signers[9]).approve(investment.address, 9000);
    await investment.connect(signers[9]).invest(investmentId, 9000);

    {
      let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
      expect(availableInvestment).to.equal(10000);
    }
    {
      let ret = await investment.viewInvestment(investmentId);
      expect(ret.state).to.equal(1);
    }

    {
      let tx = await investment.connect(signers[1]).proposeAbortInvestment(investmentId, 7*24*3600, false);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      let event = ret.events![1];
      let proposalId = event.args![1];

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
      await investment.abortInvestment(investmentId, proposalId, false);
    }
    {
      let ret = await investment.viewInvestment(investmentId);
      expect(ret.state).to.equal(2);
    }

    await investment.withdrawTokens(investmentId);
    {
      let token = await daoToken.balanceOf(signers[0].address);
      expect(token).to.equal(2000);
    }
    {
      let error = false;
      try {
        await investment.withdrawTokens(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    await investment.connect(signers[9]).withdrawTokens(investmentId);
    {
      let token = await daoToken.balanceOf(signers[9].address);
      expect(token).to.equal(18000);
    }
    {
      let error = false;
      try {
        await investment.connect(signers[9]).withdrawTokens(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    await investment.withdrawAsset(investmentId);
    {
      let asset = await testToken.balanceOf(multiSigWallet.address);
      expect(asset).to.equal(10000);
    }

    {
      let error = false;
      try {
        let tx = await investment.burnUnAllocatedTokens(investmentId);
      } catch (e) {
        error = true;
      }
      expect(error).to.equal(true);
    }
    {
      let unrelease = await daoToken._totalUnreleased();
      let tx = await investment.connect(signers[1]).burnUnAllocatedTokens(investmentId);
      let ret = await tx.wait();
      expect(ret.events?.length).to.equal(3);
      expect(await daoToken._totalUnreleased()).to.equal(unrelease.add(10000));
    }
  });
});
