import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

const PROJECT_NAME = ethers.encodeBytes32String("SourceDao");
const VERSION_ONE = 100001n;
const VERSION_TWO = 200001n;
const THIRTY_DAYS = 30n * 24n * 60n * 60n;
const SEVEN_DAYS = 7n * 24n * 60n * 60n;
const ONE_HOUR = 3600n;

function toBytes32(value: bigint) {
    return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

function projectParams(
    projectId: bigint,
    version: bigint,
    startDate: bigint,
    endDate: bigint,
    action: "createProject" | "acceptProject"
) {
    return [
        toBytes32(projectId),
        PROJECT_NAME,
        toBytes32(version),
        toBytes32(startDate),
        toBytes32(endDate),
        ethers.encodeBytes32String(action)
    ];
}

async function deployFinalizedSystemFixture() {
    const signers = await ethers.getSigners();
    const [manager, memberTwo, memberThree, contributor, buyer] = signers;
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        [manager.address, memberTwo.address, memberThree.address],
        1,
        200,
        PROJECT_NAME,
        Number(VERSION_TWO),
        150,
        daoAddress
    ]);
    const project = await deployUUPSProxy(ethers, "ProjectManagement", [1, daoAddress]);
    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        1_000_000,
        [manager.address],
        [5_000],
        daoAddress
    ]);
    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["BDT", "BDT", daoAddress]);
    const lockup = await deployUUPSProxy(ethers, "SourceTokenLockup", [PROJECT_NAME, VERSION_TWO, daoAddress]);
    const dividend = await deployUUPSProxy(ethers, "DividendContract", [Number(ONE_HOUR), daoAddress]);
    const acquired = await deployUUPSProxy(ethers, "Acquired", [1, daoAddress]);

    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();
    await (await dao.setProjectAddress(await project.getAddress())).wait();
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();
    await (await dao.setTokenLockupAddress(await lockup.getAddress())).wait();
    await (await dao.setTokenDividendAddress(await dividend.getAddress())).wait();
    await (await dao.setAcquiredAddress(await acquired.getAddress())).wait();
    await (await dao.finalizeInitialization()).wait();

    await (await devToken.dev2normal(1_000)).wait();
    await (await normalToken.transfer(buyer.address, 200)).wait();

    const tokenFactory = await ethers.getContractFactory("TestToken");
    const saleToken = await tokenFactory.deploy("SaleToken", "SALE", 18, 1_000_000n, manager.address);
    await saleToken.waitForDeployment();
    const rewardToken = await tokenFactory.deploy("RewardToken", "RWD", 18, 1_000_000n, manager.address);
    await rewardToken.waitForDeployment();

    return {
        manager,
        memberTwo,
        memberThree,
        contributor,
        buyer,
        dao,
        committee,
        project,
        devToken,
        normalToken,
        lockup,
        dividend,
        acquired,
        saleToken,
        rewardToken
    };
}

async function finishProject(
    fixture: any,
    version: bigint,
    budget: bigint,
    contributions: { contributor: string; value: number }[]
) {
    const projectId = await fixture.project.projectIdCounter();
    const latestBlock = await ethers.provider.getBlock("latest");
    if (latestBlock === null) {
        throw new Error("latest block not found");
    }

    const startDate = BigInt(latestBlock.timestamp);
    const endDate = startDate + THIRTY_DAYS;

    await (await fixture.project.createProject(
        budget,
        PROJECT_NAME,
        version,
        startDate,
        endDate,
        [],
        []
    )).wait();

    const createProposalId = (await fixture.project.projectOf(projectId)).proposalId;
    await (await fixture.committee.connect(fixture.manager).support(
        createProposalId,
        projectParams(projectId, version, startDate, endDate, "createProject")
    )).wait();
    await (await fixture.committee.connect(fixture.memberTwo).support(
        createProposalId,
        projectParams(projectId, version, startDate, endDate, "createProject")
    )).wait();
    await (await fixture.project.promoteProject(projectId)).wait();

    await (await fixture.project.acceptProject(projectId, 4, contributions)).wait();

    const acceptProposalId = (await fixture.project.projectOf(projectId)).proposalId;
    await (await fixture.committee.connect(fixture.manager).support(
        acceptProposalId,
        projectParams(projectId, version, startDate, endDate, "acceptProject")
    )).wait();
    await (await fixture.committee.connect(fixture.memberTwo).support(
        acceptProposalId,
        projectParams(projectId, version, startDate, endDate, "acceptProject")
    )).wait();
    await (await fixture.project.promoteProject(projectId)).wait();

    return {
        projectId,
        createProposalId,
        acceptProposalId,
        startDate,
        endDate,
        releaseTime: await fixture.project.versionReleasedTime(PROJECT_NAME, version)
    };
}

