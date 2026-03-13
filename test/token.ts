import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

async function deployTokenFixture() {
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
        devToken,
        normalToken
    };
}

describe("token", function () {
    it("converts dev tokens to normal tokens at a 1:1 ratio", async function () {
        const { owner, devToken, normalToken } = await networkHelpers.loadFixture(deployTokenFixture);

        expect(await devToken.balanceOf(owner.address)).to.equal(5_000n);
        expect(await normalToken.balanceOf(owner.address)).to.equal(0n);
        expect(await devToken.totalReleased()).to.equal(5_000n);

        await (await devToken.dev2normal(1_200)).wait();

        expect(await devToken.balanceOf(owner.address)).to.equal(3_800n);
        expect(await normalToken.balanceOf(owner.address)).to.equal(1_200n);
        expect(await devToken.totalSupply()).to.equal(998_800n);
        expect(await devToken.totalReleased()).to.equal(3_800n);
    });

    it("rejects conversions that exceed the holder's dev balance", async function () {
        const { beneficiary, devToken } = await networkHelpers.loadFixture(deployTokenFixture);

        let reverted = false;
        try {
            await (await devToken.connect(beneficiary).dev2normal(1)).wait();
        } catch {
            reverted = true;
        }

        expect(reverted).to.equal(true);
    });

    it("prevents direct minting on the normal token contract", async function () {
        const { beneficiary, normalToken } = await networkHelpers.loadFixture(deployTokenFixture);

        await expect(normalToken.mintNormalToken(beneficiary.address, 100)).to.be.revertedWith(
            "only dev token contract can mint"
        );

        expect(await normalToken.balanceOf(beneficiary.address)).to.equal(0n);
    });

    it("allows normal token holders to transfer balances after conversion", async function () {
        const { owner, beneficiary, devToken, normalToken } = await networkHelpers.loadFixture(deployTokenFixture);

        await (await devToken.dev2normal(700)).wait();

        const beneficiaryBalanceBefore = await normalToken.balanceOf(beneficiary.address);
        await (await normalToken.transfer(beneficiary.address, 200)).wait();

        expect(await normalToken.balanceOf(owner.address)).to.equal(500n);
        expect(await normalToken.balanceOf(beneficiary.address)).to.equal(beneficiaryBalanceBefore + 200n);
    });
});
