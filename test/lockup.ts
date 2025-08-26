import { ethers, upgrades } from "hardhat";
import { DevToken, SourceDao, SourceDaoCommittee, SourceTokenLockup } from "../typechain-types";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { normalizeToBigInt } from "hardhat/common";
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import chai from "chai";

function convertVersion(version: string): number {
    let versions = version.split('.');
    if (versions.length < 3) {
        throw new Error(`Invalid version format: ${version}. Expected format is 'major.minor.patch'.`);
    }

    let major = parseInt(versions[0], 10);
    let minor = parseInt(versions[1], 10);
    let patch = parseInt(versions[2], 10);

    return major*10000000000+minor*100000+patch
}

function zeroPadLeft(value: number | string | undefined): string {
    if (undefined === value) {
        throw new Error('value is undefined')
    }
    const big = ethers.toBigInt(value.toString())
    const hex = ethers.toBeHex(big)
    const result = ethers.zeroPadValue(hex, 32)
    return result
}

describe("Lockup", function () {
    let signers: HardhatEthersSigner[];
    let dao: SourceDao;

    before(async function () {
        signers = await ethers.getSigners();

        // simple committee: only one member, the first signer
        const daoFactory = await ethers.getContractFactory('SourceDao')
        dao = await (await upgrades.deployProxy(daoFactory, undefined, {
            initializer: 'initialize',
            kind: "uups"
        })).waitForDeployment() as unknown as SourceDao;
        let daoAddr = await dao.getAddress();

        let committee = (await upgrades.deployProxy(
            await ethers.getContractFactory("SourceDaoCommittee"),
            [[signers[0].address], 1, 400, ethers.encodeBytes32String("SourceDao"), convertVersion("1.0.0"), 150, daoAddr],
            { kind: "uups" })) as unknown as SourceDaoCommittee;
        await(await dao.setCommitteeAddress(await committee.getAddress())).wait();

        // project contract
        const projectFactory = await ethers.getContractFactory("ProjectManagement")
        let project = await (await upgrades.deployProxy(projectFactory, [1, daoAddr], {
            initializer: 'initialize',
            kind: "uups"
        })).waitForDeployment();

        await (await dao.setProjectAddress(await project.getAddress())).wait();

        // dev token, total 10000, signer[0] get 5000
        const devTokenFactory = await ethers.getContractFactory('DevToken')
        let devToken = await (await upgrades.deployProxy(devTokenFactory, ["BDDT", "BDDT", 1000000, [signers[0].address], [5000], daoAddr], {
            initializer: 'initialize',
            kind: "uups"
        })).waitForDeployment() as unknown as DevToken;
        await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

        // normal token
        const normalTokenFactory = await ethers.getContractFactory('NormalToken')
        let normalToken = await (await upgrades.deployProxy(normalTokenFactory, ["BDT", "BDT", daoAddr], {
            initializer: 'initialize',
            kind: "uups"
        })).waitForDeployment();
        await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();

        // signer[0] exchange 2500 dev to normal
        // now 2500 dev and 2500 normal
        expect((await devToken.balanceOf(signers[0].address))).to.equal(5000n);

        await (await devToken.dev2normal(2500)).wait();

        // lockup
        const lockupFactory = await ethers.getContractFactory("SourceTokenLockup")
        let lockup = await (await upgrades.deployProxy(lockupFactory, [ethers.encodeBytes32String("SourceDao"), convertVersion("1.0.0"), daoAddr], {
            initializer: 'initialize',
            kind: "uups"
        })).waitForDeployment();
        await (await dao.setTokenLockupAddress(await lockup.getAddress())).wait();

        console.log("sourceDao address: ", daoAddr);
    })

    it("lockup to myself 1000", async function () {
        let lockup = await ethers.getContractAt("SourceTokenLockup", await dao.lockup());

        let devToken = await ethers.getContractAt("DevToken", await dao.devToken());
        let normalToken = await ethers.getContractAt("NormalToken", await dao.normalToken());

        expect((await devToken.balanceOf(signers[0].address))).to.equal(2500n);
        expect((await normalToken.balanceOf(signers[0].address))).to.equal(2500n);

        await (await devToken.approve(await lockup.getAddress(), 1000)).wait();
        await (await lockup.convertAndLock([signers[0].address], [1000])).wait();

        expect((await devToken.balanceOf(signers[0].address))).to.equal(1500n);

        await (await normalToken.approve(await lockup.getAddress(), 1000)).wait();
        await (await lockup.transferAndLock([signers[0].address], [1000])).wait();

        expect((await normalToken.balanceOf(signers[0].address))).to.equal(1500n);

        // 这里由于是自己转给自己，显示的是signer[0]有2000被锁定
        expect((await lockup.totalAssigned(signers[0].address))).to.equal(2000n);

        // 此时不能claim
        await expect(lockup.claimTokens(1000)).to.be.revertedWith("Tokens are not unlocked yet");
    })

    it("lockup to others 1000", async function () {
        let lockup = await ethers.getContractAt("SourceTokenLockup", await dao.lockup());

        let devToken = await ethers.getContractAt("DevToken", await dao.devToken());
        let normalToken = await ethers.getContractAt("NormalToken", await dao.normalToken());

        await (await devToken.approve(await lockup.getAddress(), 1000)).wait();
        await (await lockup.convertAndLock([signers[1].address], [1000])).wait();

        await (await normalToken.approve(await lockup.getAddress(), 1000)).wait();
        await (await lockup.transferAndLock([signers[1].address], [1000])).wait();

        expect((await devToken.balanceOf(signers[0].address))).to.equal(500);
        expect((await normalToken.balanceOf(signers[0].address))).to.equal(500);

        // signer[1] should have 2000 locked now
        expect((await lockup.totalAssigned(signers[1].address))).to.equal(2000n);

        // 此时不能claim
        await expect(lockup.connect(signers[1]).claimTokens(1000)).to.be.revertedWith("Tokens are not unlocked yet");
    });

    it("create release project", async function () {
        let project = await ethers.getContractAt("ProjectManagement", await dao.project());
        let committee = await ethers.getContractAt("SourceDaoCommittee", await dao.committee());

        let startDate = Math.floor(Date.now() / 1000);
        let endDate = startDate + 30*24*3600;
        await (await project.createProject(1000, ethers.encodeBytes32String("SourceDao"), convertVersion("1.0.0"), startDate, endDate, [], [])).wait()

        // vote for create, proposal 1
        await (await committee.support(1, [
            zeroPadLeft(1),                 // project id
            ethers.encodeBytes32String("SourceDao"), // name
            zeroPadLeft(convertVersion("1.0.0")),                 // version
            zeroPadLeft(startDate),
            zeroPadLeft(endDate),
            ethers.encodeBytes32String("createProject"),
        ])).wait();

        // execute proposal 1
        await (await project.promoteProject(1)).wait();

        // finish project
        await (await project.acceptProject(1, 4, [{contributor: signers[0].address, value: 100}])).wait();

        // vote for accept, proposal 2
        await (await committee.support(2, [
            zeroPadLeft(1),                 // project id
            ethers.encodeBytes32String("SourceDao"), // name
            zeroPadLeft(convertVersion("1.0.0")),                 // version
            zeroPadLeft(startDate),
            zeroPadLeft(endDate),
            ethers.encodeBytes32String("acceptProject"),
        ])).wait();

        // execute proposal 2
        await (await project.promoteProject(1)).wait();
    })

    it("after 30 days, claim tokens", async function () {
        await mine(2, { interval: 30*24*3600});
        // 此时最多可解锁 2000/6=333
        let lockup = await ethers.getContractAt("SourceTokenLockup", await dao.lockup());
        let normal = await ethers.getContractAt("NormalToken", await dao.normalToken());

        await expect(lockup.claimTokens(350)).to.be.revertedWith("Claim amount exceeds unlocked tokens");

        await expect(lockup.claimTokens(200)).to.be.changeTokenBalance(normal, signers[0], 200);
        expect((await lockup.totalClaimed(signers[0].address))).to.equal(200);


        await expect(lockup.connect(signers[1]).claimTokens(250)).to.be.changeTokenBalance(normal, signers[1], 250);
        expect((await lockup.totalClaimed(signers[1].address))).to.equal(250n);
    })

    it("after 180 days, claim all tokens", async function () {
        await mine(2, { interval: 150*24*3600});
        let lockup = await ethers.getContractAt("SourceTokenLockup", await dao.lockup());
        let normal = await ethers.getContractAt("NormalToken", await dao.normalToken());

        // signers[0] claim all remain 1800
        await expect(lockup.claimTokens(1800)).to.be.changeTokenBalance(normal, signers[0], 1800);
        expect((await lockup.totalClaimed(signers[0].address))).to.equal(2000n);

        // signers[0] claim all remain 1750
        await expect(lockup.connect(signers[1]).claimTokens(1750)).to.be.changeTokenBalance(normal, signers[1], 1750);
        expect((await lockup.totalClaimed(signers[1].address))).to.equal(2000n);
    })
})