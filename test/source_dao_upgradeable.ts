import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

async function deployUpgradeableFixture() {
    const [outsider] = await ethers.getSigners();
    const dao = await deployUUPSProxy(ethers, "SourceDao");

    return {
        dao,
        outsider
    };
}

describe("source dao upgradeable", function () {
    it("rejects zero main addresses during initialization", async function () {
        await expect(deployUUPSProxy(ethers, "SourceDaoUpgradeableMock", [ethers.ZeroAddress])).to.be.revertedWith(
            "invalid main address"
        );
    });

    it("stores the initialized main address and blocks rebinding once set", async function () {
        const { dao, outsider } = await networkHelpers.loadFixture(deployUpgradeableFixture);
        const proxy = await deployUUPSProxy(ethers, "SourceDaoUpgradeableMock", [await dao.getAddress()]);

        expect(await proxy.mainAddress()).to.equal(await dao.getAddress());
        await expect(proxy.setMainContractAddress(outsider.address)).to.be.revertedWith("can set once");
    });

    it("only allows late binding to a non-zero contract address on an uninitialized proxy", async function () {
        const { dao, outsider } = await networkHelpers.loadFixture(deployUpgradeableFixture);
        const implementationFactory = await ethers.getContractFactory("SourceDaoUpgradeableMock");
        const implementation = await implementationFactory.deploy();
        await implementation.waitForDeployment();

        const proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
        const rawProxy = await proxyFactory.deploy(await implementation.getAddress(), "0x");
        await rawProxy.waitForDeployment();

        const proxy = implementationFactory.attach(await rawProxy.getAddress());

        await expect(proxy.setMainContractAddress(ethers.ZeroAddress)).to.be.revertedWith("invalid main address");
        await expect(proxy.setMainContractAddress(outsider.address)).to.be.revertedWith("invalid main address");

        await (await proxy.setMainContractAddress(await dao.getAddress())).wait();
        expect(await proxy.mainAddress()).to.equal(await dao.getAddress());
        await expect(proxy.setMainContractAddress(await implementation.getAddress())).to.be.revertedWith("can set once");
    });
});