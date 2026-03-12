import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

async function getStakeRecordCount(dividendAddress: string, userAddress: string) {
    const slot = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [userAddress, 54n])
    );
    const raw = await ethers.provider.send("eth_getStorageAt", [dividendAddress, slot, "latest"]);
    return BigInt(raw);
}

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

    it("counts dev stakes together with normal stakes when splitting rewards", async function () {
        const { owner, beneficiary, normalToken, dividend, rewardToken, devToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await (await devToken.approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.stakeDev(100)).wait();

        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        expect(await dividend.getStakeAmount(0n)).to.equal(500n);
        expect(await dividend.connect(beneficiary).getStakeAmount(0n)).to.equal(200n);
        expect(await dividend.getTotalStaked(0n)).to.equal(700n);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 700)).wait();
        await (await dividend.deposit(700, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends([1n], [await rewardToken.getAddress()]);
        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends([1n], [await rewardToken.getAddress()]);

        expect(ownerEstimate).to.have.length(1);
        expect(ownerEstimate[0].amount).to.equal(500n);
        expect(beneficiaryEstimate).to.have.length(1);
        expect(beneficiaryEstimate[0].amount).to.equal(200n);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([1n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 500n);

        const beneficiaryRewardBefore = await rewardToken.balanceOf(beneficiary.address);
        await (await dividend.connect(beneficiary).withdrawDividends([1n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(beneficiary.address)).to.equal(beneficiaryRewardBefore + 200n);
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

    it("rejects invalid estimate and cycle-range queries", async function () {
        const { dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await expect(dividend.getCycleInfos(1n, 0n)).to.be.revertedWith("Invalid cycle range");
        await expect(dividend.getCycleInfos(0n, 1n)).to.be.revertedWith("Invalid cycle range");
        await expect(dividend.estimateDividends([], [await rewardToken.getAddress()])).to.be.revertedWith("No cycle index");
        await expect(dividend.estimateDividends([0n], [])).to.be.revertedWith("No token");
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

    it("syncs direct token and native transfers into cycle rewards through updateTokenBalance", async function () {
        const { beneficiary, normalToken, dividend, rewardToken, owner } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await rewardToken.transfer(await dividend.getAddress(), 90)).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 30n
        });

        await (await dividend.updateTokenBalance(await rewardToken.getAddress())).wait();
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(90n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(30n);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends([1n], [await rewardToken.getAddress(), ethers.ZeroAddress]);
        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends([1n], [await rewardToken.getAddress(), ethers.ZeroAddress]);

        expect(ownerEstimate).to.have.length(2);
        expect(ownerEstimate[0].amount).to.equal(60n);
        expect(ownerEstimate[1].amount).to.equal(20n);
        expect(beneficiaryEstimate).to.have.length(2);
        expect(beneficiaryEstimate[0].amount).to.equal(30n);
        expect(beneficiaryEstimate[1].amount).to.equal(10n);

        await (await dividend.withdrawDividends([1n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(30n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(10n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(10n);

        await (await dividend.connect(beneficiary).withdrawDividends([1n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(0n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(0n);
    });

    it("rejects syncing directly transferred dao normal and dev tokens as rewards", async function () {
        const { normalToken, devToken, dividend } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.transfer(await dividend.getAddress(), 50)).wait();
        await (await devToken.transfer(await dividend.getAddress(), 25)).wait();

        await expect(
            dividend.updateTokenBalance(await normalToken.getAddress())
        ).to.be.revertedWith("Cannot deposit dao normal token");

        await expect(
            dividend.updateTokenBalance(await devToken.getAddress())
        ).to.be.revertedWith("Cannot deposit dao dev token");

        expect(await dividend.getDepositTokenBalance(await normalToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(await devToken.getAddress())).to.equal(0n);
    });

    it("updates current-cycle totals when unstaking normal tokens from a previous cycle", async function () {
        const { owner, normalToken, dividend } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        expect(await dividend.getTotalStaked(1n)).to.equal(400n);

        const ownerBalanceBefore = await normalToken.balanceOf(owner.address);
        await (await dividend.unstakeNormal(150)).wait();

        expect(await dividend.getStakeAmount(1n)).to.equal(250n);
        expect(await dividend.getTotalStaked(1n)).to.equal(250n);
        expect(await normalToken.balanceOf(owner.address)).to.equal(ownerBalanceBefore + 150n);
    });

    it("updates current-cycle totals when unstaking dev tokens from a previous cycle", async function () {
        const { owner, devToken, dividend } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await devToken.approve(await dividend.getAddress(), 150)).wait();
        await (await dividend.stakeDev(150)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        expect(await dividend.getTotalStaked(1n)).to.equal(150n);

        const ownerBalanceBefore = await devToken.balanceOf(owner.address);
        await (await dividend.unstakeDev(50)).wait();

        expect(await dividend.getStakeAmount(1n)).to.equal(100n);
        expect(await dividend.getTotalStaked(1n)).to.equal(100n);
        expect(await devToken.balanceOf(owner.address)).to.equal(ownerBalanceBefore + 50n);
    });

    it("does not let a late normal stake change the previous cycle reward basis", async function () {
        const { owner, beneficiary, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.stakeNormal(300)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);

        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(100)).wait();

        await (await rewardToken.approve(await dividend.getAddress(), 500)).wait();
        await (await dividend.deposit(500, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends([1n], [await rewardToken.getAddress()]);
        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends([1n], [await rewardToken.getAddress()]);

        expect(ownerEstimate).to.have.length(1);
        expect(ownerEstimate[0].amount).to.equal(375n);
        expect(beneficiaryEstimate).to.have.length(1);
        expect(beneficiaryEstimate[0].amount).to.equal(125n);
    });

    it("does not let a late normal unstake change the previous cycle reward basis", async function () {
        const { owner, beneficiary, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.stakeNormal(300)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);

        await (await dividend.connect(beneficiary).unstakeNormal(100)).wait();

        await (await rewardToken.approve(await dividend.getAddress(), 500)).wait();
        await (await dividend.deposit(500, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends([1n], [await rewardToken.getAddress()]);
        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends([1n], [await rewardToken.getAddress()]);

        expect(ownerEstimate).to.have.length(1);
        expect(ownerEstimate[0].amount).to.equal(300n);
        expect(beneficiaryEstimate).to.have.length(1);
        expect(beneficiaryEstimate[0].amount).to.equal(200n);
    });

    it("does not let a late dev stake change the previous cycle reward basis", async function () {
        const { owner, beneficiary, normalToken, devToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await devToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.stakeDev(300)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);

        await (await devToken.approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.stakeDev(100)).wait();

        await (await rewardToken.approve(await dividend.getAddress(), 500)).wait();
        await (await dividend.deposit(500, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends([1n], [await rewardToken.getAddress()]);
        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends([1n], [await rewardToken.getAddress()]);

        expect(ownerEstimate).to.have.length(1);
        expect(ownerEstimate[0].amount).to.equal(375n);
        expect(beneficiaryEstimate).to.have.length(1);
        expect(beneficiaryEstimate[0].amount).to.equal(125n);
    });

    it("does not let a late dev unstake change the previous cycle reward basis", async function () {
        const { owner, beneficiary, normalToken, devToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await devToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.stakeDev(300)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);

        await (await dividend.unstakeDev(100)).wait();

        await (await rewardToken.approve(await dividend.getAddress(), 500)).wait();
        await (await dividend.deposit(500, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends([1n], [await rewardToken.getAddress()]);
        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends([1n], [await rewardToken.getAddress()]);

        expect(ownerEstimate).to.have.length(1);
        expect(ownerEstimate[0].amount).to.equal(300n);
        expect(beneficiaryEstimate).to.have.length(1);
        expect(beneficiaryEstimate[0].amount).to.equal(200n);
    });

    it("preserves normal stake when adding dev stake in a later cycle", async function () {
        const { devToken, normalToken, dividend } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.stakeNormal(300)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await devToken.approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.stakeDev(100)).wait();

        expect(await dividend.getStakeAmount(1n)).to.equal(400n);
    });

    it("preserves dev stake when adding normal stake in a later cycle", async function () {
        const { devToken, normalToken, dividend } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await devToken.approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.stakeDev(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await normalToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.stakeNormal(300)).wait();

        expect(await dividend.getStakeAmount(1n)).to.equal(400n);
    });

    it("aggregates repeated deposits of the same reward token within one cycle", async function () {
        const { owner, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await rewardToken.approve(await dividend.getAddress(), 500)).wait();
        await (await dividend.deposit(200, await rewardToken.getAddress())).wait();
        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();

        const currentCycle = await dividend.getCurrentCycle();
        expect(currentCycle.rewards).to.have.length(1);
        expect(currentCycle.rewards[0].token).to.equal(await rewardToken.getAddress());
        expect(currentCycle.rewards[0].amount).to.equal(500n);
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(500n);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends([1n], [await rewardToken.getAddress()]);
        expect(ownerEstimate).to.have.length(1);
        expect(ownerEstimate[0].amount).to.equal(500n);
    });

    it("carries rewards across empty cycles until a later staked cycle can claim them", async function () {
        const { owner, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        expect(await dividend.getCurrentCycleIndex()).to.equal(1n);

        await (await rewardToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        expect(await dividend.getCurrentCycleIndex()).to.equal(2n);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        expect(await dividend.getCurrentCycleIndex()).to.equal(3n);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        expect(await dividend.getCurrentCycleIndex()).to.equal(4n);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        expect(await dividend.getCurrentCycleIndex()).to.equal(5n);

        const ownerEstimate = await dividend.estimateDividends([1n, 2n, 3n, 4n], [await rewardToken.getAddress()]);
        expect(ownerEstimate).to.have.length(1);
        expect(ownerEstimate[0].amount).to.equal(300n);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([1n, 2n, 3n, 4n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 300n);
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
    });

    it("keeps carried rewards unclaimable during zero-stake cycles", async function () {
        const { outsider, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 180)).wait();
        await (await dividend.deposit(180, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const zeroStakeEstimate = await dividend.connect(outsider).estimateDividends([1n], [await rewardToken.getAddress()]);
        expect(zeroStakeEstimate).to.have.length(0);

        await (await dividend.connect(outsider).withdrawDividends([1n], [await rewardToken.getAddress()])).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(180n);
    });

    it("preserves a single carried reward amount instead of duplicating it across empty cycles", async function () {
        const { owner, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 240)).wait();
        await (await dividend.deposit(240, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const cycleInfos = await dividend.getCycleInfos(1n, 5n);
        expect(cycleInfos[0].rewards[0].amount).to.equal(240n);
        expect(cycleInfos[1].rewards[0].amount).to.equal(240n);
        expect(cycleInfos[2].rewards[0].amount).to.equal(240n);
        expect(cycleInfos[3].rewards[0].amount).to.equal(240n);
        expect(cycleInfos[4].rewards).to.have.length(0);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([4n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 240n);
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
    });

    it("keeps partial multi-cycle multi-token claims isolated", async function () {
        const { owner, beneficiary, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await rewardToken.approve(await dividend.getAddress(), 900)).wait();
        await (await dividend.deposit(600, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 300n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 150n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerInitialEstimate = await dividend.estimateDividends(
            [1n, 2n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(ownerInitialEstimate).to.have.length(4);
        expect(ownerInitialEstimate[0].amount).to.equal(400n);
        expect(ownerInitialEstimate[0].withdrawed).to.equal(false);
        expect(ownerInitialEstimate[1].amount).to.equal(200n);
        expect(ownerInitialEstimate[1].withdrawed).to.equal(false);
        expect(ownerInitialEstimate[2].amount).to.equal(200n);
        expect(ownerInitialEstimate[2].withdrawed).to.equal(false);
        expect(ownerInitialEstimate[3].amount).to.equal(100n);
        expect(ownerInitialEstimate[3].withdrawed).to.equal(false);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([1n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 400n);
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(500n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(450n);

        const ownerAfterPartialClaim = await dividend.estimateDividends(
            [1n, 2n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(ownerAfterPartialClaim).to.have.length(4);
        expect(ownerAfterPartialClaim[0].amount).to.equal(400n);
        expect(ownerAfterPartialClaim[0].withdrawed).to.equal(true);
        expect(ownerAfterPartialClaim[1].amount).to.equal(200n);
        expect(ownerAfterPartialClaim[1].withdrawed).to.equal(false);
        expect(ownerAfterPartialClaim[2].amount).to.equal(200n);
        expect(ownerAfterPartialClaim[2].withdrawed).to.equal(false);
        expect(ownerAfterPartialClaim[3].amount).to.equal(100n);
        expect(ownerAfterPartialClaim[3].withdrawed).to.equal(false);

        await (await dividend.withdrawDividends([1n, 2n], [ethers.ZeroAddress])).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(500n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(150n);

        await (await dividend.withdrawDividends([2n], [await rewardToken.getAddress()])).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(300n);

        await (await dividend.connect(beneficiary).withdrawDividends(
            [1n, 2n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        )).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(0n);
    });

    it("adds new rewards onto a carried balance once staking resumes without duplicating old carry-over", async function () {
        const { owner, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await rewardToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.deposit(180, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.deposit(220, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 60n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends(
            [1n, 2n, 3n, 4n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(ownerEstimate).to.have.length(2);
        expect(ownerEstimate[0].amount).to.equal(400n);
        expect(ownerEstimate[0].withdrawed).to.equal(false);
        expect(ownerEstimate[1].amount).to.equal(60n);
        expect(ownerEstimate[1].withdrawed).to.equal(false);

        const cycleInfos = await dividend.getCycleInfos(1n, 5n);
        expect(cycleInfos[0].rewards[0].amount).to.equal(180n);
        expect(cycleInfos[1].rewards[0].amount).to.equal(180n);
        expect(cycleInfos[2].rewards[0].amount).to.equal(180n);
        expect(cycleInfos[3].rewards[0].amount).to.equal(400n);
        expect(cycleInfos[3].rewards[1].token).to.equal(ethers.ZeroAddress);
        expect(cycleInfos[3].rewards[1].amount).to.equal(60n);
        expect(cycleInfos[4].rewards).to.have.length(0);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([1n, 2n, 3n, 4n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 400n);
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(0n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(0n);
    });

    it("recalculates user reward shares correctly after stake mixes change across consecutive cycles", async function () {
        const { owner, beneficiary, normalToken, devToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.stakeNormal(200)).wait();
        await (await devToken.approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.stakeDev(100)).wait();

        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await rewardToken.approve(await dividend.getAddress(), 850)).wait();
        await (await dividend.deposit(400, await rewardToken.getAddress())).wait();

        await (await dividend.unstakeDev(50)).wait();
        await (await normalToken.transfer(beneficiary.address, 100)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.deposit(450, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 90n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends(
            [1n, 2n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(ownerEstimate).to.have.length(3);
        expect(ownerEstimate[0].amount).to.equal(300n);
        expect(ownerEstimate[1].amount).to.equal(250n);
        expect(ownerEstimate[2].amount).to.equal(50n);

        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends(
            [1n, 2n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(beneficiaryEstimate).to.have.length(3);
        expect(beneficiaryEstimate[0].amount).to.equal(100n);
        expect(beneficiaryEstimate[1].amount).to.equal(200n);
        expect(beneficiaryEstimate[2].amount).to.equal(40n);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([1n, 2n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 550n);

        const beneficiaryRewardBefore = await rewardToken.balanceOf(beneficiary.address);
        await (await dividend.connect(beneficiary).withdrawDividends(
            [1n, 2n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        )).wait();
        expect(await rewardToken.balanceOf(beneficiary.address)).to.equal(beneficiaryRewardBefore + 300n);

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(0n);
    });

    it("keeps earlier carried rewards with the resumed staker and only shares later rewards with late entrants", async function () {
        const { owner, beneficiary, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 800)).wait();
        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await normalToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.stakeNormal(300)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.deposit(500, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends([4n, 5n], [await rewardToken.getAddress()]);
        expect(ownerEstimate).to.have.length(2);
        expect(ownerEstimate[0].amount).to.equal(300n);
        expect(ownerEstimate[1].amount).to.equal(300n);

        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends([4n, 5n], [await rewardToken.getAddress()]);
        expect(beneficiaryEstimate).to.have.length(1);
        expect(beneficiaryEstimate[0].amount).to.equal(200n);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([4n, 5n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 600n);

        const beneficiaryRewardBefore = await rewardToken.balanceOf(beneficiary.address);
        await (await dividend.connect(beneficiary).withdrawDividends([4n, 5n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(beneficiary.address)).to.equal(beneficiaryRewardBefore + 200n);

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
    });

    it("does not grant skipped empty-cycle rewards until a full re-entry cycle becomes eligible", async function () {
        const { owner, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        const dividendAddress = await dividend.getAddress();
        await (await normalToken.approve(dividendAddress, 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.unstakeNormal(400)).wait();
        expect(await dividend.getStakeAmount(1n)).to.equal(0n);
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(2n);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(dividendAddress, 300)).wait();
        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const beforeReentryEstimate = await dividend.estimateDividends([2n], [await rewardToken.getAddress()]);
        expect(beforeReentryEstimate).to.have.length(0);

        await (await normalToken.approve(dividendAddress, 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(3n);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const afterReentryEstimate = await dividend.estimateDividends([2n, 3n, 4n], [await rewardToken.getAddress()]);
        expect(afterReentryEstimate).to.have.length(1);
        expect(afterReentryEstimate[0].amount).to.equal(300n);
        expect(afterReentryEstimate[0].withdrawed).to.equal(false);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([2n, 3n, 4n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 300n);
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
    });

    it("keeps cross-user cross-token claim states isolated under opposite withdrawal orders", async function () {
        const { owner, beneficiary, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await rewardToken.approve(await dividend.getAddress(), 900)).wait();
        await (await dividend.deposit(600, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 300n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 150n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.connect(beneficiary).withdrawDividends([1n, 2n], [ethers.ZeroAddress])).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(900n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(300n);

        const beneficiaryAfterNativeClaim = await dividend.connect(beneficiary).estimateDividends(
            [1n, 2n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(beneficiaryAfterNativeClaim).to.have.length(4);
        expect(beneficiaryAfterNativeClaim[0].amount).to.equal(200n);
        expect(beneficiaryAfterNativeClaim[0].withdrawed).to.equal(false);
        expect(beneficiaryAfterNativeClaim[1].amount).to.equal(100n);
        expect(beneficiaryAfterNativeClaim[1].withdrawed).to.equal(true);
        expect(beneficiaryAfterNativeClaim[2].amount).to.equal(100n);
        expect(beneficiaryAfterNativeClaim[2].withdrawed).to.equal(false);
        expect(beneficiaryAfterNativeClaim[3].amount).to.equal(50n);
        expect(beneficiaryAfterNativeClaim[3].withdrawed).to.equal(true);

        await (await dividend.withdrawDividends([1n, 2n], [await rewardToken.getAddress()])).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(300n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(300n);

        const ownerAfterTokenClaim = await dividend.estimateDividends(
            [1n, 2n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(ownerAfterTokenClaim).to.have.length(4);
        expect(ownerAfterTokenClaim[0].amount).to.equal(400n);
        expect(ownerAfterTokenClaim[0].withdrawed).to.equal(true);
        expect(ownerAfterTokenClaim[1].amount).to.equal(200n);
        expect(ownerAfterTokenClaim[1].withdrawed).to.equal(false);
        expect(ownerAfterTokenClaim[2].amount).to.equal(200n);
        expect(ownerAfterTokenClaim[2].withdrawed).to.equal(true);
        expect(ownerAfterTokenClaim[3].amount).to.equal(100n);
        expect(ownerAfterTokenClaim[3].withdrawed).to.equal(false);

        await (await dividend.connect(beneficiary).withdrawDividends([1n, 2n], [await rewardToken.getAddress()])).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(300n);

        await (await dividend.withdrawDividends([1n, 2n], [ethers.ZeroAddress])).wait();
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(0n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(0n);
    });

    it("handles repeated full exit and re-entry waves without reviving zero-stake eligibility early", async function () {
        const { owner, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        const dividendAddress = await dividend.getAddress();
        await (await normalToken.approve(dividendAddress, 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.unstakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(dividendAddress, 500)).wait();
        await (await dividend.deposit(200, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await normalToken.approve(dividendAddress, 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.unstakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        const firstWaveEstimate = await dividend.estimateDividends([2n, 3n, 4n], [await rewardToken.getAddress()]);
        expect(firstWaveEstimate).to.have.length(1);
        expect(firstWaveEstimate[0].amount).to.equal(200n);

        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        const betweenWavesEstimate = await dividend.estimateDividends([2n, 3n, 4n, 5n], [await rewardToken.getAddress()]);
        expect(betweenWavesEstimate).to.have.length(1);
        expect(betweenWavesEstimate[0].amount).to.equal(200n);

        await (await normalToken.approve(dividendAddress, 400)).wait();
        await (await dividend.stakeNormal(400)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const secondWaveEstimate = await dividend.estimateDividends([2n, 3n, 4n, 5n, 6n, 7n], [await rewardToken.getAddress()]);
        expect(secondWaveEstimate).to.have.length(2);
        expect(secondWaveEstimate[0].amount).to.equal(200n);
        expect(secondWaveEstimate[1].amount).to.equal(300n);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([2n, 3n, 4n, 5n, 6n, 7n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 500n);
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
    });

    it("keeps per-user shares correct when one staker exits and re-enters while another remains active", async function () {
        const { owner, beneficiary, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 1_300)).wait();
        await (await dividend.deposit(600, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 300n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await dividend.connect(beneficiary).unstakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(400, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 200n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 150n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(ownerEstimate).to.have.length(6);
        expect(ownerEstimate[0].amount).to.equal(400n);
        expect(ownerEstimate[1].amount).to.equal(200n);
        expect(ownerEstimate[2].amount).to.equal(400n);
        expect(ownerEstimate[3].amount).to.equal(200n);
        expect(ownerEstimate[4].amount).to.equal(200n);
        expect(ownerEstimate[5].amount).to.equal(100n);

        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(beneficiaryEstimate).to.have.length(4);
        expect(beneficiaryEstimate[0].amount).to.equal(200n);
        expect(beneficiaryEstimate[1].amount).to.equal(100n);
        expect(beneficiaryEstimate[2].amount).to.equal(100n);
        expect(beneficiaryEstimate[3].amount).to.equal(50n);

        await (await dividend.connect(beneficiary).withdrawDividends([1n, 2n, 3n], [ethers.ZeroAddress])).wait();
        await (await dividend.withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress()])).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(300n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(500n);

        await (await dividend.connect(beneficiary).withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress()])).wait();
        await (await dividend.withdrawDividends([1n, 2n, 3n], [ethers.ZeroAddress])).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(0n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(0n);
    });

    it("keeps mixed normal and dev re-entry waves isolated across zero-stake carry-over cycles", async function () {
        const { owner, normalToken, devToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.stakeNormal(200)).wait();
        await (await devToken.approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.stakeDev(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 940)).wait();
        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 150n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await dividend.unstakeNormal(200)).wait();
        await (await dividend.unstakeDev(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(240, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 120n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const beforeReentryEstimate = await dividend.estimateDividends(
            [1n, 2n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(beforeReentryEstimate).to.have.length(2);
        expect(beforeReentryEstimate[0].amount).to.equal(300n);
        expect(beforeReentryEstimate[1].amount).to.equal(150n);

        await (await devToken.approve(await dividend.getAddress(), 50)).wait();
        await (await dividend.stakeDev(50)).wait();
        await (await normalToken.approve(await dividend.getAddress(), 150)).wait();
        await (await dividend.stakeNormal(150)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(400, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 200n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const afterReentryEstimate = await dividend.estimateDividends(
            [1n, 2n, 3n, 4n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(afterReentryEstimate).to.have.length(4);
        expect(afterReentryEstimate[0].amount).to.equal(300n);
        expect(afterReentryEstimate[1].amount).to.equal(150n);
        expect(afterReentryEstimate[2].amount).to.equal(640n);
        expect(afterReentryEstimate[3].amount).to.equal(320n);

        await (await dividend.withdrawDividends([1n, 2n, 3n, 4n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(0n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(0n);
    });

    it("keeps late third-user entry from sharing rewards that belonged only to earlier active stakers", async function () {
        const { owner, beneficiary, outsider, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 1_600)).wait();
        await (await dividend.deposit(600, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 300n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await dividend.connect(beneficiary).unstakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(400, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 200n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await normalToken.connect(beneficiary).transfer(outsider.address, 100)).wait();
        await (await normalToken.connect(outsider).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(outsider).stakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(500, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 250n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(ownerEstimate).to.have.length(6);
        expect(ownerEstimate[0].amount).to.equal(400n);
        expect(ownerEstimate[1].amount).to.equal(200n);
        expect(ownerEstimate[2].amount).to.equal(400n);
        expect(ownerEstimate[3].amount).to.equal(200n);
        expect(ownerEstimate[4].amount).to.equal(400n);
        expect(ownerEstimate[5].amount).to.equal(200n);

        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(beneficiaryEstimate).to.have.length(2);
        expect(beneficiaryEstimate[0].amount).to.equal(200n);
        expect(beneficiaryEstimate[1].amount).to.equal(100n);

        const outsiderEstimate = await dividend.connect(outsider).estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(outsiderEstimate).to.have.length(2);
        expect(outsiderEstimate[0].amount).to.equal(100n);
        expect(outsiderEstimate[1].amount).to.equal(50n);

        await (await dividend.connect(outsider).withdrawDividends([1n, 2n, 3n], [ethers.ZeroAddress])).wait();
        await (await dividend.withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress()])).wait();
        await (await dividend.connect(beneficiary).withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(100n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(600n);

        await (await dividend.withdrawDividends([1n, 2n, 3n], [ethers.ZeroAddress])).wait();
        await (await dividend.connect(outsider).withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress()])).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(0n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(0n);
    });

    it("preserves later mixed-cycle eligibility after partially claiming an earlier cycle", async function () {
        const { owner, normalToken, devToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 350)).wait();
        await (await dividend.stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 900)).wait();
        await (await dividend.deposit(200, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 100n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await devToken.approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.stakeDev(100)).wait();
        await (await dividend.unstakeNormal(50)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 150n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await dividend.withdrawDividends([1n], [await rewardToken.getAddress()])).wait();
        expect(await dividend.isDividendWithdrawed(1n, await rewardToken.getAddress())).to.equal(true);
        expect(await dividend.isDividendWithdrawed(1n, ethers.ZeroAddress)).to.equal(false);

        await (await dividend.unstakeDev(100)).wait();
        await (await dividend.stakeNormal(150)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(400, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 200n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const estimate = await dividend.estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(estimate).to.have.length(6);
        expect(estimate[0].amount).to.equal(200n);
        expect(estimate[0].withdrawed).to.equal(true);
        expect(estimate[1].amount).to.equal(100n);
        expect(estimate[1].withdrawed).to.equal(false);
        expect(estimate[2].amount).to.equal(300n);
        expect(estimate[2].withdrawed).to.equal(false);
        expect(estimate[3].amount).to.equal(150n);
        expect(estimate[3].withdrawed).to.equal(false);
        expect(estimate[4].amount).to.equal(400n);
        expect(estimate[4].withdrawed).to.equal(false);
        expect(estimate[5].amount).to.equal(200n);
        expect(estimate[5].withdrawed).to.equal(false);

        await (await dividend.withdrawDividends([1n, 2n, 3n], [ethers.ZeroAddress])).wait();
        await (await dividend.withdrawDividends([2n, 3n], [await rewardToken.getAddress()])).wait();
        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(0n);
    });

    it("keeps old-cycle payouts and partial claim flags stable when a third user joins after earlier partial withdrawals", async function () {
        const { owner, beneficiary, outsider, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.stakeNormal(300)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 1_300)).wait();
        await (await dividend.deposit(500, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 250n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.withdrawDividends([1n], [ethers.ZeroAddress])).wait();
        expect(await dividend.isDividendWithdrawed(1n, ethers.ZeroAddress)).to.equal(true);
        expect(await dividend.isDividendWithdrawed(1n, await rewardToken.getAddress())).to.equal(false);

        await (await dividend.deposit(400, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 200n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await normalToken.transfer(outsider.address, 100)).wait();
        await (await normalToken.connect(outsider).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(outsider).stakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(400, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 200n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(ownerEstimate).to.have.length(6);
        expect(ownerEstimate[0].amount).to.equal(300n);
        expect(ownerEstimate[0].withdrawed).to.equal(false);
        expect(ownerEstimate[1].amount).to.equal(150n);
        expect(ownerEstimate[1].withdrawed).to.equal(true);
        expect(ownerEstimate[2].amount).to.equal(240n);
        expect(ownerEstimate[2].withdrawed).to.equal(false);
        expect(ownerEstimate[3].amount).to.equal(120n);
        expect(ownerEstimate[3].withdrawed).to.equal(false);
        expect(ownerEstimate[4].amount).to.equal(200n);
        expect(ownerEstimate[4].withdrawed).to.equal(false);
        expect(ownerEstimate[5].amount).to.equal(100n);
        expect(ownerEstimate[5].withdrawed).to.equal(false);

        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(beneficiaryEstimate).to.have.length(6);
        expect(beneficiaryEstimate[0].amount).to.equal(200n);
        expect(beneficiaryEstimate[0].withdrawed).to.equal(false);
        expect(beneficiaryEstimate[1].amount).to.equal(100n);
        expect(beneficiaryEstimate[1].withdrawed).to.equal(false);
        expect(beneficiaryEstimate[2].amount).to.equal(160n);
        expect(beneficiaryEstimate[2].withdrawed).to.equal(false);
        expect(beneficiaryEstimate[3].amount).to.equal(80n);
        expect(beneficiaryEstimate[3].withdrawed).to.equal(false);
        expect(beneficiaryEstimate[4].amount).to.equal(133n);
        expect(beneficiaryEstimate[5].amount).to.equal(66n);

        const outsiderEstimate = await dividend.connect(outsider).estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(outsiderEstimate).to.have.length(2);
        expect(outsiderEstimate[0].amount).to.equal(66n);
        expect(outsiderEstimate[1].amount).to.equal(33n);

        await (await dividend.connect(beneficiary).withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        await (await dividend.withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress()])).wait();
        await (await dividend.connect(outsider).withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        await (await dividend.withdrawDividends([2n, 3n], [ethers.ZeroAddress])).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(1n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(1n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(1n);
    });

    it("keeps multi-cycle mixed-user claim states correct across partial claims full exits and later re-entry", async function () {
        const { owner, beneficiary, outsider, normalToken, devToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.transfer(outsider.address, 100)).wait();

        await (await normalToken.approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.stakeNormal(200)).wait();
        await (await devToken.approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.stakeDev(100)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();
        await (await normalToken.connect(outsider).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(outsider).stakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 1_350)).wait();
        await (await dividend.deposit(600, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 300n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await dividend.connect(beneficiary).unstakeNormal(100)).wait();
        await (await dividend.unstakeDev(50)).wait();
        await (await dividend.connect(outsider).unstakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(350, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 175n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await dividend.withdrawDividends([1n], [ethers.ZeroAddress])).wait();
        expect(await dividend.isDividendWithdrawed(1n, ethers.ZeroAddress)).to.equal(true);
        expect(await dividend.isDividendWithdrawed(1n, await rewardToken.getAddress())).to.equal(false);

        await (await normalToken.connect(outsider).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(outsider).stakeNormal(100)).wait();
        await (await devToken.approve(await dividend.getAddress(), 50)).wait();
        await (await dividend.stakeDev(50)).wait();
        await (await dividend.connect(beneficiary).unstakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(400, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 200n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(ownerEstimate).to.have.length(6);
        expect(ownerEstimate[0].amount).to.equal(300n);
        expect(ownerEstimate[0].withdrawed).to.equal(false);
        expect(ownerEstimate[1].amount).to.equal(150n);
        expect(ownerEstimate[1].withdrawed).to.equal(true);
        expect(ownerEstimate[2].amount).to.equal(250n);
        expect(ownerEstimate[2].withdrawed).to.equal(false);
        expect(ownerEstimate[3].amount).to.equal(125n);
        expect(ownerEstimate[3].withdrawed).to.equal(false);
        expect(ownerEstimate[4].amount).to.equal(300n);
        expect(ownerEstimate[5].amount).to.equal(150n);

        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(beneficiaryEstimate).to.have.length(4);
        expect(beneficiaryEstimate[0].amount).to.equal(200n);
        expect(beneficiaryEstimate[1].amount).to.equal(100n);
        expect(beneficiaryEstimate[2].amount).to.equal(100n);
        expect(beneficiaryEstimate[3].amount).to.equal(50n);

        const outsiderEstimate = await dividend.connect(outsider).estimateDividends(
            [1n, 2n, 3n],
            [await rewardToken.getAddress(), ethers.ZeroAddress]
        );
        expect(outsiderEstimate).to.have.length(4);
        expect(outsiderEstimate[0].amount).to.equal(100n);
        expect(outsiderEstimate[1].amount).to.equal(50n);
        expect(outsiderEstimate[2].amount).to.equal(100n);
        expect(outsiderEstimate[3].amount).to.equal(50n);

        await (await dividend.connect(beneficiary).withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        await (await dividend.connect(outsider).withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        await (await dividend.withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress()])).wait();
        await (await dividend.withdrawDividends([2n, 3n], [ethers.ZeroAddress])).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(0n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(0n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(0n);
    });

    it("keeps per-token rounding remainders stable under staggered partial withdrawals", async function () {
        const { owner, beneficiary, outsider, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.transfer(outsider.address, 100)).wait();

        await (await normalToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.stakeNormal(300)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();
        await (await normalToken.connect(outsider).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(outsider).stakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 500)).wait();
        await (await dividend.deposit(500, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({
            to: await dividend.getAddress(),
            value: 250n
        });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.connect(beneficiary).withdrawDividends([1n], [ethers.ZeroAddress])).wait();
        await (await dividend.withdrawDividends([1n], [await rewardToken.getAddress()])).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(250n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(167n);

        await (await dividend.connect(outsider).withdrawDividends([1n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        await (await dividend.connect(beneficiary).withdrawDividends([1n], [await rewardToken.getAddress()])).wait();
        await (await dividend.withdrawDividends([1n], [ethers.ZeroAddress])).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(1n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(1n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(1n);
    });

    it("keeps four-user mixed stake transitions isolated across three reward cycles", async function () {
        const { owner, beneficiary, outsider, normalToken, devToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);
        const [, , , fourth] = await ethers.getSigners();

        await (await normalToken.transfer(outsider.address, 150)).wait();
        await (await normalToken.transfer(fourth.address, 50)).wait();

        await (await normalToken.approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.stakeNormal(200)).wait();
        await (await devToken.approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.stakeDev(100)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();
        await (await normalToken.connect(outsider).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(outsider).stakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 1_600)).wait();
        await (await dividend.deposit(600, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({ to: await dividend.getAddress(), value: 300n });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await dividend.unstakeDev(50)).wait();
        await (await dividend.connect(beneficiary).unstakeNormal(100)).wait();
        await (await normalToken.connect(outsider).approve(await dividend.getAddress(), 50)).wait();
        await (await dividend.connect(outsider).stakeNormal(50)).wait();
        await (await normalToken.connect(fourth).approve(await dividend.getAddress(), 50)).wait();
        await (await dividend.connect(fourth).stakeNormal(50)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(450, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({ to: await dividend.getAddress(), value: 225n });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await (await dividend.connect(outsider).withdrawDividends([1n], [ethers.ZeroAddress])).wait();
        await (await dividend.withdrawDividends([1n], [await rewardToken.getAddress()])).wait();

        await (await dividend.connect(beneficiary).unstakeNormal(100)).wait();
        await (await devToken.approve(await dividend.getAddress(), 50)).wait();
        await (await dividend.stakeDev(50)).wait();
        await (await dividend.connect(fourth).unstakeNormal(50)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(500, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({ to: await dividend.getAddress(), value: 250n });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const ownerEstimate = await dividend.estimateDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress]);
        expect(ownerEstimate).to.have.length(6);
        expect(ownerEstimate[0].amount).to.equal(300n);
        expect(ownerEstimate[0].withdrawed).to.equal(true);
        expect(ownerEstimate[1].amount).to.equal(150n);
        expect(ownerEstimate[1].withdrawed).to.equal(false);
        expect(ownerEstimate[2].amount).to.equal(204n);
        expect(ownerEstimate[2].withdrawed).to.equal(false);
        expect(ownerEstimate[3].amount).to.equal(102n);
        expect(ownerEstimate[4].amount).to.equal(333n);
        expect(ownerEstimate[5].amount).to.equal(166n);

        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress]);
        expect(beneficiaryEstimate).to.have.length(4);
        expect(beneficiaryEstimate[0].amount).to.equal(200n);
        expect(beneficiaryEstimate[1].amount).to.equal(100n);
        expect(beneficiaryEstimate[2].amount).to.equal(81n);
        expect(beneficiaryEstimate[3].amount).to.equal(40n);

        const outsiderEstimate = await dividend.connect(outsider).estimateDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress]);
        expect(outsiderEstimate).to.have.length(6);
        expect(outsiderEstimate[0].amount).to.equal(100n);
        expect(outsiderEstimate[1].amount).to.equal(50n);
        expect(outsiderEstimate[2].amount).to.equal(122n);
        expect(outsiderEstimate[3].amount).to.equal(61n);
        expect(outsiderEstimate[4].amount).to.equal(166n);
        expect(outsiderEstimate[5].amount).to.equal(83n);

        const fourthEstimate = await dividend.connect(fourth).estimateDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress]);
        expect(fourthEstimate).to.have.length(2);
        expect(fourthEstimate[0].amount).to.equal(40n);
        expect(fourthEstimate[1].amount).to.equal(20n);

        await (await dividend.connect(beneficiary).withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        await (await dividend.connect(outsider).withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress()])).wait();
        await (await dividend.connect(fourth).withdrawDividends([1n, 2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        await (await dividend.withdrawDividends([1n], [ethers.ZeroAddress])).wait();
        await (await dividend.withdrawDividends([2n, 3n], [await rewardToken.getAddress(), ethers.ZeroAddress])).wait();
        await (await dividend.connect(outsider).withdrawDividends([2n, 3n], [ethers.ZeroAddress])).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(4n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(3n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(3n);
    });

    it("keeps claim isolation when users alternate token-only and native-only withdrawals across multiple cycles", async function () {
        const { owner, beneficiary, outsider, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.transfer(outsider.address, 100)).wait();

        await (await normalToken.approve(await dividend.getAddress(), 300)).wait();
        await (await dividend.stakeNormal(300)).wait();
        await (await normalToken.connect(beneficiary).approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.connect(beneficiary).stakeNormal(200)).wait();
        await (await normalToken.connect(outsider).approve(await dividend.getAddress(), 100)).wait();
        await (await dividend.connect(outsider).stakeNormal(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 1_100)).wait();
        await (await dividend.deposit(500, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({ to: await dividend.getAddress(), value: 250n });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await dividend.deposit(600, await rewardToken.getAddress())).wait();
        await owner.sendTransaction({ to: await dividend.getAddress(), value: 300n });
        await (await dividend.updateTokenBalance(ethers.ZeroAddress)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.withdrawDividends([1n, 2n], [await rewardToken.getAddress()])).wait();
        await (await dividend.connect(beneficiary).withdrawDividends([1n], [ethers.ZeroAddress])).wait();
        await (await dividend.connect(outsider).withdrawDividends([2n], [ethers.ZeroAddress])).wait();

        const ownerEstimate = await dividend.estimateDividends([1n, 2n], [await rewardToken.getAddress(), ethers.ZeroAddress]);
        expect(ownerEstimate).to.have.length(4);
        expect(ownerEstimate[0].withdrawed).to.equal(true);
        expect(ownerEstimate[1].withdrawed).to.equal(false);
        expect(ownerEstimate[2].withdrawed).to.equal(true);
        expect(ownerEstimate[3].withdrawed).to.equal(false);

        const beneficiaryEstimate = await dividend.connect(beneficiary).estimateDividends([1n, 2n], [await rewardToken.getAddress(), ethers.ZeroAddress]);
        expect(beneficiaryEstimate).to.have.length(4);
        expect(beneficiaryEstimate[0].withdrawed).to.equal(false);
        expect(beneficiaryEstimate[1].withdrawed).to.equal(true);
        expect(beneficiaryEstimate[2].withdrawed).to.equal(false);
        expect(beneficiaryEstimate[3].withdrawed).to.equal(false);

        const outsiderEstimate = await dividend.connect(outsider).estimateDividends([1n, 2n], [await rewardToken.getAddress(), ethers.ZeroAddress]);
        expect(outsiderEstimate).to.have.length(4);
        expect(outsiderEstimate[0].withdrawed).to.equal(false);
        expect(outsiderEstimate[1].withdrawed).to.equal(false);
        expect(outsiderEstimate[2].withdrawed).to.equal(false);
        expect(outsiderEstimate[3].withdrawed).to.equal(true);

        await (await dividend.connect(beneficiary).withdrawDividends([1n, 2n], [await rewardToken.getAddress()])).wait();
        await (await dividend.withdrawDividends([1n, 2n], [ethers.ZeroAddress])).wait();
        await (await dividend.connect(outsider).withdrawDividends([1n, 2n], [await rewardToken.getAddress()])).wait();
        await (await dividend.connect(beneficiary).withdrawDividends([2n], [ethers.ZeroAddress])).wait();
        await (await dividend.connect(outsider).withdrawDividends([1n], [ethers.ZeroAddress])).wait();

        expect(await dividend.getDepositTokenBalance(await rewardToken.getAddress())).to.equal(1n);
        expect(await dividend.getDepositTokenBalance(ethers.ZeroAddress)).to.equal(1n);
        expect(await ethers.provider.getBalance(await dividend.getAddress())).to.equal(1n);
    });

    it("pops a redundant current-cycle checkpoint when a normal stake round-trips back to the previous balance", async function () {
        const { owner, normalToken, dividend } = await networkHelpers.loadFixture(deployDividendFixture);

        const dividendAddress = await dividend.getAddress();
        await (await normalToken.approve(dividendAddress, 500)).wait();
        await (await dividend.stakeNormal(300)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(1n);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.stakeNormal(100)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(2n);

        await (await dividend.unstakeNormal(100)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(1n);
        expect(await dividend.getStakeAmount(1n)).to.equal(300n);
    });

    it("preserves an earlier cycle reward after a later normal checkpoint is compacted", async function () {
        const { owner, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        const dividendAddress = await dividend.getAddress();
        await (await normalToken.approve(dividendAddress, 600)).wait();
        await (await dividend.stakeNormal(300)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(dividendAddress, 300)).wait();
        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.stakeNormal(100)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(2n);

        await (await dividend.unstakeNormal(100)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(1n);

        const ownerEstimate = await dividend.estimateDividends([1n], [await rewardToken.getAddress()]);
        expect(ownerEstimate).to.have.length(1);
        expect(ownerEstimate[0].amount).to.equal(300n);

        const ownerRewardBefore = await rewardToken.balanceOf(owner.address);
        await (await dividend.withdrawDividends([1n], [await rewardToken.getAddress()])).wait();
        expect(await rewardToken.balanceOf(owner.address)).to.equal(ownerRewardBefore + 300n);
    });

    it("preserves an earlier cycle reward after a later mixed-balance dev checkpoint is compacted", async function () {
        const { owner, devToken, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        const dividendAddress = await dividend.getAddress();
        await (await normalToken.approve(dividendAddress, 400)).wait();
        await (await dividend.stakeNormal(200)).wait();
        await (await devToken.approve(dividendAddress, 200)).wait();
        await (await dividend.stakeDev(100)).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(dividendAddress, 300)).wait();
        await (await dividend.deposit(300, await rewardToken.getAddress())).wait();

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.stakeDev(50)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(2n);

        await (await dividend.unstakeDev(50)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(1n);
        expect(await dividend.getStakeAmount(2n)).to.equal(300n);

        const ownerEstimate = await dividend.estimateDividends([1n], [await rewardToken.getAddress()]);
        expect(ownerEstimate).to.have.length(1);
        expect(ownerEstimate[0].amount).to.equal(300n);
    });

    it("keeps a current-cycle checkpoint when a rollback only partially restores the previous balance", async function () {
        const { owner, normalToken, dividend } = await networkHelpers.loadFixture(deployDividendFixture);

        const dividendAddress = await dividend.getAddress();
        await (await normalToken.approve(dividendAddress, 400)).wait();
        await (await dividend.stakeNormal(300)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(1n);

        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await (await dividend.stakeNormal(100)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(2n);

        await (await dividend.unstakeNormal(50)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(2n);
        expect(await dividend.getStakeAmount(1n)).to.equal(350n);
        expect(await dividend.getTotalStaked(1n)).to.equal(350n);
    });

    it("pops the only checkpoint when same-cycle dev stake fully round-trips to zero", async function () {
        const { owner, devToken, dividend } = await networkHelpers.loadFixture(deployDividendFixture);

        const dividendAddress = await dividend.getAddress();
        await (await devToken.approve(dividendAddress, 100)).wait();
        await (await dividend.stakeDev(100)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(1n);

        await (await dividend.unstakeDev(100)).wait();
        expect(await getStakeRecordCount(dividendAddress, owner.address)).to.equal(0n);
        expect(await dividend.getStakeAmount(0n)).to.equal(0n);
    });

    it("rejects future stake lookups and returns no rewards for non-stakers", async function () {
        const { outsider, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await expect(dividend.getStakeAmount(1n)).to.be.revertedWith("Invalid cycle index");

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.deposit(200, await rewardToken.getAddress())).wait();
        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        const outsiderEstimate = await dividend.connect(outsider).estimateDividends([1n], [await rewardToken.getAddress()]);
        expect(outsiderEstimate).to.have.length(0);
    });

    it("rejects duplicate cycle or token inputs when estimating dividends", async function () {
        const { normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.deposit(200, await rewardToken.getAddress())).wait();
        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await expect(
            dividend.estimateDividends([1n, 1n], [await rewardToken.getAddress()])
        ).to.be.revertedWith("Duplicate cycle index");

        await expect(
            dividend.estimateDividends([1n], [await rewardToken.getAddress(), await rewardToken.getAddress()])
        ).to.be.revertedWith("Duplicate token");
    });

    it("rejects duplicate cycle or token inputs when withdrawing dividends", async function () {
        const { normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(deployDividendFixture);

        await (await normalToken.approve(await dividend.getAddress(), 400)).wait();
        await (await dividend.stakeNormal(400)).wait();
        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();
        await (await rewardToken.approve(await dividend.getAddress(), 200)).wait();
        await (await dividend.deposit(200, await rewardToken.getAddress())).wait();
        await networkHelpers.time.increase(3601n);
        await (await dividend.tryNewCycle()).wait();

        await expect(
            dividend.withdrawDividends([1n, 1n], [await rewardToken.getAddress()])
        ).to.be.revertedWith("Duplicate cycle index");

        await expect(
            dividend.withdrawDividends([1n], [await rewardToken.getAddress(), await rewardToken.getAddress()])
        ).to.be.revertedWith("Duplicate token");
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