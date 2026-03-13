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
        const { acquired, saleToken, buyerOne, buyerTwo, normalToken } = await networkHelpers.loadFixture(deployAcquiredFixture);

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

        await expect(acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_001],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).to.be.revertedWith("total percents over 100");

        await expect(acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 0,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).to.be.revertedWith("invalid tokenAmount");

        await expect(acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 0, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).to.be.revertedWith("invalid tokenRatio");

        await expect(acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: await normalToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).to.be.revertedWith("cannot invest dao token");

        const highDecimalTokenFactory = await ethers.getContractFactory("TestToken");
        const highDecimalToken = await highDecimalTokenFactory.deploy("HighDecimal", "HDEC", 19, 1_000_000n, buyerOne.address);
        await highDecimalToken.waitForDeployment();

        await expect(acquired.connect(buyerOne).startInvestment({
            whitelist: [buyerTwo.address],
            firstPercent: [10_000],
            tokenAddress: await highDecimalToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).to.be.revertedWith("not support token decimals > 18");

        await expect(acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: ethers.ZeroAddress,
            tokenAmount: 10n,
            tokenRatio: { tokenAmount: 1, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        }, { value: 9n })).to.be.revertedWith("main token not enough");

        await expect(acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: ethers.ZeroAddress,
            tokenAmount: 10n,
            tokenRatio: { tokenAmount: 1, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        }, { value: 11n })).to.be.revertedWith("main token not enough");
    });

    it("rejects starting an investment when escrow token transferFrom returns false", async function () {
        const { investor, buyerOne, acquired } = await networkHelpers.loadFixture(deployAcquiredFixture);
        const falseToken = await (await ethers.getContractFactory("FalseReturnToken")).deploy(1_000_000n, investor.address);
        await falseToken.waitForDeployment();
        await (await falseToken.approve(await acquired.getAddress(), 500n)).wait();

        let reverted = false;
        try {
            await (await acquired.startInvestment({
                whitelist: [buyerOne.address],
                firstPercent: [10_000],
                tokenAddress: await falseToken.getAddress(),
                tokenAmount: 500,
                tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
                step1Duration: 3600,
                step2Duration: 3600,
                canEndEarly: false
            })).wait();
        } catch {
            reverted = true;
        }

        expect(reverted).to.equal(true);
    });

    it("rejects purchases when the sale token payout returns false", async function () {
        const { buyerOne, normalToken, acquired, investor } = await networkHelpers.loadFixture(deployAcquiredFixture);
        const flakyToken = await (await ethers.getContractFactory("ConfigurableReturnToken")).deploy(1_000_000n, investor.address);
        await flakyToken.waitForDeployment();

        await (await flakyToken.approve(await acquired.getAddress(), 500n)).wait();
        await (await acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: await flakyToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).wait();

        await (await flakyToken.setFailTransfer(true)).wait();
        await (await normalToken.connect(buyerOne).approve(await acquired.getAddress(), 100)).wait();

        let reverted = false;
        try {
            await (await acquired.connect(buyerOne).invest(1n, 20)).wait();
        } catch {
            reverted = true;
        }

        expect(reverted).to.equal(true);

        const info = await acquired.getInvestmentInfo(1n);
        expect(info.investedAmount).to.equal(0n);
        expect(info.daoTokenAmount).to.equal(0n);
        expect(await flakyToken.balanceOf(buyerOne.address)).to.equal(0n);
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

    it("treats the exact step-one deadline as step two for both invest and quota queries", async function () {
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
        await (await acquired.connect(buyerOne).invest(1n, 20)).wait();

        const info = await acquired.getInvestmentInfo(1n);
        await networkHelpers.time.increaseTo(info.step1EndTime);

        expect(await acquired.getAddressLeftAmount(1n, buyerOne.address)).to.equal(0n);

        await (await normalToken.connect(buyerOne).approve(await acquired.getAddress(), 30)).wait();
        await (await acquired.connect(buyerOne).invest(1n, 30)).wait();
        expect(await acquired.getAddressInvestedAmount(1n, buyerOne.address)).to.equal(250n);
    });

    it("allows investing exactly at the step-two deadline and rejects one second later", async function () {
        const { buyerOne, normalToken, acquired, saleToken } = await networkHelpers.loadFixture(deployAcquiredFixture);

        await (await saleToken.approve(await acquired.getAddress(), 500)).wait();
        await (await acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).wait();

        await (await normalToken.connect(buyerOne).approve(await acquired.getAddress(), 100)).wait();
        const info = await acquired.getInvestmentInfo(1n);
    await networkHelpers.time.setNextBlockTimestamp(info.step2EndTime);

        await (await acquired.connect(buyerOne).invest(1n, 20)).wait();
        expect(await acquired.getAddressInvestedAmount(1n, buyerOne.address)).to.equal(100n);

        await networkHelpers.time.increase(1n);
        await expect(acquired.connect(buyerOne).invest(1n, 1)).to.be.revertedWith("investment end");
    });

    it("rejects invest amounts that round down to zero sale tokens", async function () {
        const { buyerOne, normalToken, acquired, saleToken } = await networkHelpers.loadFixture(deployAcquiredFixture);

        await (await saleToken.approve(await acquired.getAddress(), 500)).wait();
        await (await acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 1, daoTokenAmount: 3 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        })).wait();

        await (await normalToken.connect(buyerOne).approve(await acquired.getAddress(), 10)).wait();

        await expect(acquired.connect(buyerOne).invest(1n, 1)).to.be.revertedWith("invalid amount");
    });

    it("rejects a purchase when remaining inventory is one unit short of the required amount", async function () {
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
        await (await acquired.connect(buyerTwo).invest(1n, 60)).wait();

        await networkHelpers.time.increase(3601n);

        await expect(acquired.connect(buyerOne).invest(1n, 21)).to.be.revertedWith("not enough token");
        await (await acquired.connect(buyerOne).invest(1n, 20)).wait();
        const finalInfo = await acquired.getInvestmentInfo(1n);
        expect(finalInfo.investedAmount).to.equal(500n);
        expect(finalInfo.daoTokenAmount).to.equal(100n);
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

    it("allows an early end after partial sales when canEndEarly is enabled", async function () {
        const { investor, buyerOne, normalToken, acquired, saleToken } = await networkHelpers.loadFixture(deployAcquiredFixture);

        await (await saleToken.approve(await acquired.getAddress(), 500)).wait();
        await (await acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: 500,
            tokenRatio: { tokenAmount: 5, daoTokenAmount: 1 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: true
        })).wait();

        await (await normalToken.connect(buyerOne).approve(await acquired.getAddress(), 100)).wait();
        await (await acquired.connect(buyerOne).invest(1n, 20)).wait();

        const investorDaoBefore = await normalToken.balanceOf(investor.address);
        const investorSaleBefore = await saleToken.balanceOf(investor.address);
        await (await acquired.endInvestment(1n)).wait();

        expect(await normalToken.balanceOf(investor.address)).to.equal(investorDaoBefore + 20n);
        expect(await saleToken.balanceOf(investor.address)).to.equal(investorSaleBefore + 400n);
        expect((await acquired.getInvestmentInfo(1n)).end).to.equal(true);
    });

    it("supports native-token sales and returns unsold native inventory on settlement", async function () {
        const { investor, buyerOne, normalToken, acquired } = await networkHelpers.loadFixture(deployAcquiredFixture);

        const acquiredAddress = await acquired.getAddress();
        await (await acquired.startInvestment({
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: ethers.ZeroAddress,
            tokenAmount: 10n,
            tokenRatio: { tokenAmount: 1, daoTokenAmount: 2 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        }, { value: 10n })).wait();

        expect(await ethers.provider.getBalance(acquiredAddress)).to.equal(10n);

        await (await normalToken.connect(buyerOne).approve(acquiredAddress, 20)).wait();
        const buyerNativeBefore = await ethers.provider.getBalance(buyerOne.address);
        const buyerTx = await acquired.connect(buyerOne).invest(1n, 8);
        const buyerReceipt = await buyerTx.wait();
        const buyerGas = BigInt(buyerReceipt!.gasUsed.toString()) * BigInt(buyerReceipt!.gasPrice.toString());

        expect(await ethers.provider.getBalance(buyerOne.address)).to.equal(buyerNativeBefore + 4n - buyerGas);
        expect(await acquired.getAddressInvestedAmount(1n, buyerOne.address)).to.equal(4n);
        const infoAfterInvest = await acquired.getInvestmentInfo(1n);
        expect(infoAfterInvest.investedAmount).to.equal(4n);
        expect(infoAfterInvest.daoTokenAmount).to.equal(8n);
        expect(infoAfterInvest.tokenAddress).to.equal(ethers.ZeroAddress);

        await networkHelpers.time.increase(7201n);

        const investorDaoBefore = await normalToken.balanceOf(investor.address);
        const investorNativeBefore = await ethers.provider.getBalance(investor.address);
        const endTx = await acquired.endInvestment(1n);
        const endReceipt = await endTx.wait();
        const endGas = BigInt(endReceipt!.gasUsed.toString()) * BigInt(endReceipt!.gasPrice.toString());

        expect(await normalToken.balanceOf(investor.address)).to.equal(investorDaoBefore + 8n);
        expect(await ethers.provider.getBalance(investor.address)).to.equal(investorNativeBefore + 6n - endGas);
        expect(await ethers.provider.getBalance(acquiredAddress)).to.equal(0n);
    });

    it("supports native-token purchases by contract buyers that need more than transfer gas", async function () {
        const { investor, normalToken, acquired } = await networkHelpers.loadFixture(deployAcquiredFixture);
        const receiverDeployment = await (await ethers.getContractFactory("NativeReceiverMock")).deploy();
        await receiverDeployment.waitForDeployment();
        const receiver = await ethers.getContractAt("NativeReceiverMock", await receiverDeployment.getAddress());

        await (await acquired.startInvestment({
            whitelist: [await receiver.getAddress()],
            firstPercent: [10_000],
            tokenAddress: ethers.ZeroAddress,
            tokenAmount: 10n,
            tokenRatio: { tokenAmount: 1, daoTokenAmount: 2 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        }, { value: 10n })).wait();

        await (await normalToken.transfer(await receiver.getAddress(), 20n)).wait();
        await (await receiver.approveToken(await normalToken.getAddress(), await acquired.getAddress(), 20n)).wait();
        await (await receiver.invest(await acquired.getAddress(), 1n, 8n)).wait();

        expect(await receiver.receiveCount()).to.equal(1n);
        expect(await receiver.totalReceived()).to.equal(4n);

        const info = await acquired.getInvestmentInfo(1n);
        expect(info.investedAmount).to.equal(4n);
        expect(info.daoTokenAmount).to.equal(8n);
    });

    it("returns unsold native inventory to contract investors that need more than transfer gas", async function () {
        const { buyerOne, acquired } = await networkHelpers.loadFixture(deployAcquiredFixture);
        const receiverDeployment = await (await ethers.getContractFactory("NativeReceiverMock")).deploy();
        await receiverDeployment.waitForDeployment();
        const receiver = await ethers.getContractAt("NativeReceiverMock", await receiverDeployment.getAddress());

        await (await receiver.startNativeInvestment(await acquired.getAddress(), {
            whitelist: [buyerOne.address],
            firstPercent: [10_000],
            tokenAddress: ethers.ZeroAddress,
            tokenAmount: 10n,
            tokenRatio: { tokenAmount: 1, daoTokenAmount: 2 },
            step1Duration: 3600,
            step2Duration: 3600,
            canEndEarly: false
        }, { value: 10n })).wait();

        await (await receiver.endInvestment(await acquired.getAddress(), 1n)).wait();

        expect(await receiver.receiveCount()).to.equal(1n);
        expect(await receiver.totalReceived()).to.equal(10n);
        expect((await acquired.getInvestmentInfo(1n)).end).to.equal(true);
    });

    it("prevents ending the same investment twice", async function () {
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
        await (await acquired.connect(buyerOne).invest(1n, 20)).wait();

        await networkHelpers.time.increase(7201n);
        await (await acquired.endInvestment(1n)).wait();

        await expect(acquired.endInvestment(1n)).to.be.revertedWith("investment end");
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