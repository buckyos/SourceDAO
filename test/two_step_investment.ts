import {ethers, upgrades} from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { SourceDao, SourceDaoToken, TestToken, TwoStepWhitelistInvestment } from "../typechain-types";


describe("TwoStepInvestment", () => {
    let sourceDao: SourceDao;
    let daoToken: SourceDaoToken;
    let investment: TwoStepWhitelistInvestment;
    let testToken: TestToken;

    let signers: HardhatEthersSigner[];
    
    before(async () => {
        signers = await ethers.getSigners();
        const SourceDao = await ethers.getContractFactory("SourceDao");
        sourceDao = await SourceDao.deploy();

        // deploy dao token
        const SourceDaoToken = await ethers.getContractFactory("SourceDaoToken");
        daoToken = (await upgrades.deployProxy(SourceDaoToken, [
            "BuckyOS DAO Token", "BDT", ethers.parseEther("1000000"), [signers[1].address, signers[2].address], [ethers.parseEther("10000"), ethers.parseEther("10000")], await sourceDao.getAddress()
        ], {kind: "uups"})) as unknown as SourceDaoToken;
        await sourceDao.setTokenAddress(await daoToken.getAddress());

        // depoly two step investment
        const TwoStepWhitelistInvestment = await ethers.getContractFactory("TwoStepWhitelistInvestment");
        investment = (await upgrades.deployProxy(TwoStepWhitelistInvestment, [await sourceDao.getAddress()], {kind: "uups"})) as unknown as TwoStepWhitelistInvestment;

        // depoly a test token
        const TestToken = await ethers.getContractFactory("TestToken");
        testToken = await TestToken.deploy(ethers.parseUnits("1000000", 6));

        //
    })

    it("start invalid investment", async () => {
        await expect(investment.startInvestment({
            whitelist: [signers[0].address, signers[1].address],
            firstPercent: [10],
            tokenAddress: await testToken.getAddress(),
            tokenAmount: 1000,
            tokenRatio: {tokenAmount: 1, daoTokenAmount: 1},
            step1Duration: 24*60*60,
            step2Duration: 24*60*60,
            canEndEarly: false,
        })).to.be.revertedWith("whitelist and firstPercent length not equal");

        await expect(investment.startInvestment({
            whitelist: [signers[0].address, signers[1].address],
            firstPercent: [1000, 10000],
            tokenAddress: await testToken.getAddress(),
            tokenAmount: 1000,
            tokenRatio: {tokenAmount: 1, daoTokenAmount: 1},
            step1Duration: 24*60*60,
            step2Duration: 24*60*60,
            canEndEarly: false,
        })).to.be.revertedWith("total percents over 100");

        await expect(investment.startInvestment({
            whitelist: [signers[0].address, signers[1].address],
            firstPercent: [10, 90],
            tokenAddress: await testToken.getAddress(),
            tokenAmount: 0,
            tokenRatio: {tokenAmount: 1, daoTokenAmount: 1},
            step1Duration: 24*60*60,
            step2Duration: 24*60*60,
            canEndEarly: false,
        })).to.be.revertedWith("invalid tokenAmount");

        await expect(investment.startInvestment({
            whitelist: [signers[0].address, signers[1].address],
            firstPercent: [10, 90],
            tokenAddress: await testToken.getAddress(),
            tokenAmount: 1000,
            tokenRatio: {tokenAmount: 1, daoTokenAmount: 0},
            step1Duration: 24*60*60,
            step2Duration: 24*60*60,
            canEndEarly: false,
        })).to.be.revertedWith("invalid tokenRatio");

        await expect(investment.startInvestment({
            whitelist: [signers[0].address, signers[1].address],
            firstPercent: [10, 90],
            tokenAddress: ethers.ZeroAddress,
            tokenAmount: 10,
            tokenRatio: {tokenAmount: 1, daoTokenAmount: 1},
            step1Duration: 24*60*60,
            step2Duration: 24*60*60,
            canEndEarly: false,
        }, {value: 5})).to.be.revertedWith("main token not enough");

        await expect(investment.startInvestment({
            whitelist: [signers[0].address, signers[1].address],
            firstPercent: [10, 90],
            tokenAddress: await daoToken.getAddress(),
            tokenAmount: 10,
            tokenRatio: {tokenAmount: 1, daoTokenAmount: 1},
            step1Duration: 24*60*60,
            step2Duration: 24*60*60,
            canEndEarly: false,
        }, {value: 5})).to.be.revertedWith("cannot invest dao token");

        await expect(investment.invest(1, 10)).to.be.revertedWith("investment not exist");
    })

    it("normal token investment", async() => {
        await testToken.approve(await investment.getAddress(), ethers.parseUnits("500", await testToken.decimals()));
        let createTx = await investment.startInvestment({
            whitelist: [signers[1].address, signers[2].address],
            firstPercent: [4000, 6000],
            tokenAddress: await testToken.getAddress(),
            tokenAmount: ethers.parseUnits("500", await testToken.decimals()),
            tokenRatio: {tokenAmount: 5, daoTokenAmount: 1},
            step1Duration: 24*60*60,
            step2Duration: 24*60*60,
            canEndEarly: false,
        });

        await expect(createTx).to.be.emit(investment, "InvestmentStart");
        await expect(createTx).to.changeTokenBalance(testToken, signers[0], ethers.parseUnits("-500", await testToken.decimals()));

        // step 1 invest
        // signer 1 max invest 40，get 200
        // signer 2 max invest 60, get 300
        await daoToken.connect(signers[1]).approve(await investment.getAddress(), ethers.parseEther("40"));
        await daoToken.connect(signers[2]).approve(await investment.getAddress(), ethers.parseEther("80"));
        console.log("signers 1 invest 20")
        let invest1Tx = await investment.connect(signers[1]).invest(1, ethers.parseEther("20"));
        await expect(invest1Tx).to.be.changeTokenBalance(daoToken, signers[1], ethers.parseEther("-20"));
        await expect(invest1Tx).to.changeTokenBalance(testToken, signers[1], ethers.parseUnits("100", await testToken.decimals()));

        await expect(investment.connect(signers[1]).invest(1, ethers.parseEther("30"))).to.be.revertedWith("over limit");
        await expect(investment.connect(signers[3]).invest(1, ethers.parseEther("30"))).to.be.revertedWith("not in whitelist");
        await expect(investment.connect(signers[0]).endInventment(1)).to.be.revertedWith("not all token sold out");

        console.log("signers 2 invest 60")
        let invest2Tx = await investment.connect(signers[2]).invest(1, ethers.parseEther("60"));
        await expect(invest2Tx).to.be.changeTokenBalance(daoToken, signers[2], ethers.parseEther("-60"));
        await expect(invest2Tx).to.changeTokenBalance(testToken, signers[2], ethers.parseUnits("300", await testToken.decimals()));
        await expect(investment.connect(signers[2]).invest(1, ethers.parseEther("1"))).to.be.revertedWith("over limit");

        // step 2 invest
        // remain 500-100-300=100
        mine(2, {interval: 24*60*60});
        await expect(investment.connect(signers[2]).invest(1, ethers.parseEther("30"))).to.be.revertedWith("not enough token");
        console.log("signers 2 invest 10")
        let invest3Tx = await investment.connect(signers[2]).invest(1, ethers.parseEther("10"));
        await expect(invest3Tx).to.be.changeTokenBalance(daoToken, signers[2], ethers.parseEther("-10"));
        await expect(invest3Tx).to.changeTokenBalance(testToken, signers[2], ethers.parseUnits("50", await testToken.decimals()));
        await expect(investment.connect(signers[0]).endInventment(1)).to.be.revertedWith("not all token sold out");

        // end invest
        mine(2, {interval: 24*60*60});
        await expect(investment.connect(signers[1]).invest(1, ethers.parseEther("10"))).to.be.revertedWith("investment end");
        console.log("signers 0 end investment")
        let investEndTx = await investment.connect(signers[0]).endInventment(1);
        await expect(investEndTx).to.be.changeTokenBalance(testToken, signers[0], ethers.parseUnits("50", await testToken.decimals()));
        await expect(investEndTx).to.changeTokenBalance(daoToken, signers[0], ethers.parseEther("90"));

        await expect(investment.connect(signers[1]).invest(1, 10)).to.be.revertedWith("investment end");
    })

    it("eth token investment", async() => {
        let createTx = await investment.startInvestment({
            whitelist: [signers[1].address, signers[2].address],
            firstPercent: [4000, 6000],
            tokenAddress: ethers.ZeroAddress,
            tokenAmount: 20,
            tokenRatio: {tokenAmount: 1, daoTokenAmount: 5},
            step1Duration: 24*60*60,
            step2Duration: 24*60*60,
            canEndEarly: false,
        }, {value: 20});

        await expect(createTx).to.be.emit(investment, "InvestmentStart");
        await expect(createTx).to.changeEtherBalance(signers[0], -20);

        // step 1 invest
        // signer 1 max invest 40, get 8
        // signer 2 max invest 60, get 12
        await daoToken.connect(signers[1]).approve(await investment.getAddress(), 40);
        await daoToken.connect(signers[2]).approve(await investment.getAddress(), 80);
        console.log("signers 1 invest 20")
        let invest1Tx = await investment.connect(signers[1]).invest(2, 20);
        await expect(invest1Tx).to.be.changeTokenBalance(daoToken, signers[1], -20);
        await expect(invest1Tx).to.changeEtherBalance(signers[1], 4);

        await expect(investment.connect(signers[1]).invest(2, 30)).to.be.revertedWith("over limit");
        await expect(investment.connect(signers[3]).invest(2, 30)).to.be.revertedWith("not in whitelist");
        await expect(investment.connect(signers[0]).endInventment(2)).to.be.revertedWith("not all token sold out");

        console.log("signers 2 invest 60")
        let invest2Tx = await investment.connect(signers[2]).invest(2, 60);
        await expect(invest2Tx).to.be.changeTokenBalance(daoToken, signers[2], -60);
        await expect(invest2Tx).to.changeEtherBalance(signers[2], 12);
        await expect(investment.connect(signers[2]).invest(2, 1)).to.be.revertedWith("invalid amount");
        await expect(investment.connect(signers[2]).invest(2, 5)).to.be.revertedWith("over limit");

        // step 2 invest
        // remain 20-4-12=4
        mine(2, {interval: 24*60*60});
        await expect(investment.connect(signers[2]).invest(2, 30)).to.be.revertedWith("not enough token");
        console.log("signers 2 invest 10")
        let invest3Tx = await investment.connect(signers[2]).invest(2, 10);
        await expect(invest3Tx).to.be.changeTokenBalance(daoToken, signers[2], -10);
        await expect(invest3Tx).to.changeEtherBalance(signers[2], 2);
        await expect(investment.connect(signers[0]).endInventment(2)).to.be.revertedWith("not all token sold out");

        // end invest
        mine(2, {interval: 24*60*60});
        await expect(investment.connect(signers[1]).invest(2, 10)).to.be.revertedWith("investment end");
        console.log("signers 0 end investment")
        let investEndTx = await investment.connect(signers[0]).endInventment(2);
        await expect(investEndTx).to.be.changeEtherBalance(signers[0], 2);
        await expect(investEndTx).to.changeTokenBalance(daoToken, signers[0], 90);

        await expect(investment.connect(signers[1]).invest(2, 10)).to.be.revertedWith("investment end");
    })

    it("test end", async () => {
        await testToken.approve(await investment.getAddress(), ethers.parseUnits("200", await testToken.decimals()));
        let createTx = await investment.startInvestment({
            whitelist: [signers[1].address, signers[2].address],
            firstPercent: [4000, 6000],
            tokenAddress: await testToken.getAddress(),
            tokenAmount: ethers.parseUnits("100", await testToken.decimals()),
            tokenRatio: {tokenAmount: 1, daoTokenAmount: 1},
            step1Duration: 24*60*60,
            step2Duration: 24*60*60,
            canEndEarly: false,
        });

        await expect(createTx).to.be.emit(investment, "InvestmentStart");
        await expect(createTx).to.changeTokenBalance(testToken, signers[0], ethers.parseUnits("-100" ,await testToken.decimals()));

        await daoToken.connect(signers[1]).approve(await investment.getAddress(), ethers.parseEther("100"));
        await daoToken.connect(signers[2]).approve(await investment.getAddress(), ethers.parseEther("200"));

        await (await investment.connect(signers[1]).invest(3, ethers.parseEther("40"))).wait();
        await (await investment.connect(signers[2]).invest(3, ethers.parseEther("60"))).wait();

        let endTx = await investment.endInventment(3);

        await expect(endTx).to.be.changeTokenBalance(daoToken, signers[0], ethers.parseEther("100"));

        await (await investment.startInvestment({
            whitelist: [signers[1].address, signers[2].address],
            firstPercent: [4000, 6000],
            tokenAddress: await testToken.getAddress(),
            tokenAmount: ethers.parseUnits("100", await testToken.decimals()),
            tokenRatio: {tokenAmount: 1, daoTokenAmount: 1},
            step1Duration: 24*60*60,
            step2Duration: 24*60*60,
            canEndEarly: true,
        })).wait();

        await (await investment.connect(signers[1]).invest(4, ethers.parseEther("40"))).wait();
        let endTx2 = await investment.endInventment(4);

        await expect(endTx2).to.be.changeTokenBalance(daoToken, signers[0], ethers.parseEther("40"));
        await expect(endTx2).to.be.changeTokenBalance(testToken, signers[0], ethers.parseUnits("60", await testToken.decimals()));
    })

    it("param test", async() => {
        await expect(investment.startInvestment({
            "whitelist": [
                "0x2514d2FEAAC3bFD8361333d1341dC8823595f744"
            ],
            "firstPercent": [
                100
            ],
            "tokenAddress": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
            "tokenAmount": 1,
            "tokenRatio": {
                "tokenAmount": 1,
                "daoTokenAmount": 100
            },
            "step1Duration": 29678,
            "step2Duration": 116078,
            "canEndEarly": true
        })).to.be.ok;
    })
});