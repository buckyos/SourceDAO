import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

const MAIN_PROJECT_NAME = ethers.encodeBytes32String("SourceDao");
const ONE_DAY = 24n * 60n * 60n;
const THIRTY_DAYS = 30n * ONE_DAY;
const SIX_MONTHS = 180n * ONE_DAY;

function convertVersion(version: string): bigint {
    const versions = version.split(".");
    if (versions.length !== 3) {
        throw new Error(`Invalid version format: ${version}`);
    }

    return (
        BigInt(versions[0]) * 10_000_000_000n +
        BigInt(versions[1]) * 100_000n +
        BigInt(versions[2])
    );
}

function toBytes32(value: bigint) {
    return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

function projectProposalParams(
    projectId: bigint,
    version: bigint,
    startDate: bigint,
    endDate: bigint,
    action: "createProject" | "acceptProject"
) {
    return [
        toBytes32(projectId),
        MAIN_PROJECT_NAME,
        toBytes32(version),
        toBytes32(startDate),
        toBytes32(endDate),
        ethers.encodeBytes32String(action)
    ];
}

async function deployLockupFixture(options?: {
    unlockProjectName?: string;
    unlockVersion?: bigint;
}) {
    const signers = await ethers.getSigners();
    const [owner, beneficiary] = signers;
    const releaseVersion = convertVersion("1.0.0");
    const trackedUnlockProjectName = options?.unlockProjectName ?? MAIN_PROJECT_NAME;
    const trackedUnlockVersion = options?.unlockVersion ?? releaseVersion;

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        [owner.address],
        1,
        400,
        MAIN_PROJECT_NAME,
        releaseVersion,
        150,
        daoAddress
    ]);
    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();

    const project = await deployUUPSProxy(ethers, "ProjectManagement", [1, daoAddress]);
    await (await dao.setProjectAddress(await project.getAddress())).wait();

    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        1_000_000,
        [owner.address],
        [5_000],
        daoAddress
    ]);
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["BDT", "BDT", daoAddress]);
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();

    await (await devToken.dev2normal(2_500)).wait();

    const lockup = await deployUUPSProxy(ethers, "SourceTokenLockup", [
        trackedUnlockProjectName,
        trackedUnlockVersion,
        daoAddress
    ]);
    await (await dao.setTokenLockupAddress(await lockup.getAddress())).wait();

    return {
        owner,
        beneficiary,
        dao,
        committee,
        project,
        devToken,
        normalToken,
        lockup,
        releaseVersion,
        trackedUnlockProjectName,
        trackedUnlockVersion
    };
}

async function releaseMainProject(
    fixture: any,
    createProposalId: bigint = 1n,
    acceptProposalId: bigint = 2n
) {
    const latestBlock = await ethers.provider.getBlock("latest");
    if (latestBlock === null) {
        throw new Error("latest block not found");
    }

    const startDate = BigInt(latestBlock.timestamp);
    const endDate = startDate + THIRTY_DAYS;

    await (await fixture.project.createProject(
        1_000,
        MAIN_PROJECT_NAME,
        fixture.releaseVersion,
        startDate,
        endDate,
        [],
        []
    )).wait();

    await (await fixture.committee.support(
        createProposalId,
        projectProposalParams(1n, fixture.releaseVersion, startDate, endDate, "createProject")
    )).wait();

    await (await fixture.project.promoteProject(1n)).wait();

    await (await fixture.project.acceptProject(1n, 4, [
        {
            contributor: fixture.owner.address,
            value: 100
        }
    ])).wait();

    await (await fixture.committee.support(
        acceptProposalId,
        projectProposalParams(1n, fixture.releaseVersion, startDate, endDate, "acceptProject")
    )).wait();

    await (await fixture.project.promoteProject(1n)).wait();

    return fixture.project.versionReleasedTime(MAIN_PROJECT_NAME, fixture.releaseVersion);
}

