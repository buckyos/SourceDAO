import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { SourceDaoCommittee, ProjectManagement, SourceDaoToken } from "../typechain-types";

describe("ProjectManager", () => {
  async function deployContracts() {
    const signers = await hre.ethers.getSigners();
    let committees = [];
    for (let i = 1; i < 6; i++) {
      committees.push(signers[i].address);
    }
    const SourceDao = await hre.ethers.getContractFactory("SourceDao");
    let sourceDao = await SourceDao.deploy();
    const SourceDaoToken = await hre.ethers.getContractFactory("SourceDaoToken");
    const daoToken = (await hre.upgrades.deployProxy(SourceDaoToken, [1000000, sourceDao.address], {kind: "uups"})) as SourceDaoToken;
    // await daoToken.setMainContractAddress(sourceDao.address);
    await sourceDao.setTokenAddress(daoToken.address);

    const ProjectManager = await hre.ethers.getContractFactory("ProjectManagement");
    const projectManager = (await hre.upgrades.deployProxy(ProjectManager, [sourceDao.address], {kind: "uups"})) as ProjectManagement;
    await projectManager.deployed();
    await sourceDao.setDevAddress(projectManager.address);
    // await projectManager.setMainContractAddress(sourceDao.address);

    const Committee = await hre.ethers.getContractFactory("SourceDaoCommittee");
    const committee = (await hre.upgrades.deployProxy(Committee, [committees, sourceDao.address], {kind: "uups"})) as SourceDaoCommittee;
    await committee.deployed();
    // await committee.setMainContractAddress(sourceDao.address);
    await sourceDao.setCommitteeAddress(committee.address);

    return {signers, projectManager, committee, daoToken};
  }

  it("CreateProject test", async () => {
    const {signers, daoToken, committee, projectManager} = await loadFixture(deployContracts);

    {
      const tx = await projectManager.createProject(10000, 1, 0, 0);
      const ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      const event = ret.events![1];
      expect(event.args?.length).to.equal(2);
      const arg = event.args!.at(0);
      const projectId = BigNumber.from(arg);
      const project = await projectManager.projectOf(projectId);
      expect(project.issueId).to.equal(1);
      expect(project.state).to.equal(0);
      const proposalId = project.proposalId;
      for (let i = 1; i < 6; i++) {
        const tx = await committee.connect(signers[i]).support(proposalId);
        await tx.wait();
      }
      await projectManager.promoteProject(projectId);

      {
        const project = await projectManager.projectOf(projectId);
        expect(project.issueId).to.equal(1);
        expect(project.state).to.equal(1);
      }

      {
        let contributions = [];
        for (let signer of signers) {
          contributions.push({
            contributor: signer.address,
            value: 10,
          });
        }
        const tx = await projectManager.acceptProject(projectId, 3, contributions);
        await tx.wait();

        {
          const project = await projectManager.projectOf(projectId);
          expect(project.issueId).to.equal(1);
          expect(project.state).to.equal(2);
        }

        let sumContribution = 0;
        {
          for (let signer of signers) {
            let contribution = await projectManager.contributionOf(projectId, signer.address);
            expect(contribution).to.equal(10);
            sumContribution += 10;
          }
        }

        const project = await projectManager.projectOf(projectId);
        const proposalId = project.proposalId;

        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(proposalId);
          await tx.wait();
        }
        await projectManager.promoteProject(projectId);

        {
          const project = await projectManager.projectOf(projectId);
          expect(project.issueId).to.equal(1);
          expect(project.state).to.equal(3);
        }

        for (let signer of signers) {
          const tx = await projectManager.connect(signer).withdrawContributions([projectId]);
          let ret = await tx.wait();
          let balance = await daoToken.balanceOf(signer.address);
          expect(balance).to.equal(Math.floor(10000*10*80/100/sumContribution));
        }
      }
    }
  });

  it("UpdateContribution test", async () => {
    const {signers, daoToken, committee, projectManager} = await loadFixture(deployContracts);

    {
      const tx = await projectManager.createProject(10000, 1, 0, 0);
      const ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      const event = ret.events![1];
      expect(event.args?.length).to.equal(2);
      const arg = event.args!.at(0);
      const projectId = BigNumber.from(arg);
      const project = await projectManager.projectOf(projectId);
      expect(project.issueId).to.equal(1);
      expect(project.state).to.equal(0);
      const proposalId = project.proposalId;
      for (let i = 1; i < 6; i++) {
        const tx = await committee.connect(signers[i]).support(proposalId);
        await tx.wait();
      }
      await projectManager.promoteProject(projectId);

      {
        const project = await projectManager.projectOf(projectId);
        expect(project.issueId).to.equal(1);
        expect(project.state).to.equal(1);
      }

      {
        let contributions = [];
        for (let i = 0; i < signers.length - 1; i++) {
          contributions.push({
            contributor: signers[i].address,
            value: 10,
          });
        }
        const tx = await projectManager.acceptProject(projectId, 4, contributions);
        await tx.wait();

        {
          const project = await projectManager.projectOf(projectId);
          expect(project.issueId).to.equal(1);
          expect(project.state).to.equal(2);
        }

        let sumContribution = 0;
        {
          for (let i = 0; i < signers.length - 1; i++) {
            let contribution = await projectManager.contributionOf(projectId, signers[i].address);
            expect(contribution).to.equal(10);
            sumContribution += 10;
          }
        }

        {
          let tx = await projectManager.updateContribute(projectId, {
            contributor: signers[0].address,
            value: 20
          });
          await tx.wait();
          sumContribution += 10;

          let contribution = await projectManager.contributionOf(projectId, signers[0].address);
          expect(contribution).to.equal(20);
        }
        const project = await projectManager.projectOf(projectId);
        const proposalId = project.proposalId;

        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(proposalId);
          await tx.wait();
        }
        await projectManager.promoteProject(projectId);

        {
          const project = await projectManager.projectOf(projectId);
          expect(project.issueId).to.equal(1);
          expect(project.state).to.equal(3);
        }

        {
          let error = false;
          try {
            const tx = await projectManager.connect(signers[signers.length - 1]).withdrawContributions([projectId]);
            await tx.wait();
          } catch (e) {
            error = true;
          }
          expect(error).to.equal(false);
        }
        for (let i = 0; i < signers.length - 1; i++) {
          let signer = signers[i];
          const tx = await projectManager.connect(signer).withdrawContributions([projectId]);
          let ret = await tx.wait();
          let balance = await daoToken.balanceOf(signer.address);
          if (i === 0) {
            expect(balance).to.equal(Math.floor(10000*20*100/100/sumContribution));
          } else {
            expect(balance).to.equal(Math.floor(10000*10*100/100/sumContribution));
          }
        }
      }
    }
  });

  it("Multi Project test", async () => {
    const {signers, daoToken, committee, projectManager} = await loadFixture(deployContracts);

    let members = await committee.members();

    {
      let projectId1, projectId2;
      {
        const tx = await projectManager.createProject(10000, 1, 0, 0);
        const ret = await tx.wait();
        expect(ret.events?.length).to.equal(2);
        const event = ret.events![1];
        expect(event.args?.length).to.equal(2);
        const arg = event.args!.at(0);
        projectId1 = BigNumber.from(arg);
      }
      {
        const tx = await projectManager.createProject(10000, 1, 0, 0);
        const ret = await tx.wait();
        expect(ret.events?.length).to.equal(2);
        const event = ret.events![1];
        expect(event.args?.length).to.equal(2);
        const arg = event.args!.at(0);
        projectId2 = BigNumber.from(arg);
      }
      {
        const project = await projectManager.projectOf(projectId1);
        expect(project.issueId).to.equal(1);
        expect(project.state).to.equal(0);
        const proposalId = project.proposalId;
        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(proposalId);
          await tx.wait();
        }
        await projectManager.promoteProject(projectId1);
      }
      {
        const project = await projectManager.projectOf(projectId2);
        expect(project.issueId).to.equal(1);
        expect(project.state).to.equal(0);
        const proposalId = project.proposalId;
        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(proposalId);
          await tx.wait();
        }
        await projectManager.promoteProject(projectId2);
      }

      {
        const project = await projectManager.projectOf(projectId1);
        expect(project.issueId).to.equal(1);
        expect(project.state).to.equal(1);
      }

      {
        const project = await projectManager.projectOf(projectId2);
        expect(project.issueId).to.equal(1);
        expect(project.state).to.equal(1);
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
          const tx = await projectManager.acceptProject(projectId1, 2, contributions);
          await tx.wait();
        }

        {
          let contributions = [];
          for (let signer of signers) {
            contributions.push({
              contributor: signer.address,
              value: 10,
            });
            sumContribution2 += 10;
          }
          const tx = await projectManager.acceptProject(projectId2, 5, contributions);
          await tx.wait();
        }

        {
          const project = await projectManager.projectOf(projectId1);
          expect(project.issueId).to.equal(1);
          expect(project.state).to.equal(2);
        }

        {
          const project = await projectManager.projectOf(projectId2);
          expect(project.issueId).to.equal(1);
          expect(project.state).to.equal(2);
        }

        {
          for (let signer of signers) {
            let contribution = await projectManager.contributionOf(projectId1, signer.address);
            expect(contribution).to.equal(10);
          }
        }

        {
          for (let signer of signers) {
            let contribution = await projectManager.contributionOf(projectId2, signer.address);
            expect(contribution).to.equal(10);
          }
        }

        {
          const project = await projectManager.projectOf(projectId1);
          const proposalId = project.proposalId;

          for (let i = 1; i < 6; i++) {
            const tx = await committee.connect(signers[i]).support(proposalId);
            await tx.wait();
          }
          await projectManager.promoteProject(projectId1);
        }

        {
          const project = await projectManager.projectOf(projectId2);
          const proposalId = project.proposalId;

          for (let i = 1; i < 6; i++) {
            const tx = await committee.connect(signers[i]).support(proposalId);
            await tx.wait();
          }
          await projectManager.promoteProject(projectId2);
        }

        {
          const project = await projectManager.projectOf(projectId1);
          expect(project.issueId).to.equal(1);
          expect(project.state).to.equal(3);
        }

        {
          const project = await projectManager.projectOf(projectId2);
          expect(project.issueId).to.equal(1);
          expect(project.state).to.equal(3);
        }
        {
          for (let signer of signers) {
            const tx = await projectManager.connect(signer).withdrawContributions([projectId1]);
            let ret = await tx.wait();
            let balance = await daoToken.balanceOf(signer.address);
            expect(balance).to.equal(Math.floor(10000*10*0/100/sumContribution1));
          }
        }
        {
          for (let signer of signers) {
            const tx = await projectManager.connect(signer).withdrawContributions([projectId2]);
            let ret = await tx.wait();
            let balance = await daoToken.balanceOf(signer.address);
            expect(balance).to.equal(Math.floor(10000*10*120/100/sumContribution2));
          }
        }
      }
    }
  });

  it("Project safe test", async () => {
    const {signers, daoToken, committee, projectManager} = await loadFixture(deployContracts);

    {
      const tx = await projectManager.createProject(10000, 1, 0, 0);
      const ret = await tx.wait();
      expect(ret.events?.length).to.equal(2);
      const event = ret.events![1];
      expect(event.args?.length).to.equal(2);
      const arg = event.args!.at(0);
      const projectId = BigNumber.from(arg);
      const project = await projectManager.projectOf(projectId);
      expect(project.issueId).to.equal(1);
      expect(project.state).to.equal(0);
      const proposalId = project.proposalId;
      for (let i = 1; i < 6; i++) {
        const tx = await committee.connect(signers[i]).support(proposalId);
        await tx.wait();
      }
      {
        let error = false;
        try {
          let tx = await projectManager.connect(signers[3]).promoteProject(projectId);
          await tx.wait();
        } catch(e) {
          error = true;
        }
        expect(error).to.equal(true);
      }

      {
        let tx = await projectManager.promoteProject(projectId);
        await tx.wait();
      }

      {
        const project = await projectManager.projectOf(projectId);
        expect(project.issueId).to.equal(1);
        expect(project.state).to.equal(1);
      }

      {
        let error = false;
        try {
          let tx = await projectManager.updateContribute(projectId, {
            contributor: signers[0].address,
            value: 20
          });
          await tx.wait();
        } catch (e) {
          error = true;
        }
        expect(error).to.equal(true);
      }

      {
        let contributions = [];
        for (let signer of signers) {
          contributions.push({
            contributor: signer.address,
            value: 10,
          });
        }
        {
          let error = false;
          try {
            const tx = await projectManager.connect(signers[3]).acceptProject(projectId, 3, contributions);
            await tx.wait();
          } catch (e) {
            error = true;
          }
          expect(error).to.equal(true);
        }
        const tx = await projectManager.acceptProject(projectId, 3, contributions);
        await tx.wait();

        {
          const project = await projectManager.projectOf(projectId);
          expect(project.issueId).to.equal(1);
          expect(project.state).to.equal(2);
        }

        {
          for (let signer of signers) {
            let contribution = await projectManager.contributionOf(projectId, signer.address);
            expect(contribution).to.equal(10);
          }
        }

        {
          let error = false;
          try {
            let tx = await projectManager.connect(signers[3]).updateContribute(projectId, {
              contributor: signers[0].address,
              value: 20
            });
            await tx.wait();
          } catch (e) {
            error = true;
          }
          expect(error).to.equal(true);
        }

        const project = await projectManager.projectOf(projectId);
        const proposalId = project.proposalId;

        for (let i = 1; i < 6; i++) {
          const tx = await committee.connect(signers[i]).support(proposalId);
          await tx.wait();
        }
        {
          let error = false;
          try {
            await projectManager.connect(signers[3]).promoteProject(projectId);
          } catch (e) {
            error = true;
          }
          expect(error).to.equal(true);
        }
        {
          await projectManager.promoteProject(projectId);
        }

        {
          const project = await projectManager.projectOf(projectId);
          expect(project.issueId).to.equal(1);
          expect(project.state).to.equal(3);
        }

        // for (let signer of signers) {
        //   const tx = await projectManager.connect(signer).withdrawContributions([projectId]);
        //   let ret = await tx.wait();
        //   console.log(`withdraw result:${JSON.stringify(ret.events)}`);
        // }
      }
    }
  });

});
