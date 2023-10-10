import hre from "hardhat";
import { SourceDaoCommittee, ProjectManagement, Investment, MultiSigWallet, ReentrancyGuardUpgradeable__factory, IInvestment } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BytesLike } from "ethers";

const BigNumber = hre.ethers.BigNumber;

let endTime = Math.ceil(new Date().getTime() / 1000) + 10000;

let assetAddress = "0x0000000000000000000000000000000000000000";
let testEth = false;

console.log('testEth:', testEth);

function packCreateInvestmentParams(info: IInvestment.InvestmentBriefStructOutput, investmentId: number): BytesLike[] {
    return [
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(investmentId), 32),
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(info.params.totalTokenAmount), 32),
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(info.params.priceType), 32),
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(info.params.tokenExchangeRate), 32),
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(info.params.assetExchangeRate), 32),
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(info.params.startTime), 32),
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(info.params.endTime), 32),
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(info.params.goalAssetAmount), 32),
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(info.params.minAssetPerInvestor), 32),
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(info.params.maxAssetPerInvestor), 32),  
        hre.ethers.utils.zeroPad(info.params.assetAddress, 32), 
        hre.ethers.utils.zeroPad(hre.ethers.utils.hexlify(info.params.onlyWhitelist?1:0), 32),  
        hre.ethers.utils.formatBytes32String("createInvestment")
    ]
}

