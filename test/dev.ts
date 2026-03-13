import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

async function deployDevFixture() {
    const [owner, beneficiary] = await ethers.getSigners();

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const operatorFactory = await ethers.getContractFactory("TokenOperatorMock");
    const projectOperator = await operatorFactory.deploy();
    await projectOperator.waitForDeployment();
    const lockupOperator = await operatorFactory.deploy();
    await lockupOperator.waitForDeployment();
    const dividendOperator = await operatorFactory.deploy();
    await dividendOperator.waitForDeployment();

    await (await dao.setProjectAddress(await projectOperator.getAddress())).wait();
    await (await dao.setTokenLockupAddress(await lockupOperator.getAddress())).wait();
    await (await dao.setTokenDividendAddress(await dividendOperator.getAddress())).wait();

    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        1_000_000,
        [owner.address],
        [5_000],
        await dao.getAddress()
    ]);
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["BDT", "BDT", await dao.getAddress()]);
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();

    return {
        owner,
        beneficiary,
        projectOperator,
        lockupOperator,
        dividendOperator,
        devToken,
        normalToken
    };
}

describe("dev", function () {
    it("rejects invalid initialization data for the dev token", async function () {
        const [owner] = await ethers.getSigners();
        const dao = await deployUUPSProxy(ethers, "SourceDao");
        const factory = await ethers.getContractFactory("DevToken");

        await expect(deployUUPSProxy(ethers, "DevToken", [
            "BDDT",
            "BDDT",
            1_000_000,
            [owner.address],
            [5_000, 1_000],
            await dao.getAddress()
        ])).to.be.revertedWith("init data error");

        const implementation = await factory.deploy();
        await implementation.waitForDeployment();

        await expect(deployUUPSProxy(ethers, "DevToken", [
            "BDDT",
            "BDDT",
            1_000,
            [owner.address],
            [5_000],
            await dao.getAddress()
        ])).to.be.revertedWith("initAmount exceeds totalSupply");
    });

    it("only lets the configured project address mint dev tokens", async function () {
        const { owner, beneficiary, projectOperator, devToken } = await networkHelpers.loadFixture(deployDevFixture);

        await expect(devToken.connect(beneficiary).mintDevToken(300)).to.be.revertedWith("only project can release");

        const projectAddress = await projectOperator.getAddress();
        const projectBalanceBefore = await devToken.balanceOf(projectAddress);
        await (await projectOperator.mintDevToken(await devToken.getAddress(), 300)).wait();

        expect(await devToken.balanceOf(projectAddress)).to.equal(projectBalanceBefore + 300n);
        expect(await devToken.balanceOf(owner.address)).to.equal(5_000n);
        expect(await devToken.balanceOf(await devToken.getAddress())).to.equal(994_700n);
    });

    it("lets the configured project route released dev tokens onward to contributors", async function () {
        const { projectOperator, beneficiary, devToken } = await networkHelpers.loadFixture(deployDevFixture);

        await (await projectOperator.mintDevToken(await devToken.getAddress(), 300)).wait();
        await (await projectOperator.transferToken(await devToken.getAddress(), beneficiary.address, 120)).wait();

        expect(await devToken.balanceOf(await projectOperator.getAddress())).to.equal(180n);
        expect(await devToken.balanceOf(beneficiary.address)).to.equal(120n);
    });

    it("rejects direct transfers between regular user accounts", async function () {
        const { devToken, beneficiary } = await networkHelpers.loadFixture(deployDevFixture);

        await expect(devToken.transfer(beneficiary.address, 100)).to.be.revertedWith("invalid transfer");

        expect(await devToken.balanceOf(beneficiary.address)).to.equal(0n);
    });

    it("allows transfer paths through configured lockup and dividend addresses", async function () {
        const { owner, beneficiary, lockupOperator, dividendOperator, devToken } = await networkHelpers.loadFixture(deployDevFixture);

        await (await devToken.transfer(await lockupOperator.getAddress(), 150)).wait();
        expect(await devToken.balanceOf(await lockupOperator.getAddress())).to.equal(150n);

        await (await devToken.transfer(await dividendOperator.getAddress(), 200)).wait();
        expect(await devToken.balanceOf(await dividendOperator.getAddress())).to.equal(200n);

        await (await dividendOperator.transferToken(await devToken.getAddress(), beneficiary.address, 80)).wait();

        expect(await devToken.balanceOf(await dividendOperator.getAddress())).to.equal(120n);
        expect(await devToken.balanceOf(beneficiary.address)).to.equal(80n);
        expect(await devToken.balanceOf(owner.address)).to.equal(4_650n);
    });

    it("keeps the lockup route inbound-only while allowing the dividend route to send back out", async function () {
        const { beneficiary, lockupOperator, dividendOperator, devToken } = await networkHelpers.loadFixture(deployDevFixture);

        await (await devToken.transfer(await lockupOperator.getAddress(), 150)).wait();
        await expect(
            lockupOperator.transferToken(await devToken.getAddress(), beneficiary.address, 10)
        ).to.be.revertedWith("invalid transfer");

        await (await devToken.transfer(await dividendOperator.getAddress(), 90)).wait();
        await (await dividendOperator.transferToken(await devToken.getAddress(), beneficiary.address, 30)).wait();

        expect(await devToken.balanceOf(await lockupOperator.getAddress())).to.equal(150n);
        expect(await devToken.balanceOf(await dividendOperator.getAddress())).to.equal(60n);
        expect(await devToken.balanceOf(beneficiary.address)).to.equal(30n);
    });
});