describe("system integration", function () {
    it("keeps project governance and acquired sales operational after dao finalization", async function () {
        const fixture = await networkHelpers.loadFixture(deployFinalizedSystemFixture);

        expect(await fixture.dao.bootstrapFinalized()).to.equal(true);
        await expect(
            fixture.dao.setDevTokenAddress(await fixture.devToken.getAddress())
        ).to.be.revertedWith("bootstrap finalized");

        const projectRun = await finishProject(fixture, VERSION_ONE, 1_000n, [
            { contributor: fixture.contributor.address, value: 100 }
        ]);

        expect(projectRun.releaseTime).to.be.greaterThan(0n);
        expect((await fixture.project.projectOf(projectRun.projectId)).state).to.equal(3n);

        const managerNormalBeforeSale = await fixture.normalToken.balanceOf(fixture.manager.address);

        await (await fixture.saleToken.approve(await fixture.acquired.getAddress(), 100n)).wait();
        await (await fixture.acquired.startInvestment({
            whitelist: [fixture.buyer.address],
            firstPercent: [10_000],
            tokenAddress: await fixture.saleToken.getAddress(),
            tokenAmount: 100n,
            tokenRatio: { tokenAmount: 5n, daoTokenAmount: 1n },
            step1Duration: Number(ONE_HOUR),
            step2Duration: Number(ONE_HOUR),
            canEndEarly: false
        })).wait();

        await (await fixture.normalToken.connect(fixture.buyer).approve(await fixture.acquired.getAddress(), 20n)).wait();
        await (await fixture.acquired.connect(fixture.buyer).invest(1n, 20n)).wait();
        await (await fixture.acquired.endInvestment(1n)).wait();

        expect(await fixture.saleToken.balanceOf(fixture.buyer.address)).to.equal(100n);
        expect((await fixture.acquired.getInvestmentInfo(1n)).end).to.equal(true);
        expect(await fixture.normalToken.balanceOf(fixture.manager.address)).to.equal(managerNormalBeforeSale + 20n);
    });

    it("routes project rewards into dividend staking and a future-version lockup after dao finalization", async function () {
        const fixture = await networkHelpers.loadFixture(deployFinalizedSystemFixture);

        const firstProject = await finishProject(fixture, VERSION_ONE, 1_000n, [
            { contributor: fixture.contributor.address, value: 100 }
        ]);

        const contributorDevBefore = await fixture.devToken.balanceOf(fixture.contributor.address);
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([firstProject.projectId])).wait();
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBefore + 1_000n);

        await (await fixture.devToken.connect(fixture.contributor).approve(await fixture.dividend.getAddress(), 400n)).wait();
        await (await fixture.dividend.connect(fixture.contributor).stakeDev(400n)).wait();

        await (await fixture.devToken.connect(fixture.contributor).approve(await fixture.lockup.getAddress(), 200n)).wait();
        await (await fixture.lockup.connect(fixture.contributor).convertAndLock([fixture.contributor.address], [200n])).wait();
        expect(await fixture.lockup.totalAssigned(fixture.contributor.address)).to.equal(200n);

        await (await fixture.devToken.connect(fixture.contributor).dev2normal(200n)).wait();
        await (await fixture.normalToken.connect(fixture.contributor).approve(await fixture.dividend.getAddress(), 200n)).wait();
        await (await fixture.dividend.connect(fixture.contributor).stakeNormal(200n)).wait();

        await networkHelpers.time.increase(ONE_HOUR + 1n);
        await (await fixture.dividend.tryNewCycle()).wait();
        await (await fixture.rewardToken.approve(await fixture.dividend.getAddress(), 600n)).wait();
        await (await fixture.dividend.deposit(600n, await fixture.rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(ONE_HOUR + 1n);
        await (await fixture.dividend.tryNewCycle()).wait();

        const estimate = await fixture.dividend.connect(fixture.contributor).estimateDividends(
            [1n],
            [await fixture.rewardToken.getAddress()]
        );
        expect(estimate).to.have.length(1);
        expect(estimate[0].amount).to.equal(600n);

        await (await fixture.dividend.connect(fixture.contributor).withdrawDividends(
            [1n],
            [await fixture.rewardToken.getAddress()]
        )).wait();
        expect(await fixture.rewardToken.balanceOf(fixture.contributor.address)).to.equal(600n);

        await networkHelpers.time.increase(SEVEN_DAYS + 1n);

        const secondProject = await finishProject(fixture, VERSION_TWO, 500n, [
            { contributor: fixture.contributor.address, value: 100 }
        ]);
        expect(secondProject.releaseTime).to.be.greaterThan(0n);

        await networkHelpers.time.increaseTo(secondProject.releaseTime + THIRTY_DAYS);

        expect(await fixture.lockup.connect(fixture.contributor).getCanClaimTokens()).to.equal(33n);

        const contributorNormalBefore = await fixture.normalToken.balanceOf(fixture.contributor.address);
        await (await fixture.lockup.connect(fixture.contributor).claimTokens(33n)).wait();
        expect(await fixture.normalToken.balanceOf(fixture.contributor.address)).to.equal(contributorNormalBefore + 33n);
        expect(await fixture.lockup.totalClaimed(fixture.contributor.address)).to.equal(33n);
    });
});