async function deployReleasedLockupFixture() {
    const fixture = await deployLockupFixture();

    await (await fixture.devToken.approve(await fixture.lockup.getAddress(), 2_000)).wait();
    await (await fixture.lockup.convertAndLock(
        [fixture.owner.address, fixture.beneficiary.address],
        [1_000, 1_000]
    )).wait();

    await (await fixture.normalToken.approve(await fixture.lockup.getAddress(), 2_000)).wait();
    await (await fixture.lockup.transferAndLock(
        [fixture.owner.address, fixture.beneficiary.address],
        [1_000, 1_000]
    )).wait();

    const releaseTime = await releaseMainProject(fixture);

    return {
        ...fixture,
        releaseTime
    };
}

async function deployUnreleasedTrackedVersionLockupFixture() {
    return deployLockupFixture({ unlockVersion: convertVersion("1.0.1") });
}

async function deployMiswiredLockupFixture() {
    const signers = await ethers.getSigners();
    const [owner, beneficiary] = signers;
    const releaseVersion = convertVersion("1.0.0");

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const project = await (await ethers.getContractFactory("ProjectVersionMock")).deploy();
    await project.waitForDeployment();
    await (await dao.setProjectAddress(await project.getAddress())).wait();

    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        1_000_000,
        [owner.address],
        [5_000],
        daoAddress
    ]);
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["BDT", "BDT", daoAddress]);
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();

    const wrongLockup = await (await ethers.getContractFactory("NativeReceiverMock")).deploy();
    await wrongLockup.waitForDeployment();
    await (await dao.setTokenLockupAddress(await wrongLockup.getAddress())).wait();

    const realLockup = await deployUUPSProxy(ethers, "SourceTokenLockup", [
        MAIN_PROJECT_NAME,
        releaseVersion,
        daoAddress
    ]);

    await (await devToken.dev2normal(1_000)).wait();
    await (await normalToken.transfer(beneficiary.address, 200n)).wait();

    return {
        owner,
        beneficiary,
        dao,
        project,
        devToken,
        normalToken,
        wrongLockup,
        realLockup,
        releaseVersion
    };
}

