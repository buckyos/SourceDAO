import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber, utils } from "ethers";
import { SourceDaoCommittee, MarketingContract } from "../typechain-types";

describe("MarketingContract", () => {
  async function deployContracts() {
    const signers = await hre.ethers.getSigners();
    let committees = [];
    for (let i = 1; i < 6; i++) {
      committees.push(signers[i].address);
    }
    const SourceDao = await hre.ethers.getContractFactory("SourceDao");
    let sourceDao = await SourceDao.deploy();
    const SourceDaoToken = await hre.ethers.getContractFactory(
      "SourceDaoToken"
    );
    const daoToken = await hre.upgrades.deployProxy(SourceDaoToken, [1000000], {
      kind: "uups",
    });
    await daoToken.setMainContractAddress(sourceDao.address);
    await sourceDao.setTokenAddress(daoToken.address);

    const MarketingContract = await hre.ethers.getContractFactory(
      "MarketingContract"
    );
    const marketingContract = (await hre.upgrades.deployProxy(
      MarketingContract,
      {
        kind: "uups",
      }
    )) as MarketingContract;
    await marketingContract.deployed();
    await sourceDao.setDevAddress(marketingContract.address);
    await marketingContract.setMainContractAddress(sourceDao.address);

    const Committee = await hre.ethers.getContractFactory("SourceDaoCommittee");
    const committee = (await hre.upgrades.deployProxy(Committee, [committees], {
      kind: "uups",
    })) as SourceDaoCommittee;
    await committee.deployed();
    await committee.setMainContractAddress(sourceDao.address);
    await sourceDao.setCommitteeAddress(committee.address);

    return { signers, marketingContract, committee, daoToken };
  }

  it("CreateActivity test", async () => {
    const { signers, daoToken, committee, marketingContract } =
      await loadFixture(deployContracts);

    {
      const tx = await marketingContract.createActivity(
        10000,
        100,
        0,
        0,
        utils.formatBytes32String("CreateActivity test")
      );

      const ret = await tx.wait();

      expect(ret.events?.length).to.equal(2);
      const event = ret.events![1];
      expect(event.args?.length).to.equal(1);
      const arg = event.args!.at(0);
      const activityId = BigNumber.from(arg);
      const activity = await marketingContract.activityOf(activityId);
      expect(activity.description).to.equal(
        utils.formatBytes32String("CreateActivity test")
      );
      expect(activity.state).to.equal(1);
      expect(activity.budget).to.equal(10000);
      expect(activity.reward).to.equal(100);
      expect(activity.evaluatePercent).to.equal(0);
      expect(activity.startDate).to.equal(0);
      expect(activity.endDate).to.equal(0);
      expect(activity.principal).to.equal(signers[0].address);

      for (let i = 1; i < 6; i++) {
        const tx = await committee.connect(signers[i]).support(activityId);
        await tx.wait();
      }
      await marketingContract.pay(activityId);

      let balance = await daoToken.balanceOf(signers[0].address);
      expect(balance).to.equal(10000);

      {
        const activity = await marketingContract.activityOf(activityId);
        expect(activity.state).to.equal(2);
      }

      {
        let contributions = [];
        for (let signer of signers) {
          contributions.push({
            contributor: signer.address,
            value: 10,
          });
        }
        const tx = await marketingContract.updateContribute(
          activityId,
          contributions
        );
        await tx.wait();

        {
          contributions.forEach((con) => (con.value *= 2));
          const tx = await marketingContract.updateContribute(
            activityId,
            contributions
          );
          await tx.wait();
        }

        {
          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(2);
        }

        let sumContribution = 0;
        {
          for (let signer of signers) {
            let contribution = await marketingContract.contributionOf(
              activityId,
              signer.address
            );
            expect(contribution).to.equal(20);
            sumContribution += contribution.toNumber();
          }
        }

        {
          const tx = await marketingContract.evaluate(activityId, 60);
          await tx.wait();

          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(3);

          for (let signer of signers) {
            let contribution = await marketingContract.contributionOf(
              activityId,
              signer.address
            );
            expect(contribution).to.equal(20);
          }
        }

        const activity = await marketingContract.activityOf(activityId);
        const proposalId = activity.proposalId;

        // console.log("proposalId: " + proposalId);

        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(proposalId);
          await tx.wait();
        }
        await marketingContract.takeReward(activityId);

        {
          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(4);
        }

        // console.log("sumContribution: " + sumContribution);

        {
          const tx = await marketingContract
            .connect(signers[0])
            .withdrawReward([activityId]);
          let ret = await tx.wait();
          let balance = await daoToken.balanceOf(signers[0].address);
          expect(balance).to.equal(
            Math.floor((100 * 20 * 60) / 100 / sumContribution) + 10000
          );
        }

        for (let i = 1; i < signers.length; i++) {
          let signer = signers[i];
          const tx = await marketingContract
            .connect(signer)
            .withdrawReward([activityId]);
          let ret = await tx.wait();
          let balance = await daoToken.balanceOf(signer.address);
          expect(balance).to.equal(
            Math.floor((100 * 20 * 60) / 100 / sumContribution)
          );
        }
      }
    }
  });

  it("No reward test", async () => {
    const { signers, daoToken, committee, marketingContract } =
      await loadFixture(deployContracts);

    {
      const tx = await marketingContract.createActivity(
        10000,
        0,
        0,
        0,
        utils.formatBytes32String("No reward test")
      );

      const ret = await tx.wait();

      expect(ret.events?.length).to.equal(2);
      const event = ret.events![1];
      expect(event.args?.length).to.equal(1);
      const arg = event.args!.at(0);
      const activityId = BigNumber.from(arg);
      const activity = await marketingContract.activityOf(activityId);
      expect(activity.description).to.equal(
        utils.formatBytes32String("No reward test")
      );
      expect(activity.state).to.equal(1);
      expect(activity.budget).to.equal(10000);
      expect(activity.reward).to.equal(0);
      expect(activity.evaluatePercent).to.equal(0);
      expect(activity.startDate).to.equal(0);
      expect(activity.endDate).to.equal(0);
      expect(activity.principal).to.equal(signers[0].address);

      for (let i = 1; i < 6; i++) {
        const tx = await committee.connect(signers[i]).support(activityId);
        await tx.wait();
      }
      await marketingContract.pay(activityId);

      let balance = await daoToken.balanceOf(signers[0].address);
      expect(balance).to.equal(10000);

      {
        const activity = await marketingContract.activityOf(activityId);
        expect(activity.state).to.equal(2);
      }

      {
        let contributions = [];
        for (let signer of signers) {
          contributions.push({
            contributor: signer.address,
            value: 10,
          });
        }
        const tx = await marketingContract.updateContribute(
          activityId,
          contributions
        );
        await tx.wait();

        {
          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(2);
        }

        let sumContribution = 0;
        {
          for (let signer of signers) {
            let contribution = await marketingContract.contributionOf(
              activityId,
              signer.address
            );
            expect(contribution).to.equal(10);
            sumContribution += contribution.toNumber();
          }
        }

        {
          const tx = await marketingContract.evaluate(activityId, 60);
          await tx.wait();

          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(3);

          for (let signer of signers) {
            let contribution = await marketingContract.contributionOf(
              activityId,
              signer.address
            );
            expect(contribution).to.equal(10);
          }
        }

        const activity = await marketingContract.activityOf(activityId);
        const proposalId = activity.proposalId;

        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(proposalId);
          await tx.wait();
        }
        await marketingContract.takeReward(activityId);

        {
          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(4);
        }

        {
          const tx = await marketingContract
            .connect(signers[0])
            .withdrawReward([activityId]);
          let ret = await tx.wait();
          let balance = await daoToken.balanceOf(signers[0].address);
          expect(balance).to.equal(
            Math.floor((0 * 10 * 60) / 100 / sumContribution) + 10000
          );
        }

        for (let i = 1; i < signers.length; i++) {
          let signer = signers[i];
          const tx = await marketingContract
            .connect(signer)
            .withdrawReward([activityId]);
          let ret = await tx.wait();
          let balance = await daoToken.balanceOf(signer.address);
          expect(balance).to.equal(
            Math.floor((0 * 10 * 60) / 100 / sumContribution)
          );
        }
      }
    }
  });

  it("No budget test", async () => {
    const { signers, daoToken, committee, marketingContract } =
      await loadFixture(deployContracts);

    {
      const tx = await marketingContract.createActivity(
        0,
        100,
        0,
        0,
        utils.formatBytes32String("No budget test")
      );

      const ret = await tx.wait();

      expect(ret.events?.length).to.equal(2);
      const event = ret.events![1];
      expect(event.args?.length).to.equal(1);
      const arg = event.args!.at(0);
      const activityId = BigNumber.from(arg);
      const activity = await marketingContract.activityOf(activityId);
      expect(activity.description).to.equal(
        utils.formatBytes32String("No budget test")
      );
      // console.log("activity.state: " + activity.state);
      expect(activity.state).to.equal(1);
      expect(activity.budget).to.equal(0);
      expect(activity.reward).to.equal(100);
      expect(activity.evaluatePercent).to.equal(0);
      expect(activity.startDate).to.equal(0);
      expect(activity.endDate).to.equal(0);
      expect(activity.principal).to.equal(signers[0].address);

      for (let i = 1; i < 6; i++) {
        const tx = await committee.connect(signers[i]).support(activityId);
        await tx.wait();
      }

      await marketingContract.pay(activityId);

      let balance = await daoToken.balanceOf(signers[0].address);
      expect(balance).to.equal(0);

      {
        const activity = await marketingContract.activityOf(activityId);
        const proposal = await committee.proposalOf(activityId);
        // console.log(
        //   "activity.state: " +
        //     activity.state +
        //     "proposal.state:" +
        //     proposal.state
        // );
        expect(activity.budget).to.equal(0);
        expect(proposal.state).to.equal(4);
        expect(activity.state).to.equal(2);
      }

      {
        let contributions = [];
        for (let signer of signers) {
          contributions.push({
            contributor: signer.address,
            value: 10,
          });
        }
        const tx = await marketingContract.updateContribute(
          activityId,
          contributions
        );
        await tx.wait();

        {
          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(2);
        }

        let sumContribution = 0;
        {
          for (let signer of signers) {
            let contribution = await marketingContract.contributionOf(
              activityId,
              signer.address
            );
            expect(contribution).to.equal(10);
            sumContribution += contribution.toNumber();
          }
        }

        {
          const tx = await marketingContract.evaluate(activityId, 60);
          await tx.wait();

          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(3);

          for (let signer of signers) {
            let contribution = await marketingContract.contributionOf(
              activityId,
              signer.address
            );
            expect(contribution).to.equal(10);
          }
        }

        const activity = await marketingContract.activityOf(activityId);
        const proposalId = activity.proposalId;

        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(proposalId);
          await tx.wait();
        }
        await marketingContract.takeReward(activityId);

        {
          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(4);
        }

        {
          const tx = await marketingContract
            .connect(signers[0])
            .withdrawReward([activityId]);
          let ret = await tx.wait();
          let balance = await daoToken.balanceOf(signers[0].address);
          expect(balance).to.equal(
            Math.floor((100 * 10 * 60) / 100 / sumContribution) + 0
          );
        }

        for (let i = 1; i < signers.length; i++) {
          let signer = signers[i];
          const tx = await marketingContract
            .connect(signer)
            .withdrawReward([activityId]);
          let ret = await tx.wait();
          let balance = await daoToken.balanceOf(signer.address);
          expect(balance).to.equal(
            Math.floor((100 * 10 * 60) / 100 / sumContribution)
          );
        }
      }
    }
  });

  it("Multi Activity test", async () => {
    const { signers, daoToken, committee, marketingContract } =
      await loadFixture(deployContracts);

    let members = await committee.members();

    {
      let activityId1, activityId2;
      {
        const tx = await marketingContract.createActivity(
          10000,
          100,
          0,
          0,
          utils.formatBytes32String("Multi Activity1 test")
        );
        const ret = await tx.wait();
        expect(ret.events?.length).to.equal(2);
        const event = ret.events![1];
        expect(event.args?.length).to.equal(1);
        const arg = event.args!.at(0);
        activityId1 = BigNumber.from(arg);
      }
      {
        const tx = await marketingContract.createActivity(
          10000,
          200,
          0,
          0,
          utils.formatBytes32String("Multi Activity2 test")
        );
        const ret = await tx.wait();
        expect(ret.events?.length).to.equal(2);
        const event = ret.events![1];
        expect(event.args?.length).to.equal(1);
        const arg = event.args!.at(0);
        activityId2 = BigNumber.from(arg);
      }
      {
        const activity = await marketingContract.activityOf(activityId1);
        expect(activity.description).to.equal(
          utils.formatBytes32String("Multi Activity1 test")
        );
        expect(activity.state).to.equal(1);
        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(activityId1);
          await tx.wait();
        }
        await marketingContract.pay(activityId1);
      }
      {
        const activity = await marketingContract.activityOf(activityId2);
        expect(activity.description).to.equal(
          utils.formatBytes32String("Multi Activity2 test")
        );
        expect(activity.state).to.equal(1);
        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(activityId2);
          await tx.wait();
        }
        await marketingContract.pay(activityId2);
      }

      {
        const activity = await marketingContract.activityOf(activityId1);
        expect(activity.state).to.equal(2);
      }

      {
        const activity = await marketingContract.activityOf(activityId2);
        expect(activity.state).to.equal(2);
      }

      let sumContribution1 = 0;
      let sumContribution2 = 0;
      {
        {
          let contributions = [];
          for (let signer of signers) {
            contributions.push({
              contributor: signer.address,
              value: 10,
            });
            sumContribution1 += 10;
          }
          const tx = await marketingContract.updateContribute(
            activityId1,
            contributions
          );
          await tx.wait();

          {
            let tx = await marketingContract.evaluate(activityId1, 60);
            await tx.wait();
          }
        }

        {
          let contributions = [];
          for (let signer of signers) {
            contributions.push({
              contributor: signer.address,
              value: 20,
            });
            sumContribution2 += 20;
          }
          const tx = await marketingContract.updateContribute(
            activityId2,
            contributions
          );
          await tx.wait();

          {
            let tx = await marketingContract.evaluate(activityId2, 120);
            await tx.wait();
          }
        }

        {
          const activity = await marketingContract.activityOf(activityId1);
          expect(activity.state).to.equal(3);
        }

        {
          const activity = await marketingContract.activityOf(activityId2);
          expect(activity.state).to.equal(3);
        }

        {
          for (let signer of signers) {
            let contribution = await marketingContract.contributionOf(
              activityId1,
              signer.address
            );
            expect(contribution).to.equal(10);
          }
        }

        {
          for (let signer of signers) {
            let contribution = await marketingContract.contributionOf(
              activityId2,
              signer.address
            );
            expect(contribution).to.equal(20);
          }
        }

        {
          const activity = await marketingContract.activityOf(activityId1);
          const proposalId = activity.proposalId;

          for (let i = 1; i < 6; i++) {
            const tx = await committee.connect(signers[i]).support(proposalId);
            await tx.wait();
          }
          await marketingContract.takeReward(activityId1);
        }

        {
          const activity = await marketingContract.activityOf(activityId2);
          const proposalId = activity.proposalId;

          for (let i = 1; i < 6; i++) {
            const tx = await committee.connect(signers[i]).support(proposalId);
            await tx.wait();
          }
          await marketingContract.takeReward(activityId2);
        }

        {
          const activity = await marketingContract.activityOf(activityId1);
          expect(activity.state).to.equal(4);
        }

        {
          const activity = await marketingContract.activityOf(activityId2);
          expect(activity.state).to.equal(4);
        }
        {
          {
            const tx = await marketingContract
              .connect(signers[0])
              .withdrawReward([activityId1]);
            let ret = await tx.wait();
            let balance = await daoToken.balanceOf(signers[0].address);
            expect(balance).to.equal(
              Math.floor((100 * 10 * 60) / 100 / sumContribution1) +
                10000 +
                10000
            );
          }

          for (let i = 1; i < signers.length; i++) {
            let signer = signers[i];
            const tx = await marketingContract
              .connect(signer)
              .withdrawReward([activityId1]);
            let ret = await tx.wait();
            let balance = await daoToken.balanceOf(signer.address);
            expect(balance).to.equal(
              Math.floor((100 * 10 * 60) / 100 / sumContribution1)
            );
          }
        }
        {
          {
            const tx = await marketingContract
              .connect(signers[0])
              .withdrawReward([activityId2]);
            let ret = await tx.wait();
            let balance = await daoToken.balanceOf(signers[0].address);
            expect(balance).to.equal(
              Math.floor((100 * 10 * 60) / 100 / sumContribution1) +
                Math.floor((200 * 20 * 120) / 100 / sumContribution2) +
                10000 +
                10000
            );
          }

          for (let i = 1; i < signers.length; i++) {
            let signer = signers[i];
            const tx = await marketingContract
              .connect(signer)
              .withdrawReward([activityId2]);
            let ret = await tx.wait();
            let balance = await daoToken.balanceOf(signer.address);
            expect(balance).to.equal(
              Math.floor((100 * 10 * 60) / 100 / sumContribution1) +
                Math.floor((200 * 20 * 120) / 100 / sumContribution2)
            );
          }
        }
      }
    }
  });

  it("Activity safe test", async () => {
    const { signers, daoToken, committee, marketingContract } =
      await loadFixture(deployContracts);

    // let step = 0;

    // console.log("safe: " + step++);

    {
      const tx = await marketingContract.createActivity(
        10000,
        100,
        0,
        0,
        utils.formatBytes32String("Activity safe test")
      );
      const ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      const event = ret.events![1];
      expect(event.args?.length).to.equal(1);
      const arg = event.args!.at(0);
      const activityId = BigNumber.from(arg);
      const activity = await marketingContract.activityOf(activityId);
      expect(activity.state).to.equal(1);
      for (let i = 1; i < 6; i++) {
        const tx = await committee.connect(signers[i]).support(activityId);
        await tx.wait();
      }

      {
        let error = false;
        try {
          let tx = await marketingContract.connect(signers[3]).pay(activityId);
          await tx.wait();
        } catch (e) {
          error = true;
        }
        expect(error).to.equal(true);
      }

      // console.log("safe: " + step++);

      {
        let error = false;
        try {
          let tx = await marketingContract.updateContribute(activityId, [
            {
              contributor: signers[0].address,
              value: 20,
            },
          ]);
          await tx.wait();
        } catch (e) {
          error = true;
        }
        expect(error).to.equal(true);
      }

      {
        let tx = await marketingContract.pay(activityId);
        await tx.wait();
      }

      // console.log("safe: " + step++);

      {
        const activity = await marketingContract.activityOf(activityId);
        expect(activity.state).to.equal(2);
      }

      let sumContribution = 0;

      {
        for (let signer of signers) {
          let tx = await marketingContract.updateContribute(activityId, [
            {
              contributor: signer.address,
              value: 20,
            },
          ]);
          sumContribution += 20;
          await tx.wait();
        }
      }

      // console.log("safe: " + step++);

      {
        let error = false;
        try {
          let tx = await marketingContract
            .connect(signers[3])
            .updateContribute(activityId, [
              {
                contributor: signers[0].address,
                value: 30,
              },
            ]);
          await tx.wait();
        } catch (e) {
          error = true;
        }
        expect(error).to.equal(true);
      }

      // console.log("safe: " + step++);

      {
        {
          const tx = await marketingContract
            .connect(signers[0])
            .withdrawReward([activityId]);
          let ret = await tx.wait();
          let balance = await daoToken.balanceOf(signers[0].address);
          expect(balance).to.equal(10000);
        }

        for (let i = 1; i < signers.length; i++) {
          let signer = signers[i];
          const tx = await marketingContract
            .connect(signer)
            .withdrawReward([activityId]);
          let ret = await tx.wait();

          let balance = await daoToken.balanceOf(signer.address);
          expect(balance).to.equal(0);
        }
      }

      // console.log("safe: " + step++);

      {
        {
          let error = false;
          try {
            const tx = await marketingContract
              .connect(signers[3])
              .evaluate(activityId, 60);
            await tx.wait();
          } catch (e) {
            error = true;
          }
          expect(error).to.equal(true);
        }

        // console.log("safe: " + step++);

        {
          let error = false;
          try {
            await marketingContract.takeReward(activityId);
          } catch (e) {
            error = true;
          }
          expect(error).to.equal(true);
        }

        const tx = await marketingContract.evaluate(activityId, 60);
        await tx.wait();

        // console.log("safe: " + step++);

        {
          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(3);
        }

        {
          for (let signer of signers) {
            let contribution = await marketingContract.contributionOf(
              activityId,
              signer.address
            );
            expect(contribution).to.equal(20);
          }
        }

        const activity = await marketingContract.activityOf(activityId);
        const proposalId = activity.proposalId;

        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(proposalId);
          await tx.wait();
        }

        // console.log("safe: " + step++);

        {
          let error = false;
          try {
            await marketingContract.connect(signers[3]).takeReward(activityId);
          } catch (e) {
            error = true;
          }
          expect(error).to.equal(true);
        }

        // console.log("safe: " + step++);

        {
          {
            const tx = await marketingContract
              .connect(signers[0])
              .withdrawReward([activityId]);
            let ret = await tx.wait();
            let balance = await daoToken.balanceOf(signers[0].address);
            expect(balance).to.equal(10000);
          }

          for (let i = 1; i < signers.length; i++) {
            let signer = signers[i];
            const tx = await marketingContract
              .connect(signer)
              .withdrawReward([activityId]);
            let ret = await tx.wait();

            let balance = await daoToken.balanceOf(signer.address);
            expect(balance).to.equal(0);
          }
        }

        // console.log("safe: " + step++);

        {
          await marketingContract.takeReward(activityId);
        }

        {
          const activity = await marketingContract.activityOf(activityId);
          expect(activity.state).to.equal(4);
        }

        {
          const tx = await marketingContract
            .connect(signers[0])
            .withdrawReward([activityId]);
          let ret = await tx.wait();
          let balance = await daoToken.balanceOf(signers[0].address);
          expect(balance).to.equal(
            Math.floor((100 * 20 * 60) / 100 / sumContribution) + 10000
          );
        }

        for (let i = 1; i < signers.length; i++) {
          let signer = signers[i];
          const tx = await marketingContract
            .connect(signer)
            .withdrawReward([activityId]);
          let ret = await tx.wait();

          let balance = await daoToken.balanceOf(signer.address);
          expect(balance).to.equal(
            Math.floor((100 * 20 * 60) / 100 / sumContribution)
          );
        }
      }
    }
  });
});