describe("Investment", () => {
    async function deployContracts() {
        const signers = await hre.ethers.getSigners();
        let committees = [];
        for (let i = 1; i < 6; i++) {
            committees.push(signers[i].address);
        }
        const SourceDao = await hre.ethers.getContractFactory("SourceDao");
        let sourceDao = await SourceDao.deploy();
        const SourceDaoToken = await hre.ethers.getContractFactory("SourceDaoToken");
        const daoToken = (await hre.upgrades.deployProxy(SourceDaoToken, [2100000000, sourceDao.address], { kind: "uups" }));
        // await daoToken.setMainContractAddress(sourceDao.address);
        await sourceDao.setTokenAddress(daoToken.address);

        const ProjectManager = await hre.ethers.getContractFactory("ProjectManagement");
        const projectManager = (await hre.upgrades.deployProxy(ProjectManager, [sourceDao.address], { kind: "uups" })) as ProjectManagement;
        await projectManager.deployed();
        // await projectManager.setMainContractAddress(sourceDao.address);
        await sourceDao.setDevAddress(projectManager.address);

        const Committee = await hre.ethers.getContractFactory("SourceDaoCommittee");
        const committee = (await hre.upgrades.deployProxy(Committee, [committees, sourceDao.address], { kind: "uups" })) as SourceDaoCommittee;
        await committee.deployed();
        // await committee.setMainContractAddress(sourceDao.address);
        await sourceDao.setCommitteeAddress(committee.address);

        const Investment = await hre.ethers.getContractFactory("Investment");
        const investment = (await hre.upgrades.deployProxy(Investment, [sourceDao.address], { kind: "uups" })) as Investment;
        // await investment.setMainContractAddress(sourceDao.address);
        await sourceDao.setInvestmentAddress(investment.address);

        const MultiSigWallet = await hre.ethers.getContractFactory("MultiSigWallet");
        const multiSigWallet = (await hre.upgrades.deployProxy(MultiSigWallet, ["test", sourceDao.address], { initializer: 'initialize', kind: "uups" })) as MultiSigWallet;
        // await multiSigWallet.setMainContractAddress(sourceDao.address);
        await sourceDao.setAssetWallet(multiSigWallet.address, 0);

        const TestToken = await hre.ethers.getContractFactory("TestToken");
        const testToken = await TestToken.deploy(BigNumber.from(10).pow(18).mul(10000000000));

        return { signers, investment, committee, daoToken, committees, testToken, sourceDao };
    }

    it("Investment create failed", async () => {
        const { signers, investment: investment, committee, daoToken, committees, testToken } = await loadFixture(deployContracts);

        await expect(investment.connect(signers[1]).createInvestment(100, {
            priceType: 0,
            assetAddress: testEth ? "0x0000000000000000000000000000000000000000" : testToken.address,
            tokenExchangeRate: 2,
            assetExchangeRate: 1,
            endTime: endTime,
            goalAssetAmount: BigNumber.from(10).pow(18),
            minAssetPerInvestor: 1000,
            maxAssetPerInvestor: 10000,
            onlyWhitelist: true,
            startTime: Math.ceil(new Date().getTime() / 1000),
            totalTokenAmount: BigNumber.from(10).pow(18)
        })).to.be.revertedWith("GoalAssetAmount not valid");
    });

    it("Investment only-whitelist-failed", async () => {
        const { signers, investment: investment, committee, daoToken, committees, testToken } = await loadFixture(deployContracts);
        let investmentId, proposalId;
        {
            let tx = await investment.connect(signers[1]).createInvestment(100, {
                priceType: 0,
                assetAddress: testEth ? "0x0000000000000000000000000000000000000000" : testToken.address,
                tokenExchangeRate: 2,
                assetExchangeRate: 1,
                endTime: endTime,
                goalAssetAmount: 10000,
                minAssetPerInvestor: 1000,
                maxAssetPerInvestor: 10000,
                onlyWhitelist: true,
                startTime: Math.ceil(new Date().getTime() / 1000),
                totalTokenAmount: 20000
            });
            let ret = await tx.wait();
            expect(ret.events?.length).to.equal(2);
            let event = ret.events![1];
            expect(event.event).to.eq("CreateInvestmentEvent");
            investmentId = event.args![0];
            proposalId = event.args![1];
        }

        {
            let error = false;
            try {
                await investment.startInvestment(investmentId);
            } catch (e) {
                error = true;
            }
            expect(error).to.equal(true);
        }

        {
            if (!testEth) {
                await testToken.transfer(signers[0].address, 1000);
                await testToken.connect(signers[0]).approve(investment.address, 1000);
            }
            await expect(investment.connect(signers[0]).invest(investmentId, 1000, { value: 1000 })).to.be.revertedWith("Not started");
        }

        {
            let info = await investment.viewInvestment(investmentId);
            for (let signer of signers) {
                let isMember = false;
                for (let member of committees) {
                    if (member === signer.address) {
                        isMember = true;
                        break;
                    }
                }

                if (isMember) {
                    let tx = await committee.connect(signer).support(proposalId, packCreateInvestmentParams(info, investmentId));
                    await tx.wait();
                }
            }
        }
        {
            await investment.startInvestment(investmentId);
        }

        {
            let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
            expect(availableInvestment).to.equal(20000);
        }

        {
            if (!testEth) {
                await testToken.transfer(signers[0].address, 1000);
                await testToken.connect(signers[0]).approve(investment.address, 1000);
            }
            await expect(investment.invest(investmentId, 1000)).to.be.revertedWith("Only white list");
        }

        {
            await expect(investment.addWhitelist(investmentId, [signers[0].address], [0], [10000])).to.be.revertedWith("Not a committee member");
        }
        {
            await investment.connect(signers[1]).addWhitelist(investmentId, [signers[0].address], [0], [10000]);
            await investment.connect(signers[1]).addWhitelist(investmentId, [signers[1].address], [0], [1000000]);
        }

        {
            const brief = await investment.connect(signers[1]).viewInvestment(investmentId);
        }

        {
            if (!testEth) {
                await testToken.transfer(signers[0].address, 1000);
                await testToken.connect(signers[0]).approve(investment.address, 1000);
            }
            let tx = await investment.connect(signers[0]).invest(investmentId, 1000, { value: 1000 });
        }

        {
            let availableInvestment = await investment.getAvailableTokenAmount(investmentId);
            expect(availableInvestment).to.equal(20000 - 1000 * 2);
        }

        {
            const brief = await investment.viewInvestment(investmentId);
        }

        {
            let balance = await signers[0].getBalance();
        }

        {
            await expect(investment.finishInvestment(investmentId)).to.be.revertedWith("Not the end time");
        }

        {
            //时间快进到结束
            await hre.ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
            await hre.ethers.provider.send("evm_mine", []);

            let tx = await investment.finishInvestment(investmentId);
            let ret = await tx.wait();
            expect(ret.events?.length).to.equal(1);
            let event = ret.events![0];
            expect(event.event).to.eq("InvestmentStateChangeEvent");
            expect(event.args![1]).to.equal(1);
            expect(event.args![2]).to.equal(3);
        }
        {
            let [minLimit, maxLimit, assetAmount, withdrawn] = await investment.viewSelfInfo(investmentId);
            await expect(investment.withdrawTokens(investmentId)).to.be.revertedWith("Cannot withdraw right now");

            let tx = await investment.refundAsset(investmentId);
            let ret = await tx.wait();
            for (let event of ret.events!) {
                if (event.event == "RefundAssetEvent") {
                    expect(1000).to.equal(event.args![1]);
                    break;
                }
            }

            [minLimit, maxLimit, assetAmount, withdrawn] = await investment.viewSelfInfo(investmentId);
            await expect(investment.refundAsset(investmentId)).to.be.revertedWith("No asset to refund");

            let tokenBalance = await investment.getTokenBalance(investmentId);
            expect(tokenBalance).to.equal(20000);
        }
        {
            let [minLimit, maxLimit, assetAmount, withdrawn] = await investment.connect(signers[1]).viewSelfInfo(investmentId);

            await expect(investment.connect(signers[1]).withdrawTokens(investmentId)).to.be.revertedWith("Cannot withdraw right now");
            await expect(investment.connect(signers[1]).refundAsset(investmentId)).to.be.revertedWith("No asset to refund");

            [minLimit, maxLimit, assetAmount, withdrawn] = await investment.connect(signers[1]).viewSelfInfo(investmentId);

            let tx = await investment.connect(signers[1]).burnUnAllocatedTokens(investmentId);
            let ret = await tx.wait();

            for (let event of ret.events!) {
                if (event.event == "BurnTokenEvent") {
                    expect(20000).to.equal(event.args![1]);
                }
            }

            let tokenBalance = await investment.getTokenBalance(investmentId);
            expect(tokenBalance).to.equal(0);
        }
    });

    it("Investment only-whitelist-success", async () => {
        const { signers, investment: investment, committee, daoToken, committees, testToken, sourceDao } = await loadFixture(deployContracts);

        let totalUnreleased = await daoToken.totalUnreleased();
        let investmentId, proposalId;
        let goalAsset = BigNumber.from(10).pow(18).mul(10);
        let totalToken = BigNumber.from(10).pow(18).mul(20).add(10000);
        {
            let tx = await investment.connect(signers[1]).createInvestment(100, {
                priceType: 0,
                assetAddress: testEth ? "0x0000000000000000000000000000000000000000" : testToken.address,
                tokenExchangeRate: 2,
                assetExchangeRate: 1,
                endTime: endTime,
                goalAssetAmount: goalAsset,
                minAssetPerInvestor: 10000,
                maxAssetPerInvestor: BigNumber.from(10).pow(18),
                onlyWhitelist: true,
                startTime: Math.ceil(new Date().getTime() / 1000),
                totalTokenAmount: totalToken,
            });
            let ret = await tx.wait();

            expect(ret.events?.length).to.equal(2);
            let event = ret.events![1];
            expect(event.event).to.eq("CreateInvestmentEvent");
            investmentId = event.args![0];
            proposalId = event.args![1];
        }

        {
            await expect(investment.startInvestment(investmentId)).to.be.revertedWith("Proposal not accept");
            if (!testEth) {
                await testToken.transfer(signers[0].address, 1000);
                await testToken.connect(signers[0]).approve(investment.address, 1000);
            }
            await expect(investment.connect(signers[0]).invest(investmentId, 1000, { value: 1000 })).to.be.revertedWith("Not started");
        }

        {
            let info = await investment.viewInvestment(investmentId);
            for (let signer of signers) {
                let isMember = false;
                for (let member of committees) {
                    if (member === signer.address) {
                        isMember = true;
                        break;
                    }
                }

                if (isMember) {
                    let tx = await committee.connect(signer).support(proposalId, packCreateInvestmentParams(info, investmentId));
                    await tx.wait();
                }
            }
        }
        {
            if (!testEth) {
                await testToken.transfer(signers[0].address, 1000);
                await testToken.connect(signers[0]).approve(investment.address, 1000);
            }
            await expect(investment.invest(investmentId, 1000)).to.be.revertedWith("Not started");
            await investment.startInvestment(investmentId);
            await expect(investment.startInvestment(investmentId)).to.be.revertedWith("State is not PREPARE");
        }

        {
            if (!testEth) {
                await testToken.transfer(signers[0].address, 1000);
                await testToken.connect(signers[0]).approve(investment.address, 1000);
            }
            await expect(investment.invest(investmentId, 1000)).to.be.revertedWith("Only white list");
        }

        {
            await expect(investment.addWhitelist(investmentId, [signers[0].address], [0], [10000])).to.be.revertedWith("Not a committee member");
        }
        {
            await investment.connect(signers[1]).addWhitelist(investmentId, [signers[0].address], [10000], [BigNumber.from(10).pow(9)]);

            let [minLimit, maxLimit] = await investment.connect(signers[1]).getWhitelistLimit(investmentId, [signers[0].address]);
        }

        {
            const brief = await investment.connect(signers[1]).viewInvestment(investmentId);
        }


        {
            if (!testEth) {
                await testToken.transfer(signers[0].address, 1000);
                await testToken.connect(signers[0]).approve(investment.address, 1000);
            }
            await expect(investment.invest(investmentId, 1000, { value: 1000 })).to.be.revertedWith("Amount < MinLimit");
            let amount = BigNumber.from(10).pow(10);
            await testToken.transfer(signers[0].address, amount);
            if (!testEth) {
                await testToken.transfer(signers[0].address, amount);
                await testToken.connect(signers[0]).approve(investment.address, amount);
            }
            await expect(investment.invest(investmentId, amount, { value: amount })).to.be.revertedWith("Amount > MaxLimit");

            await investment.connect(signers[1]).addWhitelist(investmentId, [signers[0].address], [10000], [BigNumber.from(10).pow(11)]);

            let [minLimit, maxLimit] = await investment.connect(signers[1]).getWhitelistLimit(investmentId, [signers[0].address]);
            if (testEth) {
                await expect(investment.invest(investmentId, amount, { value: amount.add(1) })).to.be.revertedWith("Amount not match");
            }
            await investment.invest(investmentId, amount, { value: amount });
        }

        await expect(investment.finishInvestment(investmentId)).to.be.revertedWith("Not the end time");

        {
            let [minLimit, maxLimit, assetAmount, withdrawn] = await investment.viewSelfInfo(investmentId);
            await expect(investment.withdrawAsset(investmentId)).to.be.revertedWith("Not successful");
            await expect(investment.refundAsset(investmentId)).to.be.revertedWith("Cannot refund right now");
            await expect(investment.withdrawTokens(investmentId)).to.be.revertedWith("Cannot withdraw right now");
        }

        {
            let amount = goalAsset.add(10).sub(BigNumber.from(10).pow(10));
            if (!testEth) {
                await testToken.transfer(signers[0].address, amount);
                await testToken.connect(signers[0]).approve(investment.address, amount);
            }
            await expect(investment.invest(investmentId, amount, { value: amount })).to.be.revertedWith("Amount > MaxLimit");

            await investment.connect(signers[1]).addWhitelist(investmentId, [signers[1].address], [10000], [goalAsset]);
            if (!testEth) {
                await testToken.transfer(signers[1].address, amount);
                await testToken.connect(signers[1]).approve(investment.address, amount);
            }
            await investment.connect(signers[1]).invest(investmentId, amount, { value: amount });

            const brief = await investment.viewInvestment(investmentId);

            //时间快进到结束
            await hre.ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
            await hre.ethers.provider.send("evm_mine", []);

            let tx = await investment.finishInvestment(investmentId);
            let ret = await tx.wait();

            expect(ret.events?.length).to.equal(1);
            let event = ret.events![0];
            expect(event.event).to.eq("InvestmentStateChangeEvent");
            expect(event.args![1]).to.equal(1);
            expect(event.args![2]).to.equal(2);
        }
        {
            let [minLimit, maxLimit, assetAmount, withdrawn] = await investment.viewSelfInfo(investmentId);

            await expect(investment.refundAsset(investmentId)).to.be.revertedWith("Cannot refund right now");

            let tx = await investment.withdrawTokens(investmentId);
            let ret = await tx.wait();
            let event = ret.events![1];
            expect(event.event).to.eq("WithdrawTokensEvent");

            expect(BigNumber.from(10).pow(10)).to.equal(event.args![1]);
            expect(BigNumber.from(10).pow(10).mul(2)).to.equal(event.args![2]);

            [minLimit, maxLimit, assetAmount, withdrawn] = await investment.viewSelfInfo(investmentId);

            await expect(investment.withdrawTokens(investmentId)).to.be.revertedWith("Already withdrawn");

            let tokenBalance = await investment.getTokenBalance(investmentId);
            expect(tokenBalance).to.equal(totalToken.sub(event.args![2]));

            let ethBalance = await hre.ethers.provider.getBalance(sourceDao.assetWallet());
            await investment.withdrawAsset(investmentId);
            ethBalance = await hre.ethers.provider.getBalance(sourceDao.assetWallet());
        }
        {
            let [minLimit, maxLimit, assetAmount, withdrawn] = await investment.connect(signers[1]).viewSelfInfo(investmentId);

            await expect(investment.connect(signers[1]).refundAsset(investmentId)).to.be.revertedWith("Cannot refund right now");

            let tx = await investment.connect(signers[1]).withdrawTokens(investmentId);
            let ret = await tx.wait();
            let event = ret.events![1];
            expect(event.event).to.eq("WithdrawTokensEvent");
            let tokenBalance = await investment.getTokenBalance(investmentId);
        }
        {
            let [minLimit, maxLimit, assetAmount, withdrawn] = await investment.connect(signers[2]).viewSelfInfo(investmentId);

            await expect(investment.connect(signers[2]).withdrawTokens(investmentId)).to.be.revertedWith("Did not invest");

            let tx = await investment.connect(signers[1]).burnUnAllocatedTokens(investmentId);
            let ret = await tx.wait();
            let event = ret.events![2];
            expect(event.event).to.eq("BurnTokenEvent");
            let tokenBalance = await investment.getTokenBalance(investmentId);
            expect(tokenBalance).to.equal(0);
        }
    });

    it("Investment not-only-whitelist-fixed", async () => {
        const { signers, investment: investment, committee, daoToken, committees, testToken, sourceDao } = await loadFixture(deployContracts);

        let investmentId, proposalId;
        let goalAsset = BigNumber.from(10).pow(18).mul(10000);
        let totalToken = BigNumber.from(10).pow(18).mul(200000).add(10000);
        let maxAssetPerInvestor = BigNumber.from(10).pow(18).mul(1000);
        let minAssetPerInvestor = 1000000;
        let tokenExchangeRate = 2;
        let assetExchangeRate = 1;
        {
            let tx = await investment.connect(signers[1]).createInvestment(100, {
                priceType: 0,
                assetAddress: testEth ? "0x0000000000000000000000000000000000000000" : testToken.address,
                tokenExchangeRate,
                assetExchangeRate,
                endTime: endTime,
                goalAssetAmount: goalAsset,
                minAssetPerInvestor,
                maxAssetPerInvestor,
                onlyWhitelist: false,
                startTime: 0,
                totalTokenAmount: totalToken,
            });
            let ret = await tx.wait();

            expect(ret.events?.length).to.equal(2);
            let event = ret.events![1];
            expect(event.event).to.eq("CreateInvestmentEvent");
            investmentId = event.args![0];
            proposalId = event.args![1];
        }

        {
            await expect(investment.startInvestment(investmentId)).to.be.revertedWith("Proposal not accept");
            if (!testEth) {
                await testToken.transfer(signers[0].address, 1000);
                await testToken.connect(signers[0]).approve(investment.address, 1000);
            }
            await expect(investment.connect(signers[0]).invest(investmentId, 1000, { value: 1000 })).to.be.revertedWith("Not started");
        }

        {
            let info = await investment.viewInvestment(investmentId);
            for (let signer of signers) {
                let isMember = false;
                for (let member of committees) {
                    if (member === signer.address) {
                        isMember = true;
                        break;
                    }
                }

                if (isMember) {
                    let tx = await committee.connect(signer).support(proposalId, packCreateInvestmentParams(info, investmentId));
                    await tx.wait();
                }
            }
        }
        {
            await investment.startInvestment(investmentId);
            // test start again
            await expect(investment.startInvestment(investmentId)).to.be.revertedWith("State is not PREPARE");
        }

        let raisedAmount = BigNumber.from(0);

        {
            // test limit not whitelist
            let balance = await signers[0].getBalance();
            let amount = BigNumber.from(minAssetPerInvestor).sub(10);
            if (!testEth) {
                await testToken.transfer(signers[0].address, amount);
                await testToken.connect(signers[0]).approve(investment.address, amount);
            }
            await expect(investment.invest(investmentId, amount)).to.be.revertedWith("Amount < MinLimit");

            amount = BigNumber.from(maxAssetPerInvestor.add(10));
            if (!testEth) {
                await testToken.transfer(signers[0].address, amount);
                await testToken.connect(signers[0]).approve(investment.address, amount);
            }
            await expect(investment.invest(investmentId, amount)).to.be.revertedWith("Amount > MaxLimit");

            amount = BigNumber.from(minAssetPerInvestor);

            await investment.invest(investmentId, amount, testEth ? { value: amount } : { value: 0 });
            raisedAmount = raisedAmount.add(amount);

            const brief = await investment.viewInvestment(investmentId);
            expect(raisedAmount).to.eq(brief.raisedAssetAmount);

            let [min, max, invested, withdrawn] = await investment.viewSelfInfo(investmentId);
            expect(invested).to.eq(amount);
            expect(min).to.eq(minAssetPerInvestor);
            expect(max).to.eq(maxAssetPerInvestor);

            await expect(investment.withdrawTokens(investmentId)).to.be.revertedWith("Cannot withdraw right now");
            await expect(investment.refundAsset(investmentId)).to.be.revertedWith("Cannot refund right now");
        }

        {
            // test limit in whitelist
            await expect(investment.addWhitelist(investmentId, [signers[1].address], [0], [10000])).to.be.revertedWith("Not a committee member");
            await expect(investment.connect(signers[1]).addWhitelist(investmentId, [signers[1].address, signers[2].address], [10000, 20000], [maxAssetPerInvestor.add(100)])).to.be.revertedWith("Length not equal");

            await investment.connect(signers[1]).addWhitelist(
                investmentId,
                [signers[1].address, signers[2].address],
                [10000, 20000],
                [maxAssetPerInvestor.add(100), maxAssetPerInvestor.add(1000)]);

            let [minLimits, maxLimits] = await investment.connect(signers[1]).getWhitelistLimit(investmentId, [signers[0].address, signers[1].address, signers[2].address]);
            expect(minLimits[0]).to.eq(0);
            expect(minLimits[1]).to.eq(10000);
            expect(minLimits[2]).to.eq(20000);
            expect(maxLimits[0]).to.eq(0);
            expect(maxLimits[1]).to.eq(maxAssetPerInvestor.add(100));
            expect(maxLimits[2]).to.eq(maxAssetPerInvestor.add(1000));

            await investment.connect(signers[1]).addWhitelist(investmentId,
                [signers[2].address, signers[3].address],
                [0, 30000],
                [maxAssetPerInvestor.add(100000), goalAsset.sub(raisedAmount)]);
            [minLimits, maxLimits] = await investment.connect(signers[1]).getWhitelistLimit(investmentId, [signers[2].address, signers[3].address]);
            expect(minLimits[0]).to.eq(1);
            expect(minLimits[1]).to.eq(30000);
            expect(maxLimits[0]).to.eq(maxAssetPerInvestor.add(100000));
            expect(maxLimits[1]).to.eq(goalAsset.sub(raisedAmount));

            let whitelist = await investment.connect(signers[1]).getWhitelist(investmentId);
            expect(whitelist.length).to.eq(3);

            let amount = BigNumber.from(10);
            if (!testEth) {
                await testToken.transfer(signers[2].address, amount);
                await testToken.connect(signers[2]).approve(investment.address, amount);
            }
            await investment.connect(signers[2]).invest(investmentId, amount, testEth ? { value: amount } : { value: 0 });
            raisedAmount = raisedAmount.add(amount);

            let brief = await investment.viewInvestment(investmentId);
            expect(brief.raisedAssetAmount).to.eq(raisedAmount);

            amount = maxAssetPerInvestor.add(100000).sub(100);
            if (!testEth) {
                await testToken.transfer(signers[2].address, amount);
                await testToken.connect(signers[2]).approve(investment.address, amount);
            }
            await investment.connect(signers[2]).invest(investmentId, amount, testEth ? { value: amount } : { value: 0 });
            raisedAmount = raisedAmount.add(amount);

            brief = await investment.viewInvestment(investmentId);
            expect(brief.raisedAssetAmount).to.eq(raisedAmount);

            let [min, max, invested, withdrawn] = await investment.connect(signers[2]).viewSelfInfo(investmentId);
            expect(invested).to.eq(amount.add(10));
            expect(min).to.eq(1);

            await expect(investment.connect(signers[2]).withdrawTokens(investmentId)).to.be.revertedWith("Cannot withdraw right now");
            await expect(investment.connect(signers[2]).refundAsset(investmentId)).to.be.revertedWith("Cannot refund right now");
        }

        {
            await expect(investment.finishInvestment(investmentId)).to.be.revertedWith("Not the end time");
            await expect(investment.withdrawAsset(investmentId)).to.be.revertedWith("Not successful");

            let amount = goalAsset.sub(raisedAmount);

            if (!testEth) {
                await testToken.transfer(signers[3].address, amount);
                await testToken.connect(signers[3]).approve(investment.address, amount);
            }
            await investment.connect(signers[3]).invest(investmentId, amount, testEth ? { value: amount } : { value: 0 });
            raisedAmount = raisedAmount.add(amount);

            const brief = await investment.viewInvestment(investmentId);
            expect(brief.raisedAssetAmount).to.greaterThanOrEqual(goalAsset);
        }

        {
            let investors = [signers[0].address, signers[1].address, signers[2].address, signers[3].address];
            let [investeds, withdrawns] = await investment.connect(signers[1]).viewInvestorsInfo(investmentId, investors);
            //时间快进到结束
            await hre.ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
            await hre.ethers.provider.send("evm_mine", []);

            let tx = await investment.finishInvestment(investmentId);
            let ret = await tx.wait();

            expect(ret.events?.length).to.equal(1);
            let event = ret.events![0];
            expect(event.event).to.eq("InvestmentStateChangeEvent");
            expect(event.args![1]).to.equal(1);
            expect(event.args![2]).to.equal(2);

            // 0 withdraw
            let [minLimit, maxLimit, assetAmount, withdrawn] = await investment.viewSelfInfo(investmentId);

            await expect(investment.refundAsset(investmentId)).to.be.revertedWith("Cannot refund right now");

            tx = await investment.withdrawTokens(investmentId);
            ret = await tx.wait();
            event = ret.events![1];
            expect(event.event).to.eq("WithdrawTokensEvent");

            expect(assetAmount).to.equal(event.args![1]);
            expect(assetAmount.mul(tokenExchangeRate).div(assetExchangeRate)).to.equal(event.args![2]);
            expect(investeds[0]).to.eq(assetAmount);

            await expect(investment.withdrawTokens(investmentId)).to.be.revertedWith("Already withdrawn");

            //3 withdraw
            [minLimit, maxLimit, assetAmount, withdrawn] = await investment.connect(signers[3]).viewSelfInfo(investmentId);

            tx = await investment.connect(signers[3]).withdrawTokens(investmentId);
            ret = await tx.wait();
            event = ret.events![1];
            expect(event.event).to.eq("WithdrawTokensEvent");

            expect(assetAmount).to.equal(event.args![1]);
            expect(assetAmount.mul(tokenExchangeRate).div(assetExchangeRate)).to.equal(event.args![2]);
            expect(investeds[3]).to.eq(assetAmount);

            // burn tokens
            let tokenBalance1 = await investment.getTokenBalance(investmentId);
            await investment.connect(signers[1]).burnUnAllocatedTokens(investmentId);
            let tokenBalance2 = await investment.getTokenBalance(investmentId);

            //2 withdraw
            [minLimit, maxLimit, assetAmount, withdrawn] = await investment.connect(signers[2]).viewSelfInfo(investmentId);

            tx = await investment.connect(signers[2]).withdrawTokens(investmentId);
            ret = await tx.wait();
            event = ret.events![1];
            expect(event.event).to.eq("WithdrawTokensEvent");

            expect(assetAmount).to.equal(event.args![1]);
            expect(assetAmount.mul(tokenExchangeRate).div(assetExchangeRate)).to.equal(event.args![2]);
            expect(investeds[2]).to.eq(assetAmount);

            expect(tokenBalance2).to.eq(event.args![2]);

            let tokenBalance3 = await investment.getTokenBalance(investmentId);
            expect(tokenBalance3).to.eq(0);

        }
        {
            // withdraw asset
            let aseetBalance1, assetBalance2;
            if (testEth) {
                aseetBalance1 = await hre.ethers.provider.getBalance(sourceDao.assetWallet());
            } else {
                aseetBalance1 = await testToken.balanceOf(sourceDao.assetWallet());
            }
            await investment.withdrawAsset(investmentId);
            if (testEth) {
                assetBalance2 = await hre.ethers.provider.getBalance(sourceDao.assetWallet());
            } else {
                assetBalance2 = await testToken.balanceOf(sourceDao.assetWallet());
            }

            const brief = await investment.viewInvestment(investmentId);
            expect(brief.raisedAssetAmount).to.eq(raisedAmount);

            expect(assetBalance2.sub(aseetBalance1)).to.eq(raisedAmount);
        }
    });
});
