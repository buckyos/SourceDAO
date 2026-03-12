import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

async function deployDaoFixture() {
    const signers = await ethers.getSigners();
    const dao = await deployUUPSProxy(ethers, "SourceDao");

    return {
        dao,
        devTokenAddress: signers[1].address,
        normalTokenAddress: signers[2].address,
        committeeAddress: signers[3].address,
        projectAddress: signers[4].address,
        lockupAddress: signers[5].address,
        dividendAddress: signers[6].address,
        acquiredAddress: signers[7].address,
        outsiderAddress: signers[8].address
    };
}

describe("dao", function () {
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

    it("allows each module address to be configured only once", async function () {
        const fixture = await networkHelpers.loadFixture(deployDaoFixture);

        await (await fixture.dao.setDevTokenAddress(fixture.devTokenAddress)).wait();
        await expect(fixture.dao.setDevTokenAddress(fixture.outsiderAddress)).to.be.revertedWith("can set once");

        await (await fixture.dao.setNormalTokenAddress(fixture.normalTokenAddress)).wait();
        await expect(fixture.dao.setNormalTokenAddress(fixture.outsiderAddress)).to.be.revertedWith("can set once");

        await (await fixture.dao.setCommitteeAddress(fixture.committeeAddress)).wait();
        await expect(fixture.dao.setCommitteeAddress(fixture.outsiderAddress)).to.be.revertedWith("can set once");

        await (await fixture.dao.setProjectAddress(fixture.projectAddress)).wait();
        await expect(fixture.dao.setProjectAddress(fixture.outsiderAddress)).to.be.revertedWith("can set once");

        await (await fixture.dao.setTokenLockupAddress(fixture.lockupAddress)).wait();
        await expect(fixture.dao.setTokenLockupAddress(fixture.outsiderAddress)).to.be.revertedWith("can set once");

        await (await fixture.dao.setTokenDividendAddress(fixture.dividendAddress)).wait();
        await expect(fixture.dao.setTokenDividendAddress(fixture.outsiderAddress)).to.be.revertedWith("can set once");

        await (await fixture.dao.setAcquiredAddress(fixture.acquiredAddress)).wait();
        await expect(fixture.dao.setAcquiredAddress(fixture.outsiderAddress)).to.be.revertedWith("can set once");
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