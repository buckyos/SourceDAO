import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

async function deployDividendFixture() {
    const [owner, beneficiary, outsider] = await ethers.getSigners();
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

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

    const dividend = await deployUUPSProxy(ethers, "DividendContract", [3600, daoAddress]);
    await (await dao.setTokenDividendAddress(await dividend.getAddress())).wait();

    await (await devToken.dev2normal(600)).wait();
    await (await normalToken.transfer(beneficiary.address, 200)).wait();

    const rewardTokenFactory = await ethers.getContractFactory("TestToken");
    const rewardToken = await rewardTokenFactory.deploy("Reward", "RWD", 18, 1_000_000n, owner.address);
    await rewardToken.waitForDeployment();

    return {
        owner,
        beneficiary,
        outsider,
        devToken,
        normalToken,
        dividend,
        rewardToken
    };
}

describe("dividend", function () {
    it("tracks stakes in the current cycle", async function () {
        const { owner, beneficiary, normalToken, dividend } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        expect(await dividend.getStakeAmount(0n)).to.equal(400n);
        expect(await dividend.connect(beneficiary).getStakeAmount(0n)).to.equal(200n);
        expect(await dividend.getTotalStaked(0n)).to.equal(600n);
        expect(await normalToken.balanceOf(owner.address)).to.equal(0n);
    });

    it("rejects invalid deposits, claims, and unstake amounts", async function () {
        const { beneficiary, normalToken, dividend, rewardToken, devToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await expect(dividend.stakeNormal(0)).to.be.revertedWith("Cannot stake 0 Token");

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await expect(
            dividend.deposit(10, await normalToken.getAddress())
        ).to.be.revertedWith("Cannot deposit dao normal token");
        await expect(
            dividend.deposit(10, await devToken.getAddress())
        ).to.be.revertedWith("Cannot deposit dao dev token");
        await expect(dividend.deposit(10, ethers.ZeroAddress)).to.be.revertedWith(
            "Use native transfer to deposit default token"
        );

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.deposit(400, await rewardToken.getAddress())).wait();

        await expect(
            dividend.withdrawDividends([1n], [await rewardToken.getAddress()])
        ).to.be.revertedWith("Cannot claim current or future cycle");

        await expect(dividend.connect(beneficiary).unstakeNormal(0)).to.be.revertedWith("Cannot unstake 0");
        await expect(dividend.connect(beneficiary).unstakeNormal(1)).to.be.revertedWith("No stake record found");
    });

    it("splits deposited rewards proportionally across stakers after a full cycle", async function () {
        const { owner, beneficiary, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        expect(await dividend.getCurrentCycleIndex()).to.equal(1n);

        await (await rewardToken.approve(await dividend.getAddress(), 600)).wait();
        await (await dividend.deposit(600, await rewardToken.getAddress())).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(600n);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends([1n], [await rewardToken.getAddress()]);
        expect(ownerEstimate[0].amount).to.equal(400n);
        expect(ownerEstimate[0].withdrawed).to.equal(false);

        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends([1n], [await rewardToken.getAddress()]);
        expect(beneficiaryEstimate[0].amount).to.equal(200n);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([1n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 400n);

        const beneficiaryRewardBefore = await rewardToken.balanceOf(beneficiary.address);
        await (await dividend.connect(beneficiary).withdrawDividends([1n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(beneficiary.address)).to.equal(beneficiaryRewardBefore + 200n);

        expect(await dividend.isDividendWithdrawed(1n, await rewardToken.getAddress())).to.equal(true);
        expect(await dividend.connect(beneficiary).isDividendWithdrawed(1n, await rewardToken.getAddress())).to.equal(true);
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
    });

    it("prevents duplicate claims after a dividend is withdrawn", async function () {
        const { beneficiary, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 600)).wait();
        await (await dividend.deposit(600, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.withdrawDividends([1n], [await rewardToken.getAddress()])).wait();
        await expect(
            dividend.withdrawDividends([1n], [await rewardToken.getAddress()])
        ).to.be.revertedWith("Already claimed");
    });
});