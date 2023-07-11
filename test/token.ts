import hre, { ethers, upgrades } from "hardhat";
import { SourceDaoCommittee, SourceDao, SourceDaoToken, SourceTokenLockup, DividendContract } from "../typechain-types";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { assert, expect } from "chai";
import fs from 'node:fs';

describe("token", () => {
    async function deployContracts() {
        const signers = await ethers.getSigners();
        let committees = [];
        for (let i = 0; i < 5; i++) {
            committees.push(signers[i].address);
        }
        console.log(`comittees ${JSON.stringify(committees)}`);

        console.log('deploy committee contract')
        const CommitteeFactory = await ethers.getContractFactory("SourceDaoCommittee");

        const committee = await (await upgrades.deployProxy(CommitteeFactory, [committees], { kind: "uups" })).deployed() as SourceDaoCommittee;
        console.log('committee proxy address', committee.address);

        console.log('deploy SourceDaoToken contract')
        const TokenFactory = await ethers.getContractFactory("SourceDaoToken");

        // 转化为 BigNumber 类型
        let initialSupply = ethers.BigNumber.from("2100000000");

        const token = await (await upgrades.deployProxy(TokenFactory, [initialSupply.toString()], { kind: "uups" })).deployed() as SourceDaoToken;
        console.log('token proxy address', token.address);

        console.log('deploy SourceTokenLockup contract')
        const TokenLockupFactory = await ethers.getContractFactory("SourceTokenLockup");

        const tokenLockup = await (await upgrades.deployProxy(TokenLockupFactory, [], { kind: "uups" })).deployed() as SourceTokenLockup;
        console.log('SourceTokenLockup proxy address', tokenLockup.address);

        const DividendContract = await ethers.getContractFactory("DividendContract");
        const dividend = await (await upgrades.deployProxy(DividendContract, { kind: "uups" })).deployed() as DividendContract;

        console.log('deploy main contract')
        const MainFactory = await ethers.getContractFactory("SourceDao");

        const dao = await (await upgrades.deployProxy(MainFactory, undefined, { kind: "uups" })).deployed() as SourceDao;
        console.log('main proxy address', dao.address);

        console.log('set committee address to main');
        await (await dao.setCommitteeAddress(committee.address)).wait();
        await (await dao.setTokenAddress(token.address)).wait();
        await (await dao.setTokenLockupAddress(tokenLockup.address)).wait();

        console.log('set main address to committee');
        await (await committee.setMainContractAddress(dao.address)).wait();

        await (await token.setMainContractAddress(dao.address)).wait();
        await (await tokenLockup.setMainContractAddress(dao.address)).wait();
        await dividend.setMainContractAddress(dao.address);

        const TestToken = await hre.ethers.getContractFactory("TestToken");
        const testToken = await TestToken.deploy(10000000);

        return { signers, committees, committee, token, tokenLockup, dao, dividend, testToken };
    }

    it("test lockup and unlock", async function () {
        const { signers, committees, committee, token, tokenLockup, dao } = await loadFixture(deployContracts);

        {
            let total = await token.totalSupply();
            console.log("total ", total);

            let release = await token.totalReleased();
            let unreleased = await token.totalUnreleased();
            let total1 = release.add(unreleased);

            console.log("released: ", release, "unreleased: ", unreleased, "calc total: ", total1);
        }

        const amount1 = ethers.BigNumber.from("1000").mul(ethers.BigNumber.from("10").pow(18));
        const amount2 = ethers.BigNumber.from("2000").mul(ethers.BigNumber.from("10").pow(18));

        const params = [[signers[0].address, signers[1].address], [amount1, amount2]];
        const receipt = await (await tokenLockup.prepareDepositTokens(3600 * 24, ...params)).wait();
        // console.log(receipt);

        let proposalId;
        for (let e of receipt.events!) {
            if (e.event === "TokensPrepareDeposit") {
                proposalId = e.args![0];
            }
        }

        console.log('deposit proposal id', proposalId);

        for (const signer of signers) {
            if (committees.includes(signer.address)) {
                console.log(`committee ${signer.address} support despoit`);
                await (await committee.connect(signer).support(proposalId)).wait()
            }
        }

        const receipt1 = await (await tokenLockup.depositTokens(proposalId, ...params)).wait();
        // console.log(receipt1);
        for (let e of receipt1.events!) {
            if (e.event === "TokensDeposited") {
                const total = e.args![1];
                console.log(`token deposited: total=${total}`);
                expect(total === 3000);
            }
        }

        {
            let total = await token.totalSupply();
            console.log("total2: ", total);

            let release = await token.totalReleased();
            let unreleased = await token.totalUnreleased();
            let total1 = release.add(unreleased);

            console.log("released: ", release, "unreleased: ", unreleased, "calc total: ", total1);
        }

        {
            let count = await tokenLockup.connect(signers[0]).totalAssigned(signers[0].address);
            console.log("count: {}", count);

            expect(count).to.equal(ethers.BigNumber.from(1000).mul(ethers.BigNumber.from("10").pow(18)));

            let unlockedCount = await tokenLockup.connect(signers[0]).totalUnlocked(signers[0].address);
            console.log("unlocked count: {}", count);

            expect(unlockedCount).to.equal(ethers.BigNumber.from(0).mul(ethers.BigNumber.from("10").pow(18)));
        }

        // test error claim
        {
            const amount2 = ethers.BigNumber.from("1000").mul(ethers.BigNumber.from("10").pow(18));
            await expect(tokenLockup.connect(signers[1]).claimTokens(amount2)).to.be.revertedWith("Insufficient unlocked tokens");

            const got = await token.balanceOf(signers[1].address);
            console.log("claim token: {}", got);

            expect(got).to.equal(ethers.BigNumber.from("0"));
        }

        // test unlock
        {
            const amount1 = ethers.BigNumber.from("500").mul(ethers.BigNumber.from("10").pow(18));
            const amount2 = ethers.BigNumber.from("1000").mul(ethers.BigNumber.from("10").pow(18));

            const params = [[signers[0].address, signers[1].address], [amount1, amount2]];
            const receipt = await (await tokenLockup.prepareUnlockTokens(3600 * 24, ...params)).wait();
            // console.log(receipt);

            let proposalId;
            for (let e of receipt.events!) {
                if (e.event === "TokensPrepareUnlock") {
                    proposalId = e.args![0];
                }
            }

            console.log('unlock proposal id', proposalId);

            for (const signer of signers) {
                if (committees.includes(signer.address)) {
                    console.log(`committee ${signer.address} support unlock`);
                    await (await committee.connect(signer).support(proposalId)).wait()
                }
            }

            const receipt1 = await (await tokenLockup.unlockTokens(proposalId, ...params)).wait();
            // console.log(receipt1);
            for (let e of receipt1.events!) {
                if (e.event === "TokensUnlocked") {
                    const total = e.args[1];
                    console.log(`token unlocked: total=${total}`);
                }
            }
        }

        // test error unlock
        {
            const amount1 = ethers.BigNumber.from("5000").mul(ethers.BigNumber.from("10").pow(18));

            const params = [[signers[0].address], [amount1]];
            await expect(tokenLockup.prepareUnlockTokens(3600 * 24, ...params)).to.be.rejectedWith("Insufficient locked tokens");
        }

        // test balance for user0
        {
            let count = await tokenLockup.connect(signers[0]).totalAssigned(signers[0].address);
            console.log("count: {}", count);

            expect(count).to.equal(ethers.BigNumber.from(1000).mul(ethers.BigNumber.from("10").pow(18)));

            let unlockedCount = await tokenLockup.connect(signers[0]).totalUnlocked(signers[0].address);
            console.log("unlocked count: {}", count);

            expect(unlockedCount).to.equal(ethers.BigNumber.from(500).mul(ethers.BigNumber.from("10").pow(18)));
        }

        // test claim for user1
        {
            const amount2 = ethers.BigNumber.from("1000").mul(ethers.BigNumber.from("10").pow(18));
            await tokenLockup.connect(signers[1]).claimTokens(amount2);

            const got = await token.balanceOf(signers[1].address);
            console.log("claim token: {}", got);
            expect(got).to.equal(ethers.BigNumber.from("1000").mul(ethers.BigNumber.from("10").pow(18)));

            const amount3 = ethers.BigNumber.from("1").mul(ethers.BigNumber.from("10").pow(18));
            await expect(tokenLockup.connect(signers[1]).claimTokens(amount3)).to.be.revertedWith("Insufficient unlocked tokens");
        }


        // test balance for user1, 2000 and claim 1000 already
        {
            let count = await tokenLockup.connect(signers[1]).totalAssigned(signers[1].address);
            console.log("count: {}", count);

            expect(count).to.equal(ethers.BigNumber.from(1000).mul(ethers.BigNumber.from("10").pow(18)));

            let unlockedCount = await tokenLockup.connect(signers[1]).totalUnlocked(signers[1].address);
            console.log("unlocked count: {}", count);

            expect(unlockedCount).to.equal(ethers.BigNumber.from(0).mul(ethers.BigNumber.from("10").pow(18)));
        }

        // test error claim by unknown address
        {
            const amount = ethers.BigNumber.from("1").mul(ethers.BigNumber.from("10").pow(18));
            await expect(tokenLockup.connect(signers[10]).claimTokens(amount)).to.be.revertedWith("Insufficient unlocked tokens");
        }
    });

    it("test dividend", async () => {
        const { signers, committees, committee, token, tokenLockup, dao, dividend, testToken } = await loadFixture(deployContracts);

        {
            const receipt = await (await dividend.prepareChangeState(3600 * 24, 1, 1)).wait();
            // console.log(receipt);

            let proposalId;
            for (let e of receipt.events!) {
                if (e.event === "DividendStateChangeRequested") {
                    proposalId = e.args![0];
                }
            }

            console.log('change state proposal id', proposalId);

            for (const signer of signers) {
                if (committees.includes(signer.address)) {
                    console.log(`committee ${signer.address} support change state`);
                    await (await committee.connect(signer).support(proposalId)).wait()
                }
            }

            const receipt1 = await (await dividend.changeState(proposalId, 1, 1)).wait();
            // console.log(receipt1);
            for (let e of receipt1.events!) {
                if (e.event === "DividendStateChanged") {
                    const enable = e.args![1];
                    console.log(`state changed: enable=${enable}`);
                    expect(enable);
                }
            }
        }

        const amount1 = ethers.BigNumber.from("1000").mul(ethers.BigNumber.from("10").pow(18));
        const amount2 = ethers.BigNumber.from("2000").mul(ethers.BigNumber.from("10").pow(18));
        const amount3 = ethers.BigNumber.from("3000").mul(ethers.BigNumber.from("10").pow(18));

        const addressList = [signers[0].address, signers[1].address, signers[3].address];
        const amountList = [amount1, amount2, amount3];

        let proposalId;
        {
            await expect(tokenLockup.connect(signers[9]).prepareDepositTokens(24 * 3600, addressList, amountList)).to.be.revertedWith("Only committee members can call this");
        }
        {
            let tx = await tokenLockup.prepareDepositTokens(24 * 3600, addressList, amountList);
            let ret = await tx.wait();
            expect(ret.events?.length).equal(2);
            expect(ret.events![1].event).equal("TokensPrepareDeposit");
            proposalId = ret.events![1].args![0];
        }

        for (const signer of signers) {
            if (committees.includes(signer.address)) {
                console.log(`committee ${signer.address} support unlock`);
                await (await committee.connect(signer).support(proposalId)).wait()
            }
        }

        await expect(dividend.connect(signers[3]).withdraw(ethers.BigNumber.from("200").mul(ethers.BigNumber.from("10").pow(18)))).revertedWith("Not enough tokens in circulation");
        {
            await expect(tokenLockup.connect(signers[9]).depositTokens(proposalId, addressList, amountList)).revertedWith("Only committee members can call this");
        }

        await tokenLockup.depositTokens(proposalId, addressList, amountList);

        {
            expect(await tokenLockup.totalAssigned(signers[0].address)).equal(amount1);
            expect(await tokenLockup.totalAssigned(signers[1].address)).equal(amount2);
            expect(await tokenLockup.totalAssigned(signers[2].address)).equal(0);
            expect(await tokenLockup.totalAssigned(signers[3].address)).equal(amount3);
            expect(await tokenLockup.totalUnlocked(signers[0].address)).equal(0);
            expect(await tokenLockup.totalUnlocked(signers[1].address)).equal(0);
            expect(await tokenLockup.totalUnlocked(signers[3].address)).equal(0);
            expect(await tokenLockup.totalLocked(signers[0].address)).equal(amount1);
            expect(await tokenLockup.totalLocked(signers[1].address)).equal(amount2);
            expect(await tokenLockup.totalLocked(signers[3].address)).equal(amount3);
            await expect(tokenLockup.connect(signers[0]).claimTokens(0)).revertedWith("Invalid claim amount");
            await expect(tokenLockup.connect(signers[0]).claimTokens(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10")).pow(18))).revertedWith("Insufficient unlocked tokens");
            await expect(tokenLockup.connect(signers[1]).claimTokens(0)).revertedWith("Invalid claim amount");
            await expect(tokenLockup.connect(signers[1]).claimTokens(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10")).pow(18))).revertedWith("Insufficient unlocked tokens");
            await expect(tokenLockup.connect(signers[3]).claimTokens(0)).revertedWith("Invalid claim amount");
            await expect(tokenLockup.connect(signers[3]).claimTokens(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10")).pow(18))).revertedWith("Insufficient unlocked tokens");
            await expect(tokenLockup.connect(signers[2]).claimTokens(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10")).pow(18))).revertedWith("Insufficient unlocked tokens");
        }

        {
            const amount1 = ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10").pow(18));
            const amount2 = ethers.BigNumber.from("200").mul(ethers.BigNumber.from("10").pow(18));
            const amount3 = ethers.BigNumber.from("200").mul(ethers.BigNumber.from("10").pow(18));
            const amountList = [amount1, amount2, amount3];

            let proposalId;
            {
                await expect(tokenLockup.connect(signers[9]).prepareUnlockTokens(24 * 3600, addressList, amountList)).to.be.revertedWith("Only committee members can call this");
            }
            {
                let tx = await tokenLockup.prepareUnlockTokens(24 * 3600, addressList, amountList);
                let ret = await tx.wait();
                expect(ret.events?.length).equal(2);
                expect(ret.events![1].event).equal("TokensPrepareUnlock");
                proposalId = ret.events![1].args![0];
            }

            for (const signer of signers) {
                if (committees.includes(signer.address)) {
                    console.log(`committee ${signer.address} support unlock`);
                    await (await committee.connect(signer).support(proposalId)).wait()
                }
            }

            {
                await expect(tokenLockup.connect(signers[9]).unlockTokens(proposalId, addressList, amountList)).revertedWith("Only committee members can call this");
            }

            await tokenLockup.unlockTokens(proposalId, addressList, amountList);

            {
                expect(await tokenLockup.totalAssigned(signers[0].address)).equal(ethers.BigNumber.from("1000").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalAssigned(signers[1].address)).equal(ethers.BigNumber.from("2000").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalAssigned(signers[3].address)).equal(ethers.BigNumber.from("3000").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalUnlocked(signers[0].address)).equal(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalUnlocked(signers[1].address)).equal(ethers.BigNumber.from("200").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalUnlocked(signers[3].address)).equal(ethers.BigNumber.from("200").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalLocked(signers[0].address)).equal(ethers.BigNumber.from("900").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalLocked(signers[1].address)).equal(ethers.BigNumber.from("1800").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalLocked(signers[3].address)).equal(ethers.BigNumber.from("2800").mul(ethers.BigNumber.from("10").pow(18)));
            }
            await expect(tokenLockup.connect(signers[0]).claimTokens(ethers.BigNumber.from("200").mul(ethers.BigNumber.from("10").pow(18)))).revertedWith("Insufficient unlocked tokens");
            await tokenLockup.connect(signers[0]).claimTokens(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10").pow(18)));
            await tokenLockup.connect(signers[1]).claimTokens(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10").pow(18)));
            await tokenLockup.connect(signers[3]).claimTokens(ethers.BigNumber.from("200").mul(ethers.BigNumber.from("10").pow(18)));
            await expect(tokenLockup.connect(signers[2]).claimTokens(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10").pow(18)))).revertedWith("Insufficient unlocked tokens");

            {
                expect(await tokenLockup.totalAssigned(signers[0].address)).equal(ethers.BigNumber.from("900").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalAssigned(signers[1].address)).equal(ethers.BigNumber.from("1900").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalAssigned(signers[3].address)).equal(ethers.BigNumber.from("2800").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalUnlocked(signers[0].address)).equal(0);
                expect(await tokenLockup.totalUnlocked(signers[1].address)).equal(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalUnlocked(signers[3].address)).equal(0);
                expect(await tokenLockup.totalLocked(signers[0].address)).equal(ethers.BigNumber.from("900").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalLocked(signers[1].address)).equal(ethers.BigNumber.from("1800").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await tokenLockup.totalLocked(signers[3].address)).equal(ethers.BigNumber.from("2800").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await token.balanceOf(signers[0].address)).equal(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await token.balanceOf(signers[1].address)).equal(ethers.BigNumber.from("100").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await token.balanceOf(signers[2].address)).equal(0);
                expect(await token.balanceOf(signers[3].address)).equal(ethers.BigNumber.from("200").mul(ethers.BigNumber.from("10").pow(18)));
                expect(await token.totalInCirculation()).equal(ethers.BigNumber.from("500").mul(ethers.BigNumber.from("10").pow(18)));
            }

            await testToken.approve(dividend.address, 100000);
            await dividend.deposit(100000, testToken.address);

            await signers[9].sendTransaction({
                to: dividend.address,
                value: hre.ethers.utils.parseEther("500")
            });

            let balance = await signers[3].provider!.getBalance(signers[3].address);
            console.log(`${balance}`);
            await token.connect(signers[3]).approve(dividend.address, ethers.BigNumber.from("200").mul(ethers.BigNumber.from("10").pow(18)));
            await dividend.connect(signers[3]).withdraw(ethers.BigNumber.from("200").mul(ethers.BigNumber.from("10").pow(18)));
            expect((await signers[3].provider!.getBalance(signers[3].address)).div(ethers.BigNumber.from("10").pow(15))).equal(balance.add(hre.ethers.utils.parseEther("200")).div(ethers.BigNumber.from("10").pow(15)));
            expect(await testToken.balanceOf(signers[3].address)).equal(40000);

            expect(await token.totalInCirculation()).equal(ethers.BigNumber.from("300").mul(ethers.BigNumber.from("10").pow(18)));
        }


    });
});
