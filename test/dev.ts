import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

async function deployDevFixture() {
    const [owner, projectSigner, lockupSigner, dividendSigner, beneficiary] = await ethers.getSigners();

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    await (await dao.setProjectAddress(projectSigner.address)).wait();
    await (await dao.setTokenLockupAddress(lockupSigner.address)).wait();
    await (await dao.setTokenDividendAddress(dividendSigner.address)).wait();

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
        projectSigner,
        lockupSigner,
        dividendSigner,
        beneficiary,
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
        const { owner, projectSigner, beneficiary, devToken } = await networkHelpers.loadFixture(deployDevFixture);

        await expect(devToken.connect(beneficiary).mintDevToken(300)).to.be.revertedWith("only project can release");

        const projectBalanceBefore = await devToken.balanceOf(projectSigner.address);
        await (await devToken.connect(projectSigner).mintDevToken(300)).wait();

        expect(await devToken.balanceOf(projectSigner.address)).to.equal(projectBalanceBefore + 300n);
        expect(await devToken.balanceOf(owner.address)).to.equal(5_000n);
        expect(await devToken.balanceOf(await devToken.getAddress())).to.equal(994_700n);
    });

    it("lets the configured project route released dev tokens onward to contributors", async function () {
        const { projectSigner, beneficiary, devToken } = await networkHelpers.loadFixture(deployDevFixture);

        await (await devToken.connect(projectSigner).mintDevToken(300)).wait();
        await (await devToken.connect(projectSigner).transfer(beneficiary.address, 120)).wait();

        expect(await devToken.balanceOf(projectSigner.address)).to.equal(180n);
        expect(await devToken.balanceOf(beneficiary.address)).to.equal(120n);
    });

    it("rejects direct transfers between regular user accounts", async function () {
        const { devToken, beneficiary } = await networkHelpers.loadFixture(deployDevFixture);

        await expect(devToken.transfer(beneficiary.address, 100)).to.be.revertedWith("invalid transfer");

        expect(await devToken.balanceOf(beneficiary.address)).to.equal(0n);
    });

    it("allows transfer paths through configured lockup and dividend addresses", async function () {
        const { owner, beneficiary, lockupSigner, dividendSigner, devToken } = await networkHelpers.loadFixture(deployDevFixture);

        await (await devToken.transfer(lockupSigner.address, 150)).wait();
        expect(await devToken.balanceOf(lockupSigner.address)).to.equal(150n);

        await (await devToken.transfer(dividendSigner.address, 200)).wait();
        expect(await devToken.balanceOf(dividendSigner.address)).to.equal(200n);

        await (await devToken.connect(dividendSigner).transfer(beneficiary.address, 80)).wait();

        expect(await devToken.balanceOf(dividendSigner.address)).to.equal(120n);
        expect(await devToken.balanceOf(beneficiary.address)).to.equal(80n);
        expect(await devToken.balanceOf(owner.address)).to.equal(4_650n);
    });

    it("keeps the lockup route inbound-only while allowing the dividend route to send back out", async function () {
        const { beneficiary, lockupSigner, dividendSigner, devToken } = await networkHelpers.loadFixture(deployDevFixture);

        await (await devToken.transfer(lockupSigner.address, 150)).wait();
        await expect(devToken.connect(lockupSigner).transfer(beneficiary.address, 10)).to.be.revertedWith("invalid transfer");

        await (await devToken.transfer(dividendSigner.address, 90)).wait();
        await (await devToken.connect(dividendSigner).transfer(beneficiary.address, 30)).wait();

        expect(await devToken.balanceOf(lockupSigner.address)).to.equal(150n);
        expect(await devToken.balanceOf(dividendSigner.address)).to.equal(60n);
        expect(await devToken.balanceOf(beneficiary.address)).to.equal(30n);
    });
});
