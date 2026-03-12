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

async function deployLockupFixture() {
    const signers = await ethers.getSigners();
    const [owner, beneficiary] = signers;
    const releaseVersion = convertVersion("1.0.0");

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
        MAIN_PROJECT_NAME,
        releaseVersion,
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
        releaseVersion
    };
}

async function releaseMainProject(fixture: any) {
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
        1n,
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
        2n,
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

describe("Lockup", function () {
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
});