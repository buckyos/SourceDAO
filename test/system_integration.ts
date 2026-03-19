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

function setCommitteesParams(members: string[]) {
    return [
        ...members.map((member) => ethers.zeroPadValue(member, 32)),
        ethers.encodeBytes32String("setCommittees")
    ];
}

function setDevRatioParams(newRatio: bigint) {
    return [
        toBytes32(newRatio),
        ethers.encodeBytes32String("setDevRatio")
    ];
}

function upgradeParams(
    proxyAddress: string,
    implementationAddress: string,
    upgradeData: string = "0x"
) {
    return [
        ethers.zeroPadValue(proxyAddress, 32),
        ethers.zeroPadValue(implementationAddress, 32),
        ethers.keccak256(upgradeData),
        ethers.encodeBytes32String("upgradeContract")
    ];
}

async function deployConfiguredSystemFixture() {
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
    it("keeps project governance and acquired sales operational after dao bootstrap wiring", async function () {
        const fixture = await networkHelpers.loadFixture(deployConfiguredSystemFixture);

        await expect(
            fixture.dao.setDevTokenAddress(await fixture.devToken.getAddress())
        ).to.be.revertedWith("can set once");

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

    it("routes project rewards into dividend staking and a future-version lockup after dao bootstrap wiring", async function () {
        const fixture = await networkHelpers.loadFixture(deployConfiguredSystemFixture);

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

    it("lets multiple contributors route rewards through dividend and lockup before one of them starts full-proposal governance", async function () {
        const signers = await ethers.getSigners();
        const fixture = await networkHelpers.loadFixture(deployConfiguredSystemFixture);
        const candidate = signers[5];
        const candidateTwo = signers[6];
        const replacementMembers = [fixture.manager.address, candidate.address, candidateTwo.address];
        const proposalParams = setCommitteesParams(replacementMembers);
        const firstProject = await finishProject(fixture, VERSION_ONE, 1_000n, [
            { contributor: fixture.contributor.address, value: 60 },
            { contributor: fixture.buyer.address, value: 40 }
        ]);
        const proposalId = firstProject.acceptProposalId + 1n;

        await (await fixture.project.connect(fixture.contributor).withdrawContributions([firstProject.projectId])).wait();
        await (await fixture.project.connect(fixture.buyer).withdrawContributions([firstProject.projectId])).wait();

        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(600n);
        expect(await fixture.devToken.balanceOf(fixture.buyer.address)).to.equal(400n);

        await (await fixture.devToken.connect(fixture.contributor).approve(await fixture.dividend.getAddress(), 200n)).wait();
        await (await fixture.dividend.connect(fixture.contributor).stakeDev(200n)).wait();
        await (await fixture.devToken.connect(fixture.contributor).dev2normal(100n)).wait();
        await (await fixture.normalToken.connect(fixture.contributor).approve(await fixture.dividend.getAddress(), 100n)).wait();
        await (await fixture.dividend.connect(fixture.contributor).stakeNormal(100n)).wait();

        const currentCycleIndex = await fixture.dividend.getCurrentCycleIndex();
        expect(await fixture.dividend.connect(fixture.contributor).getStakeAmount(currentCycleIndex)).to.equal(300n);

        await (await fixture.devToken.connect(fixture.buyer).approve(await fixture.lockup.getAddress(), 200n)).wait();
        await (await fixture.lockup.connect(fixture.buyer).convertAndLock([fixture.buyer.address], [200n])).wait();
        expect(await fixture.lockup.totalAssigned(fixture.buyer.address)).to.equal(200n);

        await expect(fixture.committee.connect(fixture.buyer).prepareSetCommittees(replacementMembers, true))
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(proposalId, true);

        await (await fixture.committee.connect(fixture.buyer).support(proposalId, proposalParams)).wait();
        await (await fixture.committee.connect(fixture.contributor).support(proposalId, proposalParams)).wait();
        await (await fixture.committee.connect(fixture.manager).support(proposalId, proposalParams)).wait();

        await networkHelpers.time.increase(SEVEN_DAYS + 1n);

        await expect(
            fixture.committee.endFullPropose(
                proposalId,
                [fixture.buyer.address, fixture.contributor.address, fixture.manager.address]
            )
        )
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(proposalId);

        await (await fixture.committee.setCommittees(replacementMembers, proposalId)).wait();
        expect(await fixture.committee.members()).to.deep.equal(replacementMembers);
        expect(await fixture.lockup.totalAssigned(fixture.buyer.address)).to.equal(200n);
        expect(await fixture.dividend.connect(fixture.contributor).getStakeAmount(currentCycleIndex)).to.equal(300n);
    });

    it("replaces the committee through a full proposal on a configured system and lets the new committee finish project governance", async function () {
        const signers = await ethers.getSigners();
        const fixture = await networkHelpers.loadFixture(deployConfiguredSystemFixture);
        const candidate = signers[5];
        const candidateTwo = signers[6];
        const replacementMembers = [fixture.manager.address, candidate.address, candidateTwo.address];
        const proposalId = 1n;
        const proposalParams = setCommitteesParams(replacementMembers);
        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        await expect(fixture.committee.connect(fixture.manager).prepareSetCommittees(replacementMembers, true))
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(proposalId, true);

        await (await fixture.committee.connect(fixture.manager).support(proposalId, proposalParams)).wait();

        await networkHelpers.time.increase(SEVEN_DAYS + 1n);

        await expect(fixture.committee.endFullPropose(proposalId, [fixture.manager.address]))
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(proposalId);

        await expect(fixture.committee.setCommittees(replacementMembers, proposalId))
            .to.emit(fixture.committee, "MemberChanged");

        expect(await fixture.committee.members()).to.deep.equal(replacementMembers);

        const startDate = BigInt(latestBlock.timestamp) + SEVEN_DAYS + 2n;
        const endDate = startDate + THIRTY_DAYS;

        await (await fixture.project.createProject(
            1_000n,
            PROJECT_NAME,
            VERSION_ONE,
            startDate,
            endDate,
            [],
            []
        )).wait();

        const createProposalId = (await fixture.project.projectOf(1n)).proposalId;
        const createParams = projectParams(1n, VERSION_ONE, startDate, endDate, "createProject");

        await (await fixture.committee.connect(fixture.manager).support(createProposalId, createParams)).wait();
        await expect(
            fixture.committee.connect(fixture.memberTwo).support(createProposalId, createParams)
        ).to.be.revertedWith("only committee can vote");
        await (await fixture.committee.connect(candidate).support(createProposalId, createParams)).wait();

        await (await fixture.project.promoteProject(1n)).wait();

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.contributor.address, value: 100 }
        ])).wait();

        const acceptProposalId = (await fixture.project.projectOf(1n)).proposalId;
        const acceptParams = projectParams(1n, VERSION_ONE, startDate, endDate, "acceptProject");

        await (await fixture.committee.connect(fixture.manager).support(acceptProposalId, acceptParams)).wait();
        await expect(
            fixture.committee.connect(fixture.memberTwo).support(acceptProposalId, acceptParams)
        ).to.be.revertedWith("only committee can vote");
        await (await fixture.committee.connect(candidate).support(acceptProposalId, acceptParams)).wait();

        await (await fixture.project.promoteProject(1n)).wait();

        expect((await fixture.project.projectOf(1n)).state).to.equal(3n);
        expect((await fixture.committee.proposalOf(createProposalId)).state).to.equal(4n);
        expect((await fixture.committee.proposalOf(acceptProposalId)).state).to.equal(4n);
    });

    it("settles a multi-voter full proposal across batches on a configured system", async function () {
        const signers = await ethers.getSigners();
        const fixture = await networkHelpers.loadFixture(deployConfiguredSystemFixture);
        const candidate = signers[5];
        const candidateTwo = signers[6];
        const replacementMembers = [fixture.manager.address, candidate.address, candidateTwo.address];
        const proposalId = 1n;
        const proposalParams = setCommitteesParams(replacementMembers);

        await (await fixture.normalToken.transfer(fixture.contributor.address, 100n)).wait();

        expect(await fixture.normalToken.balanceOf(fixture.manager.address)).to.equal(700n);
        expect(await fixture.normalToken.balanceOf(fixture.buyer.address)).to.equal(200n);
        expect(await fixture.normalToken.balanceOf(fixture.contributor.address)).to.equal(100n);

        await expect(fixture.committee.connect(fixture.manager).prepareSetCommittees(replacementMembers, true))
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(proposalId, true);

        await (await fixture.committee.connect(fixture.manager).support(proposalId, proposalParams)).wait();
        await (await fixture.committee.connect(fixture.buyer).reject(proposalId, proposalParams)).wait();
        await (await fixture.committee.connect(fixture.contributor).support(proposalId, proposalParams)).wait();

        await networkHelpers.time.increase(SEVEN_DAYS + 1n);

        await (await fixture.committee.endFullPropose(proposalId, [fixture.manager.address])).wait();

        const partialExtra = await fixture.committee.proposalExtraOf(proposalId);
        expect(partialExtra.agree).to.equal(8_700n);
        expect(partialExtra.reject).to.equal(0n);
        expect(partialExtra.settled).to.equal(1n);
        expect(partialExtra.totalReleasedToken).to.equal(9_000n);
        expect((await fixture.committee.proposalOf(proposalId)).state).to.equal(1n);

        await expect(
            fixture.committee.endFullPropose(
                proposalId,
                [fixture.manager.address, fixture.buyer.address, fixture.contributor.address, fixture.manager.address]
            )
        )
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(proposalId);

        const finalExtra = await fixture.committee.proposalExtraOf(proposalId);
        expect(finalExtra.agree).to.equal(8_800n);
        expect(finalExtra.reject).to.equal(200n);
        expect(finalExtra.settled).to.equal(3n);
        expect(finalExtra.totalReleasedToken).to.equal(9_000n);
        expect((await fixture.committee.proposalOf(proposalId)).state).to.equal(2n);

        await (await fixture.committee.setCommittees(replacementMembers, proposalId)).wait();
        expect(await fixture.committee.members()).to.deep.equal(replacementMembers);
    });

    it("lets a token holder initiate committee replacement after the final release and settles it with finalRatio weights", async function () {
        const signers = await ethers.getSigners();
        const fixture = await networkHelpers.loadFixture(deployConfiguredSystemFixture);
        const candidate = signers[5];
        const candidateTwo = signers[6];
        const replacementMembers = [fixture.manager.address, candidate.address, candidateTwo.address];
        const firstProject = await finishProject(fixture, VERSION_ONE, 1_000n, [
            { contributor: fixture.contributor.address, value: 100 }
        ]);

        await networkHelpers.time.increase(SEVEN_DAYS + 1n);

        const secondProject = await finishProject(fixture, VERSION_TWO, 500n, [
            { contributor: fixture.contributor.address, value: 100 }
        ]);
        const proposalId = secondProject.acceptProposalId + 1n;
        const proposalParams = setCommitteesParams(replacementMembers);

        expect(firstProject.releaseTime).to.be.greaterThan(0n);
        expect(secondProject.releaseTime).to.be.greaterThan(0n);
        expect(await fixture.committee.devRatio()).to.equal(200n);

        await expect(fixture.committee.connect(fixture.contributor).prepareSetCommittees(replacementMembers, true))
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(proposalId, true);

        await (await fixture.committee.connect(fixture.manager).support(proposalId, proposalParams)).wait();

        await networkHelpers.time.increase(SEVEN_DAYS + 1n);

        await expect(fixture.committee.endFullPropose(proposalId, [fixture.manager.address]))
            .to.emit(fixture.committee, "DevRatioChanged")
            .withArgs(200n, 150n)
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(proposalId);

        expect(await fixture.committee.devRatio()).to.equal(150n);

        await (await fixture.committee.setCommittees(replacementMembers, proposalId)).wait();
        expect(await fixture.committee.members()).to.deep.equal(replacementMembers);
    });

    it("keeps ordinary and full proposals coherent when the final release happens while both are pending", async function () {
        const signers = await ethers.getSigners();
        const fixture = await networkHelpers.loadFixture(deployConfiguredSystemFixture);
        const candidate = signers[5];
        const candidateTwo = signers[6];
        const replacementMembers = [fixture.manager.address, candidate.address, candidateTwo.address];
        const ordinaryProposalId = 1n;
        const fullProposalId = 2n;
        const pendingRatio = 180n;

        await (await fixture.committee.connect(fixture.manager).prepareSetDevRatio(pendingRatio)).wait();
        await (await fixture.committee.connect(fixture.manager).support(
            ordinaryProposalId,
            setDevRatioParams(pendingRatio)
        )).wait();

        await expect(fixture.committee.connect(fixture.manager).prepareSetCommittees(replacementMembers, true))
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(fullProposalId, true);

        await (await fixture.committee.connect(fixture.manager).support(
            fullProposalId,
            setCommitteesParams(replacementMembers)
        )).wait();
        await (await fixture.committee.connect(fixture.memberTwo).support(
            ordinaryProposalId,
            setDevRatioParams(pendingRatio)
        )).wait();

        const finalProject = await finishProject(fixture, VERSION_TWO, 500n, [
            { contributor: fixture.contributor.address, value: 100 }
        ]);

        expect(finalProject.releaseTime).to.be.greaterThan(0n);
        expect(await fixture.committee.devRatio()).to.equal(200n);

        await networkHelpers.time.increase(SEVEN_DAYS + 1n);

        await expect(fixture.committee.endFullPropose(fullProposalId, [fixture.manager.address]))
            .to.emit(fixture.committee, "DevRatioChanged")
            .withArgs(200n, 150n)
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(fullProposalId);

        await (await fixture.committee.setCommittees(replacementMembers, fullProposalId)).wait();
        expect(await fixture.committee.members()).to.deep.equal(replacementMembers);

        await expect(fixture.committee.setDevRatio(pendingRatio, ordinaryProposalId))
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(ordinaryProposalId)
            .to.emit(fixture.committee, "ProposalExecuted")
            .withArgs(ordinaryProposalId);

        expect(await fixture.committee.devRatio()).to.equal(150n);
        expect((await fixture.committee.proposalOf(ordinaryProposalId)).state).to.equal(4n);
        expect((await fixture.committee.proposalOf(fullProposalId)).state).to.equal(4n);
    });

    it("lets a replacement committee approve a dao upgrade after full-proposal rotation", async function () {
        const signers = await ethers.getSigners();
        const fixture = await networkHelpers.loadFixture(deployConfiguredSystemFixture);
        const candidate = signers[5];
        const candidateTwo = signers[6];
        const replacementMembers = [fixture.manager.address, candidate.address, candidateTwo.address];
        const rotateProposalId = 1n;
        const upgradeProposalId = 2n;
        const rotateParams = setCommitteesParams(replacementMembers);
        const daoAddress = await fixture.dao.getAddress();
        const nextDaoImplementation = await (await ethers.getContractFactory("SourceDaoV2Mock")).deploy();
        await nextDaoImplementation.waitForDeployment();
        const nextDaoImplementationAddress = await nextDaoImplementation.getAddress();
        const upgradeProposalParams = upgradeParams(daoAddress, nextDaoImplementationAddress);

        await expect(fixture.committee.connect(fixture.manager).prepareSetCommittees(replacementMembers, true))
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(rotateProposalId, true);

        await (await fixture.committee.connect(fixture.manager).support(rotateProposalId, rotateParams)).wait();

        await networkHelpers.time.increase(SEVEN_DAYS + 1n);

        await expect(fixture.committee.endFullPropose(rotateProposalId, [fixture.manager.address]))
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(rotateProposalId);

        await (await fixture.committee.setCommittees(replacementMembers, rotateProposalId)).wait();
        expect(await fixture.committee.members()).to.deep.equal(replacementMembers);

        await expect(
            fixture.committee.connect(fixture.memberTwo).prepareContractUpgrade(daoAddress, nextDaoImplementationAddress)
        ).to.be.revertedWith("only committee can upgrade contract");

        await expect(
            fixture.committee.connect(candidate).prepareContractUpgrade(daoAddress, nextDaoImplementationAddress)
        )
            .to.emit(fixture.committee, "ProposalStart")
            .withArgs(upgradeProposalId, false);

        await expect(
            fixture.committee.connect(fixture.memberTwo).support(upgradeProposalId, upgradeProposalParams)
        ).to.be.revertedWith("only committee can vote");

        await (await fixture.committee.connect(fixture.manager).support(upgradeProposalId, upgradeProposalParams)).wait();
        await (await fixture.committee.connect(candidateTwo).support(upgradeProposalId, upgradeProposalParams)).wait();

        await expect(fixture.dao.upgradeToAndCall(nextDaoImplementationAddress, "0x"))
            .to.emit(fixture.committee, "ProposalAccept")
            .withArgs(upgradeProposalId);

        const upgradedDao = await ethers.getContractAt("SourceDaoV2Mock", daoAddress);
        expect(await upgradedDao.version()).to.equal("2.1.0");
        expect(await upgradedDao.committee()).to.equal(await fixture.committee.getAddress());
        expect(await upgradedDao.project()).to.equal(await fixture.project.getAddress());
        expect(await upgradedDao.devToken()).to.equal(await fixture.devToken.getAddress());
        expect(await upgradedDao.normalToken()).to.equal(await fixture.normalToken.getAddress());
        expect(await upgradedDao.lockup()).to.equal(await fixture.lockup.getAddress());
        expect(await upgradedDao.dividend()).to.equal(await fixture.dividend.getAddress());
        expect(await upgradedDao.acquired()).to.equal(await fixture.acquired.getAddress());
    });
});