describe("Lockup", function () {
    it("rejects invalid tracked unlock configuration during initialization", async function () {
        const dao = await deployUUPSProxy(ethers, "SourceDao");
        const daoAddress = await dao.getAddress();

        await expect(deployUUPSProxy(ethers, "SourceTokenLockup", [
            ethers.ZeroHash,
            convertVersion("1.0.0"),
            daoAddress
        ])).to.be.revertedWith("invalid unlock project");

        await expect(deployUUPSProxy(ethers, "SourceTokenLockup", [
            MAIN_PROJECT_NAME,
            0,
            daoAddress
        ])).to.be.revertedWith("invalid unlock version");
    });

    it("reverts convertAndLock atomically when the registered lockup slot points elsewhere", async function () {
        const { owner, devToken, realLockup } = await networkHelpers.loadFixture(deployMiswiredLockupFixture);
        const ownerDevBefore = await devToken.balanceOf(owner.address);

        await (await devToken.approve(await realLockup.getAddress(), 300n)).wait();
        await expect(realLockup.convertAndLock([owner.address], [300n])).to.be.revertedWith("invalid transfer");

        expect(await devToken.balanceOf(owner.address)).to.equal(ownerDevBefore);
        expect(await devToken.balanceOf(await realLockup.getAddress())).to.equal(0n);
        expect(await realLockup.totalAssigned(owner.address)).to.equal(0n);
        expect(await realLockup.totalAssigned(ethers.ZeroAddress)).to.equal(0n);
        expect(await realLockup.totalClaimed(owner.address)).to.equal(0n);
    });

    it("keeps claims functional on the actual lockup contract even if the registered slot is miswired", async function () {
        const { owner, dao, project, normalToken, wrongLockup, realLockup, releaseVersion } = await networkHelpers.loadFixture(
            deployMiswiredLockupFixture
        );
        const registeredLockup = await ethers.getContractAt("SourceTokenLockup", await dao.lockup());

        await (await normalToken.approve(await realLockup.getAddress(), 300n)).wait();
        await (await realLockup.transferAndLock([owner.address], [300n])).wait();

        const latest = await networkHelpers.time.latest();
        await (await project.setVersionReleasedTime(MAIN_PROJECT_NAME, Number(releaseVersion), latest)).wait();
        await networkHelpers.time.increase(THIRTY_DAYS + 1n);

        let registryClaimReverted = false;
        try {
            await registeredLockup.claimTokens(1n);
        } catch {
            registryClaimReverted = true;
        }

        expect(registryClaimReverted).to.equal(true);
        const ownerNormalBeforeClaim = await normalToken.balanceOf(owner.address);
        await (await realLockup.claimTokens(50n)).wait();

        expect(await normalToken.balanceOf(owner.address)).to.equal(ownerNormalBeforeClaim + 50n);
        expect(await normalToken.balanceOf(await realLockup.getAddress())).to.equal(250n);
        expect(await normalToken.balanceOf(await wrongLockup.getAddress())).to.equal(0n);
        expect(await realLockup.totalClaimed(owner.address)).to.equal(50n);
        expect(await realLockup.totalClaimed(ethers.ZeroAddress)).to.equal(50n);
    });

    it("rejects lock operations with mismatched recipient and amount arrays", async function () {
        const { owner, devToken, normalToken, lockup } = await networkHelpers.loadFixture(deployLockupFixture);

        await (await devToken.approve(await lockup.getAddress(), 1_000)).wait();
        await expect(lockup.convertAndLock([owner.address], [500, 500])).to.be.revertedWith(
            "Input arrays must be of same length"
        );

        await (await normalToken.approve(await lockup.getAddress(), 1_000)).wait();
        await expect(lockup.transferAndLock([owner.address], [500, 500])).to.be.revertedWith(
            "Input arrays must be of same length"
        );
    });

    it("treats empty and zero-amount lock batches as no-op state changes before release", async function () {
        const { owner, beneficiary, devToken, normalToken, lockup } = await networkHelpers.loadFixture(deployLockupFixture);

        const ownerDevBefore = await devToken.balanceOf(owner.address);
        const ownerNormalBefore = await normalToken.balanceOf(owner.address);

        await (await lockup.convertAndLock([], [])).wait();
        await (await lockup.transferAndLock([], [])).wait();

        await (await devToken.approve(await lockup.getAddress(), 0)).wait();
        await (await lockup.convertAndLock([owner.address, beneficiary.address], [0, 0])).wait();

        await (await normalToken.approve(await lockup.getAddress(), 0)).wait();
        await (await lockup.transferAndLock([owner.address, beneficiary.address], [0, 0])).wait();

        expect(await devToken.balanceOf(owner.address)).to.equal(ownerDevBefore);
        expect(await normalToken.balanceOf(owner.address)).to.equal(ownerNormalBefore);
        expect(await lockup.totalAssigned(owner.address)).to.equal(0n);
        expect(await lockup.totalAssigned(beneficiary.address)).to.equal(0n);
        expect(await lockup.totalAssigned(ethers.ZeroAddress)).to.equal(0n);
        expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(0n);
    });

    it("aggregates repeated recipient entries across multiple lock batches", async function () {
        const { owner, beneficiary, devToken, normalToken, lockup } = await networkHelpers.loadFixture(deployLockupFixture);

        await (await devToken.approve(await lockup.getAddress(), 300)).wait();
        await (await lockup.convertAndLock(
            [owner.address, owner.address, beneficiary.address],
            [100, 150, 50]
        )).wait();

        await (await normalToken.approve(await lockup.getAddress(), 300)).wait();
        await (await lockup.transferAndLock(
            [owner.address, beneficiary.address, owner.address],
            [200, 75, 25]
        )).wait();

        expect(await lockup.totalAssigned(owner.address)).to.equal(475n);
        expect(await lockup.totalAssigned(beneficiary.address)).to.equal(125n);
        expect(await lockup.totalAssigned(ethers.ZeroAddress)).to.equal(600n);
        expect(await lockup.totalClaimed(owner.address)).to.equal(0n);
        expect(await lockup.totalClaimed(beneficiary.address)).to.equal(0n);
    });

    it("locks converted and transferred tokens for the sender before release", async function () {
        const { owner, devToken, normalToken, lockup } = await networkHelpers.loadFixture(deployLockupFixture);

        expect(await devToken.balanceOf(owner.address)).to.equal(2_500n);
        expect(await normalToken.balanceOf(owner.address)).to.equal(2_500n);
        expect(await lockup.totalAssigned(owner.address)).to.equal(0n);

        await (await devToken.approve(await lockup.getAddress(), 1_000)).wait();
        await (await lockup.convertAndLock([owner.address], [1_000])).wait();

        await (await normalToken.approve(await lockup.getAddress(), 1_000)).wait();
        await (await lockup.transferAndLock([owner.address], [1_000])).wait();

        expect(await devToken.balanceOf(owner.address)).to.equal(1_500n);
        expect(await normalToken.balanceOf(owner.address)).to.equal(1_500n);
        expect(await lockup.totalAssigned(owner.address)).to.equal(2_000n);
        expect(await lockup.totalAssigned(ethers.ZeroAddress)).to.equal(2_000n);
        expect(await lockup.getCanClaimTokens()).to.equal(0n);

        await expect(lockup.claimTokens(1_000)).to.be.revertedWith("Tokens are not unlocked yet");
    });

    it("tracks locked balances independently for another beneficiary", async function () {
        const { owner, beneficiary, devToken, normalToken, lockup } = await networkHelpers.loadFixture(deployLockupFixture);

        await (await devToken.approve(await lockup.getAddress(), 1_000)).wait();
        await (await lockup.convertAndLock([beneficiary.address], [1_000])).wait();

        await (await normalToken.approve(await lockup.getAddress(), 1_000)).wait();
        await (await lockup.transferAndLock([beneficiary.address], [1_000])).wait();

        expect(await devToken.balanceOf(owner.address)).to.equal(1_500n);
        expect(await normalToken.balanceOf(owner.address)).to.equal(1_500n);
        expect(await lockup.totalAssigned(owner.address)).to.equal(0n);
        expect(await lockup.totalAssigned(beneficiary.address)).to.equal(2_000n);
        expect(await lockup.connect(beneficiary).getCanClaimTokens()).to.equal(0n);

        await expect(lockup.connect(beneficiary).claimTokens(1_000)).to.be.revertedWith(
            "Tokens are not unlocked yet"
        );
    });

    it("does not unlock anything at the exact release timestamp", async function () {
        const { lockup, releaseTime } = await networkHelpers.loadFixture(deployReleasedLockupFixture);

        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        expect(BigInt(latestBlock.timestamp)).to.equal(releaseTime);
        expect(await lockup.getCanClaimTokens()).to.equal(0n);
        await expect(lockup.claimTokens(1)).to.be.revertedWith("Claim amount exceeds unlocked tokens");
    });

    it("does not unlock when only a different tracked version remains unreleased", async function () {
        const fixture = await networkHelpers.loadFixture(deployUnreleasedTrackedVersionLockupFixture);

        await (await fixture.devToken.approve(await fixture.lockup.getAddress(), 1_000)).wait();
        await (await fixture.lockup.convertAndLock([fixture.owner.address], [1_000])).wait();

        await (await fixture.normalToken.approve(await fixture.lockup.getAddress(), 1_000)).wait();
        await (await fixture.lockup.transferAndLock([fixture.owner.address], [1_000])).wait();

        await releaseMainProject(fixture);
        await networkHelpers.time.increase(SIX_MONTHS);

        expect(await fixture.lockup.getCanClaimTokens()).to.equal(0n);
        await expect(fixture.lockup.claimTokens(1)).to.be.revertedWith("Tokens are not unlocked yet");
    });

    it("uses the same main-project release to finalize committee devRatio and unlock lockup claims", async function () {
        const fixture = await networkHelpers.loadFixture(deployLockupFixture);
        const pendingRatio = 300n;
        const proposalId = 1n;

        await (await fixture.normalToken.approve(await fixture.lockup.getAddress(), 600)).wait();
        await (await fixture.lockup.transferAndLock([fixture.owner.address], [600])).wait();

        expect(await fixture.committee.devRatio()).to.equal(400n);
        expect(await fixture.lockup.getCanClaimTokens()).to.equal(0n);

        await (await fixture.committee.prepareSetDevRatio(pendingRatio)).wait();
        await (await fixture.committee.support(
            proposalId,
            [toBytes32(pendingRatio), ethers.encodeBytes32String("setDevRatio")]
        )).wait();

        const releaseTime = await releaseMainProject(fixture, 2n, 3n);
        await networkHelpers.time.increaseTo(releaseTime + THIRTY_DAYS);

        await expect(fixture.committee.setDevRatio(pendingRatio, proposalId))
            .to.emit(fixture.committee, "DevRatioChanged")
            .withArgs(400n, 150n);

        expect(await fixture.committee.devRatio()).to.equal(150n);
        expect(await fixture.lockup.getCanClaimTokens()).to.equal(100n);

        const ownerBalanceBefore = await fixture.normalToken.balanceOf(fixture.owner.address);
        await (await fixture.lockup.claimTokens(100)).wait();
        expect(await fixture.normalToken.balanceOf(fixture.owner.address)).to.equal(ownerBalanceBefore + 100n);
    });

    it("releases only part of the locked tokens after 30 days", async function () {
        const { owner, beneficiary, normalToken, lockup, releaseTime } = await networkHelpers.loadFixture(deployReleasedLockupFixture);

        expect(releaseTime).to.be.greaterThan(0n);
        expect(await lockup.totalAssigned(owner.address)).to.equal(2_000n);
        expect(await lockup.totalAssigned(beneficiary.address)).to.equal(2_000n);
        expect(await lockup.getCanClaimTokens()).to.equal(0n);

        await networkHelpers.time.increase(THIRTY_DAYS);

        expect(await lockup.getCanClaimTokens()).to.equal(333n);
        expect(await lockup.connect(beneficiary).getCanClaimTokens()).to.equal(333n);

        await expect(lockup.claimTokens(350)).to.be.revertedWith("Claim amount exceeds unlocked tokens");

        const ownerBalanceBefore = await normalToken.balanceOf(owner.address);
        await (await lockup.claimTokens(200)).wait();
        expect(await normalToken.balanceOf(owner.address)).to.equal(ownerBalanceBefore + 200n);

        const beneficiaryBalanceBefore = await normalToken.balanceOf(beneficiary.address);
        await (await lockup.connect(beneficiary).claimTokens(250)).wait();
        expect(await normalToken.balanceOf(beneficiary.address)).to.equal(beneficiaryBalanceBefore + 250n);

        expect(await lockup.totalClaimed(owner.address)).to.equal(200n);
        expect(await lockup.totalClaimed(beneficiary.address)).to.equal(250n);
        expect(await lockup.getCanClaimTokens()).to.equal(133n);
        expect(await lockup.connect(beneficiary).getCanClaimTokens()).to.equal(83n);

        await (await lockup.claimTokens(133)).wait();
        expect(await lockup.getCanClaimTokens()).to.equal(0n);
        await expect(lockup.claimTokens(1)).to.be.revertedWith("Claim amount exceeds unlocked tokens");
    });

    it("keeps later cross-user claim math stable after the first claim persists the release start", async function () {
        const { owner, beneficiary, normalToken, lockup, releaseTime } = await networkHelpers.loadFixture(deployReleasedLockupFixture);

        await networkHelpers.time.increaseTo(releaseTime + THIRTY_DAYS);

        const beneficiaryBalanceBefore = await normalToken.balanceOf(beneficiary.address);
        await (await lockup.connect(beneficiary).claimTokens(100)).wait();
        expect(await normalToken.balanceOf(beneficiary.address)).to.equal(beneficiaryBalanceBefore + 100n);
        expect(await lockup.totalClaimed(beneficiary.address)).to.equal(100n);
        expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(100n);

        await networkHelpers.time.increase(THIRTY_DAYS);

        expect(await lockup.getCanClaimTokens()).to.equal(666n);
        expect(await lockup.connect(beneficiary).getCanClaimTokens()).to.equal(566n);

        const ownerBalanceBefore = await normalToken.balanceOf(owner.address);
        await (await lockup.claimTokens(666)).wait();
        expect(await normalToken.balanceOf(owner.address)).to.equal(ownerBalanceBefore + 666n);
        expect(await lockup.totalClaimed(owner.address)).to.equal(666n);
        expect(await lockup.totalClaimed(beneficiary.address)).to.equal(100n);
        expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(766n);
    });

    it("uses the original release timestamp even when the first successful claim happens much later", async function () {
        const { owner, beneficiary, normalToken, lockup, releaseTime } = await networkHelpers.loadFixture(deployReleasedLockupFixture);

        await networkHelpers.time.increaseTo(releaseTime + 90n * ONE_DAY);

        expect(await lockup.getCanClaimTokens()).to.equal(1_000n);
        expect(await lockup.connect(beneficiary).getCanClaimTokens()).to.equal(1_000n);

        const ownerBalanceBefore = await normalToken.balanceOf(owner.address);
        await (await lockup.claimTokens(1_000)).wait();
        expect(await normalToken.balanceOf(owner.address)).to.equal(ownerBalanceBefore + 1_000n);
        expect(await lockup.totalClaimed(owner.address)).to.equal(1_000n);
        expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(1_000n);

        await networkHelpers.time.increase(90n * ONE_DAY);

        expect(await lockup.getCanClaimTokens()).to.equal(1_000n);
        expect(await lockup.connect(beneficiary).getCanClaimTokens()).to.equal(2_000n);

        const beneficiaryBalanceBefore = await normalToken.balanceOf(beneficiary.address);
        await (await lockup.connect(beneficiary).claimTokens(2_000)).wait();
        expect(await normalToken.balanceOf(beneficiary.address)).to.equal(beneficiaryBalanceBefore + 2_000n);
        expect(await lockup.totalClaimed(beneficiary.address)).to.equal(2_000n);
        expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(3_000n);
    });

    it("keeps uneven small lock allocations consistent across rounding-heavy release checkpoints", async function () {
        const fixture = await networkHelpers.loadFixture(deployLockupFixture);
        const signers = await ethers.getSigners();
        const outsider = signers[2];

        await (await fixture.normalToken.approve(await fixture.lockup.getAddress(), 23)).wait();
        await (await fixture.lockup.transferAndLock(
            [fixture.owner.address, fixture.beneficiary.address, outsider.address],
            [5, 7, 11]
        )).wait();

        const releaseTime = await releaseMainProject(fixture);
        await networkHelpers.time.increaseTo(releaseTime + THIRTY_DAYS);

        expect(await fixture.lockup.getCanClaimTokens()).to.equal(0n);
        expect(await fixture.lockup.connect(fixture.beneficiary).getCanClaimTokens()).to.equal(1n);
        expect(await fixture.lockup.connect(outsider).getCanClaimTokens()).to.equal(1n);

        await networkHelpers.time.increase(149n * ONE_DAY);

        expect(await fixture.lockup.getCanClaimTokens()).to.equal(4n);
        expect(await fixture.lockup.connect(fixture.beneficiary).getCanClaimTokens()).to.equal(6n);
        expect(await fixture.lockup.connect(outsider).getCanClaimTokens()).to.equal(10n);

        await networkHelpers.time.increase(ONE_DAY);

        expect(await fixture.lockup.getCanClaimTokens()).to.equal(5n);
        expect(await fixture.lockup.connect(fixture.beneficiary).getCanClaimTokens()).to.equal(7n);
        expect(await fixture.lockup.connect(outsider).getCanClaimTokens()).to.equal(11n);
        expect(await fixture.lockup.totalAssigned(ethers.ZeroAddress)).to.equal(23n);
    });

    it("keeps global and per-user accounting consistent across staggered partial claims", async function () {
        const { owner, beneficiary, normalToken, lockup, releaseTime } = await networkHelpers.loadFixture(deployReleasedLockupFixture);

        await networkHelpers.time.increaseTo(releaseTime + THIRTY_DAYS);

        const ownerBalanceBefore = await normalToken.balanceOf(owner.address);
        await (await lockup.claimTokens(200)).wait();
        expect(await normalToken.balanceOf(owner.address)).to.equal(ownerBalanceBefore + 200n);
        expect(await lockup.totalClaimed(owner.address)).to.equal(200n);
        expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(200n);
        expect(await normalToken.balanceOf(await lockup.getAddress())).to.equal(3_800n);

        await networkHelpers.time.increase(THIRTY_DAYS);

        const beneficiaryBalanceBefore = await normalToken.balanceOf(beneficiary.address);
        await (await lockup.connect(beneficiary).claimTokens(400)).wait();
        expect(await normalToken.balanceOf(beneficiary.address)).to.equal(beneficiaryBalanceBefore + 400n);
        expect(await lockup.totalClaimed(beneficiary.address)).to.equal(400n);
        expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(600n);
        expect(await normalToken.balanceOf(await lockup.getAddress())).to.equal(3_400n);

        await networkHelpers.time.increase(60n * ONE_DAY);

        await (await lockup.claimTokens(800)).wait();
        expect(await lockup.totalClaimed(owner.address)).to.equal(1_000n);
        expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(1_400n);
        expect(await normalToken.balanceOf(await lockup.getAddress())).to.equal(2_600n);

        await networkHelpers.time.increase(60n * ONE_DAY);

        await (await lockup.claimTokens(1_000)).wait();
        await (await lockup.connect(beneficiary).claimTokens(1_600)).wait();

        expect(await lockup.totalClaimed(owner.address)).to.equal(2_000n);
        expect(await lockup.totalClaimed(beneficiary.address)).to.equal(2_000n);
        expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(4_000n);
        expect(await normalToken.balanceOf(await lockup.getAddress())).to.equal(0n);
        expect(await lockup.getCanClaimTokens()).to.equal(0n);
        expect(await lockup.connect(beneficiary).getCanClaimTokens()).to.equal(0n);
    });

    it("releases the full remaining balance after 180 days", async function () {
        const { owner, beneficiary, normalToken, lockup } = await networkHelpers.loadFixture(deployReleasedLockupFixture);

        await networkHelpers.time.increase(SIX_MONTHS);

        const ownerBalanceBefore = await normalToken.balanceOf(owner.address);
        await (await lockup.claimTokens(2_000)).wait();
        expect(await normalToken.balanceOf(owner.address)).to.equal(ownerBalanceBefore + 2_000n);

        const beneficiaryBalanceBefore = await normalToken.balanceOf(beneficiary.address);
        await (await lockup.connect(beneficiary).claimTokens(2_000)).wait();
        expect(await normalToken.balanceOf(beneficiary.address)).to.equal(beneficiaryBalanceBefore + 2_000n);

        expect(await lockup.totalClaimed(owner.address)).to.equal(2_000n);
        expect(await lockup.totalClaimed(beneficiary.address)).to.equal(2_000n);
        expect(await lockup.totalAssigned(ethers.ZeroAddress)).to.equal(4_000n);
        expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(4_000n);
        expect(await lockup.getCanClaimTokens()).to.equal(0n);
    });

    it("rejects creating new lockups after the unlock version is already released", async function () {
        const { owner, beneficiary, devToken, normalToken, lockup, releaseTime } = await networkHelpers.loadFixture(deployReleasedLockupFixture);

        await networkHelpers.time.increaseTo(releaseTime + 1n);
        expect(await lockup.getCanClaimTokens()).to.equal(0n);

        await (await devToken.approve(await lockup.getAddress(), 100)).wait();
        await expect(lockup.convertAndLock([beneficiary.address], [100])).to.be.revertedWith("already Unlocked");

        await (await normalToken.approve(await lockup.getAddress(), 100)).wait();
        await expect(lockup.transferAndLock([owner.address], [100])).to.be.revertedWith("already Unlocked");
    });

    it("keeps zero-allocation users at zero claimable balance even after release", async function () {
        const { lockup, releaseTime } = await networkHelpers.loadFixture(deployReleasedLockupFixture);
        const signers = await ethers.getSigners();
        const outsider = signers[2];

        await networkHelpers.time.increaseTo(releaseTime + SIX_MONTHS);

        expect(await lockup.totalAssigned(outsider.address)).to.equal(0n);
        expect(await lockup.totalClaimed(outsider.address)).to.equal(0n);
        expect(await lockup.connect(outsider).getCanClaimTokens()).to.equal(0n);
        await expect(lockup.connect(outsider).claimTokens(1)).to.be.revertedWith("Claim amount exceeds unlocked tokens");
    });
});
