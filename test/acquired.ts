import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

async function deployAcquiredFixture() {
    const [investor, buyerOne, buyerTwo, outsider] = await ethers.getSigners();
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        1_000_000,
        [investor.address],
        [5_000],
        daoAddress
    ]);
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["BDT", "BDT", daoAddress]);
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();

    const acquired = await deployUUPSProxy(ethers, "Acquired", [1, daoAddress]);
    await (await dao.setAcquiredAddress(await acquired.getAddress())).wait();

    await (await devToken.dev2normal(1_000)).wait();
    await (await normalToken.transfer(buyerOne.address, 200)).wait();
    await (await normalToken.transfer(buyerTwo.address, 200)).wait();

    const saleTokenFactory = await ethers.getContractFactory("TestToken");
    const saleToken = await saleTokenFactory.deploy("SaleToken", "SALE", 18, 1_000_000n, investor.address);
    await saleToken.waitForDeployment();

    return {
        investor,
        buyerOne,
        buyerTwo,
        outsider,
        normalToken,
        acquired,
        saleToken
    };
}

describe("acquired", function () {
    it("rejects invalid investment configurations", async function () {
        const { acquired, saleToken, buyerOne, buyerTwo } = await networkHelpers.loadFixture(deployAcquiredFixture);

        await expect(acquired.startInvestment({
            whitelist: [buyerOne.address, buyerTwo.address],
            firstPercent: [4_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).to.be.revertedWith("whitelist and firstPercent length not equal");

        await expect(acquired.invest(999n, 10)).to.be.revertedWith("investment not exist");
    });

    it("enforces whitelist step-one limits and records investments", async function () {
        const { investor, buyerOne, buyerTwo, outsider, normalToken, acquired, saleToken } = await networkHelpers.loadFixture(deployAcquiredFixture);

        await (await saleToken.approve(await acquired.getAddress(), 500)).wait();
        await (await acquired.startInvestment({
            whitelist: [buyerOne.address, buyerTwo.address],
            firstPercent: [4_000, 6_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).wait();

        await (await normalToken.connect(buyerOne).approve(await acquired.getAddress(), 100)).wait();
        await (await normalToken.connect(buyerTwo).approve(await acquired.getAddress(), 100)).wait();

        await expect(acquired.connect(outsider).invest(1n, 20)).to.be.revertedWith("not in whitelist");

        await (await acquired.connect(buyerOne).invest(1n, 20)).wait();
        expect(await saleToken.balanceOf(buyerOne.address)).to.equal(100n);
        expect(await acquired.getAddressInvestedAmount(1n, buyerOne.address)).to.equal(100n);
        expect(await acquired.getAddressLeftAmount(1n, buyerOne.address)).to.equal(100n);

        await expect(acquired.connect(buyerOne).invest(1n, 30)).to.be.revertedWith("over limit");

        await (await acquired.connect(buyerTwo).invest(1n, 60)).wait();
        expect(await saleToken.balanceOf(buyerTwo.address)).to.equal(300n);

        const info = await acquired.getInvestmentInfo(1n);
        expect(info.investor).to.equal(investor.address);
        expect(info.investedAmount).to.equal(400n);
        expect(info.daoTokenAmount).to.equal(80n);
    });

    it("opens remaining inventory in step two after step-one caps are reached", async function () {
        const { buyerOne, buyerTwo, normalToken, acquired, saleToken } = await networkHelpers.loadFixture(deployAcquiredFixture);

        await (await saleToken.approve(await acquired.getAddress(), 500)).wait();
        await (await acquired.startInvestment({
            whitelist: [buyerOne.address, buyerTwo.address],
            firstPercent: [4_000, 6_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).wait();

        await (await normalToken.connect(buyerOne).approve(await acquired.getAddress(), 100)).wait();
        await (await normalToken.connect(buyerTwo).approve(await acquired.getAddress(), 100)).wait();

        await (await acquired.connect(buyerOne).invest(1n, 20)).wait();
        await expect(acquired.connect(buyerOne).invest(1n, 30)).to.be.revertedWith("over limit");

        await networkHelpers.time.increase(3601n);
        await (await acquired.connect(buyerOne).invest(1n, 30)).wait();

        expect(await saleToken.balanceOf(buyerOne.address)).to.equal(250n);
        expect(await acquired.getAddressInvestedAmount(1n, buyerOne.address)).to.equal(250n);
        expect(await acquired.getAddressLeftAmount(1n, buyerOne.address)).to.equal(0n);
    });

    it("only lets the investor end before step two when no sales happened yet or inventory is sold out", async function () {
        const { investor, buyerOne, buyerTwo, outsider, normalToken, acquired, saleToken } = await networkHelpers.loadFixture(deployAcquiredFixture);

        await (await saleToken.approve(await acquired.getAddress(), 500)).wait();
        await (await acquired.startInvestment({
            whitelist: [buyerOne.address, buyerTwo.address],
            firstPercent: [4_000, 6_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).wait();

        await (await normalToken.connect(buyerOne).approve(await acquired.getAddress(), 100)).wait();
        await (await normalToken.connect(buyerTwo).approve(await acquired.getAddress(), 100)).wait();

        await expect(acquired.connect(outsider).endInvestment(1n)).to.be.revertedWith(
            "only investor can end investment"
        );

        const investorSaleBeforeFirstEnd = await saleToken.balanceOf(investor.address);
        await (await acquired.endInvestment(1n)).wait();
        expect(await saleToken.balanceOf(investor.address)).to.equal(investorSaleBeforeFirstEnd + 500n);

        await (await saleToken.approve(await acquired.getAddress(), 500)).wait();
        await (await acquired.startInvestment({
            whitelist: [buyerOne.address, buyerTwo.address],
            firstPercent: [4_000, 6_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).wait();

        await (await acquired.connect(buyerOne).invest(2n, 20)).wait();
        await expect(acquired.endInvestment(2n)).to.be.revertedWith("not all token sold out");

        await networkHelpers.time.increase(3601n);
        await (await acquired.connect(buyerTwo).invest(2n, 80)).wait();

        const investorDaoBefore = await normalToken.balanceOf(investor.address);
        await (await acquired.endInvestment(2n)).wait();

        expect(await normalToken.balanceOf(investor.address)).to.equal(investorDaoBefore + 100n);

        const info = await acquired.getInvestmentInfo(2n);
        expect(info.investedAmount).to.equal(500n);
        expect(info.end).to.equal(true);
    });

    it("returns dao tokens and unsold inventory to the investor when ending an investment", async function () {
        const { investor, buyerOne, buyerTwo, normalToken, acquired, saleToken } = await networkHelpers.loadFixture(deployAcquiredFixture);

        await (await saleToken.approve(await acquired.getAddress(), 500)).wait();
        await (await acquired.startInvestment({
            whitelist: [buyerOne.address, buyerTwo.address],
            firstPercent: [4_000, 6_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).wait();

        await (await normalToken.connect(buyerOne).approve(await acquired.getAddress(), 100)).wait();
        await (await normalToken.connect(buyerTwo).approve(await acquired.getAddress(), 100)).wait();
        await (await acquired.connect(buyerOne).invest(1n, 20)).wait();
        await (await acquired.connect(buyerTwo).invest(1n, 60)).wait();

        await networkHelpers.time.increase(7201n);

        const investorDaoBefore = await normalToken.balanceOf(investor.address);
        const investorSaleBefore = await saleToken.balanceOf(investor.address);
        await (await acquired.endInvestment(1n)).wait();

        expect(await normalToken.balanceOf(investor.address)).to.equal(investorDaoBefore + 80n);
        expect(await saleToken.balanceOf(investor.address)).to.equal(investorSaleBefore + 100n);

        const info = await acquired.getInvestmentInfo(1n);
        expect(info.end).to.equal(true);

        await expect(acquired.connect(buyerOne).invest(1n, 1)).to.be.revertedWith("investment end");
    });
});