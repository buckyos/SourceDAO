import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

async function deployModuleMocks(count: number) {
    const factory = await ethers.getContractFactory("NativeReceiverMock");
    const deployments = [];
    for (let i = 0; i < count; i++) {
        const contract = await factory.deploy();
        await contract.waitForDeployment();
        deployments.push(await contract.getAddress());
    }
    return deployments;
}

async function deployDaoFixture() {
    const signers = await ethers.getSigners();
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const moduleAddresses = await deployModuleMocks(8);

    return {
        dao,
        signers,
        bootstrapAdmin: signers[0],
        devTokenAddress: moduleAddresses[0],
        normalTokenAddress: moduleAddresses[1],
        committeeAddress: moduleAddresses[2],
        projectAddress: moduleAddresses[3],
        lockupAddress: moduleAddresses[4],
        dividendAddress: moduleAddresses[5],
        acquiredAddress: moduleAddresses[6],
        alternateModuleAddress: moduleAddresses[7],
        outsider: signers[8],
        outsiderAddress: signers[8].address
    };
}

describe("dao", function () {
    it("tracks the bootstrap admin and starts unfinalized", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoFixture);

        expect(await fixture.dao.bootstrapAdmin()).to.equal(fixture.bootstrapAdmin.address);
        expect(await fixture.dao.bootstrapFinalized()).to.equal(false);
    });

    it("rejects the legacy bootstrap migration on fresh deployments", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoFixture);

        await expect(fixture.dao.migrateLegacyBootstrap()).to.be.revertedWith("not legacy");
    });

    it("rejects zero and EOA addresses for every module slot", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoFixture);
        const zeroAddress = ethers.ZeroAddress;

        await expect(fixture.dao.setDevTokenAddress(zeroAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setDevTokenAddress(fixture.outsiderAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setNormalTokenAddress(zeroAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setNormalTokenAddress(fixture.outsiderAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setCommitteeAddress(zeroAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setCommitteeAddress(fixture.outsiderAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setProjectAddress(zeroAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setProjectAddress(fixture.outsiderAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setTokenLockupAddress(zeroAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setTokenLockupAddress(fixture.outsiderAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setTokenDividendAddress(zeroAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setTokenDividendAddress(fixture.outsiderAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setAcquiredAddress(zeroAddress)).to.be.revertedWith("invalid address");
        await expect(fixture.dao.setAcquiredAddress(fixture.outsiderAddress)).to.be.revertedWith("invalid address");
    });

    it("restricts bootstrap configuration and finalization to the bootstrap admin", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoFixture);

        await expect(
            fixture.dao.connect(fixture.outsider).setDevTokenAddress(fixture.devTokenAddress)
        ).to.be.revertedWith("only bootstrap admin");

        await expect(
            fixture.dao.connect(fixture.outsider).finalizeInitialization()
        ).to.be.revertedWith("only bootstrap admin");
    });

    it("stores each module address in the expected getter", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoFixture);

        await (await fixture.dao.setDevTokenAddress(fixture.devTokenAddress)).wait();
        await (await fixture.dao.setNormalTokenAddress(fixture.normalTokenAddress)).wait();
        await (await fixture.dao.setCommitteeAddress(fixture.committeeAddress)).wait();
        await (await fixture.dao.setProjectAddress(fixture.projectAddress)).wait();
        await (await fixture.dao.setTokenLockupAddress(fixture.lockupAddress)).wait();
        await (await fixture.dao.setTokenDividendAddress(fixture.dividendAddress)).wait();
        await (await fixture.dao.setAcquiredAddress(fixture.acquiredAddress)).wait();

        expect(await fixture.dao.devToken()).to.equal(fixture.devTokenAddress);
        expect(await fixture.dao.normalToken()).to.equal(fixture.normalTokenAddress);
        expect(await fixture.dao.committee()).to.equal(fixture.committeeAddress);
        expect(await fixture.dao.project()).to.equal(fixture.projectAddress);
        expect(await fixture.dao.lockup()).to.equal(fixture.lockupAddress);
        expect(await fixture.dao.dividend()).to.equal(fixture.dividendAddress);
        expect(await fixture.dao.acquired()).to.equal(fixture.acquiredAddress);
    });

    it("allows bootstrap corrections before finalization", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoFixture);

        await expect(fixture.dao.setDevTokenAddress(ethers.ZeroAddress)).to.be.revertedWith("invalid address");
        await (await fixture.dao.setDevTokenAddress(fixture.devTokenAddress)).wait();
        await (await fixture.dao.setDevTokenAddress(fixture.alternateModuleAddress)).wait();

        expect(await fixture.dao.devToken()).to.equal(fixture.alternateModuleAddress);
    });

    it("requires every module slot to be configured before finalization", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoFixture);

        await (await fixture.dao.setDevTokenAddress(fixture.devTokenAddress)).wait();
        await expect(fixture.dao.finalizeInitialization()).to.be.revertedWith("modules not configured");
    });

    it("freezes bootstrap configuration after finalization", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoFixture);

        await (await fixture.dao.setDevTokenAddress(fixture.devTokenAddress)).wait();
        await (await fixture.dao.setNormalTokenAddress(fixture.normalTokenAddress)).wait();
        await (await fixture.dao.setCommitteeAddress(fixture.committeeAddress)).wait();
        await (await fixture.dao.setProjectAddress(fixture.projectAddress)).wait();
        await (await fixture.dao.setTokenLockupAddress(fixture.lockupAddress)).wait();
        await (await fixture.dao.setTokenDividendAddress(fixture.dividendAddress)).wait();
        await (await fixture.dao.setAcquiredAddress(fixture.acquiredAddress)).wait();
        await (await fixture.dao.finalizeInitialization()).wait();

        expect(await fixture.dao.bootstrapFinalized()).to.equal(true);

        await expect(
            fixture.dao.setDevTokenAddress(fixture.alternateModuleAddress)
        ).to.be.revertedWith("bootstrap finalized");
        await expect(
            fixture.dao.finalizeInitialization()
        ).to.be.revertedWith("bootstrap finalized");
    });

    it("recognizes only configured module addresses and itself as DAO contracts", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoFixture);

        await (await fixture.dao.setDevTokenAddress(fixture.devTokenAddress)).wait();
        await (await fixture.dao.setNormalTokenAddress(fixture.normalTokenAddress)).wait();
        await (await fixture.dao.setCommitteeAddress(fixture.committeeAddress)).wait();
        await (await fixture.dao.setProjectAddress(fixture.projectAddress)).wait();
        await (await fixture.dao.setTokenLockupAddress(fixture.lockupAddress)).wait();
        await (await fixture.dao.setTokenDividendAddress(fixture.dividendAddress)).wait();
        await (await fixture.dao.setAcquiredAddress(fixture.acquiredAddress)).wait();
        await (await fixture.dao.finalizeInitialization()).wait();

        expect(await fixture.dao.isDAOContract(await fixture.dao.getAddress())).to.equal(true);
        expect(await fixture.dao.isDAOContract(fixture.devTokenAddress)).to.equal(true);
        expect(await fixture.dao.isDAOContract(fixture.normalTokenAddress)).to.equal(true);
        expect(await fixture.dao.isDAOContract(fixture.committeeAddress)).to.equal(true);
        expect(await fixture.dao.isDAOContract(fixture.projectAddress)).to.equal(true);
        expect(await fixture.dao.isDAOContract(fixture.lockupAddress)).to.equal(true);
        expect(await fixture.dao.isDAOContract(fixture.dividendAddress)).to.equal(true);
        expect(await fixture.dao.isDAOContract(fixture.acquiredAddress)).to.equal(true);
        expect(await fixture.dao.isDAOContract(fixture.outsiderAddress)).to.equal(false);
    });
});
