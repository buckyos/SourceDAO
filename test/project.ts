import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

const PROJECT_NAME = ethers.encodeBytes32String("SourceDao");
const PROJECT_VERSION = 100001n;
const THIRTY_DAYS = 30n * 24n * 60n * 60n;

function toBytes32(value: bigint) {
    return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

function projectParams(
    projectId: bigint,
    startDate: bigint,
    endDate: bigint,
    action: "createProject" | "acceptProject",
    version: bigint = PROJECT_VERSION
) {
    return [
        toBytes32(projectId),
        PROJECT_NAME,
        toBytes32(version),
        toBytes32(startDate),
        toBytes32(endDate),
        ethers.encodeBytes32String(action)
    ];
}

async function deployProjectFixture() {
    const [manager, contributor, outsider] = await ethers.getSigners();
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        [manager.address],
        1,
        200,
        PROJECT_NAME,
        Number(PROJECT_VERSION),
        150,
        daoAddress
    ]);
    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();

    const project = await deployUUPSProxy(ethers, "ProjectManagement", [1, daoAddress]);
    await (await dao.setProjectAddress(await project.getAddress())).wait();

    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        1_000_000,
        [manager.address],
        [5_000],
        daoAddress
    ]);
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

    return {
        manager,
        contributor,
        outsider,
        dao,
        committee,
        project,
        devToken
    };
}

async function createAndPromoteProject(fixture: any, version: bigint = PROJECT_VERSION) {
    const latestBlock = await ethers.provider.getBlock("latest");
    if (latestBlock === null) {
        throw new Error("latest block not found");
    }

    const startDate = BigInt(latestBlock.timestamp);
    const endDate = startDate + THIRTY_DAYS;

    await expect(
        fixture.project.createProject(10_000, PROJECT_NAME, version, startDate, endDate, [], [])
    )
        .to.emit(fixture.project, "ProjectCreate")
        .withArgs(1n, 1n);

    await (await fixture.committee.support(1n, projectParams(1n, startDate, endDate, "createProject", version))).wait();

    await expect(fixture.project.promoteProject(1n))
        .to.emit(fixture.project, "ProjectChange")
        .withArgs(1n, 1n, 0n, 1n);

    return { projectId: 1n, startDate, endDate, version };
}

describe("project", function () {
    it("rejects projects whose budget exceeds the configured cap", async function () {
        const { project, devToken } = await networkHelpers.loadFixture(deployProjectFixture);
        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const overBudget = (await devToken.totalSupply()) * 25n / 1000n + 1n;

        await expect(
            project.createProject(
                overBudget,
                PROJECT_NAME,
                PROJECT_VERSION,
                BigInt(latestBlock.timestamp),
                BigInt(latestBlock.timestamp) + THIRTY_DAYS,
                [],
                []
            )
        ).to.be.revertedWith("Budget exceeds 2.5% of total supply");
    });

    it("moves a project from preparing to developing after committee approval", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createAndPromoteProject(fixture);

        const storedProject = await fixture.project.projectOf(1n);
        expect(storedProject.manager).to.equal(fixture.manager.address);
        expect(storedProject.projectName).to.equal(PROJECT_NAME);
        expect(storedProject.version).to.equal(PROJECT_VERSION);
        expect(storedProject.startDate).to.equal(startDate);
        expect(storedProject.endDate).to.equal(endDate);
        expect(storedProject.state).to.equal(1n);
    });

    it("restricts lifecycle actions to the project manager", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createAndPromoteProject(fixture);

        await expect(
            fixture.project.connect(fixture.outsider).acceptProject(1n, 4, [])
        ).to.be.revertedWith("Must be called by the project manager");

        await expect(
            fixture.project.acceptProject(1n, 4, [
                { contributor: fixture.manager.address, value: 100 }
            ])
        )
            .to.emit(fixture.project, "ProjectChange")
            .withArgs(1n, 2n, 1n, 2n);

        await expect(
            fixture.project.connect(fixture.outsider).updateContribute(1n, {
                contributor: fixture.outsider.address,
                value: 10
            })
        ).to.be.revertedWith("Must be called by the project manager");

        await expect(
            fixture.project.connect(fixture.outsider).promoteProject(1n)
        ).to.be.revertedWith("Must be called by the project manager");

        await expect(
            fixture.project.connect(fixture.outsider).cancelProject(1n)
        ).to.be.revertedWith("Must be called by the project manager");

        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();
    });

    it("allows managers to cancel expired proposals", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const startDate = BigInt(latestBlock.timestamp);
        const endDate = startDate + THIRTY_DAYS;

        await (await fixture.project.createProject(10_000, PROJECT_NAME, PROJECT_VERSION, startDate, endDate, [], [])).wait();
        await networkHelpers.time.increase(30n * 24n * 60n * 60n + 1n);

        await (await fixture.project.cancelProject(1n)).wait();

        const storedProject = await fixture.project.projectOf(1n);
        expect(storedProject.state).to.equal(4n);
    });

    it("prevents finishing projects less than seven days apart", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const firstProject = await createAndPromoteProject(fixture, PROJECT_VERSION);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, firstProject.startDate, firstProject.endDate, "acceptProject", PROJECT_VERSION))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const secondVersion = PROJECT_VERSION + 1n;
        const startDate = BigInt(latestBlock.timestamp);
        const endDate = startDate + THIRTY_DAYS;

        await (await fixture.project.createProject(8_000, PROJECT_NAME, secondVersion, startDate, endDate, [], [])).wait();
        await (await fixture.committee.support(3n, projectParams(2n, startDate, endDate, "createProject", secondVersion))).wait();
        await (await fixture.project.promoteProject(2n)).wait();

        await (await fixture.project.acceptProject(2n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, startDate, endDate, "acceptProject", secondVersion))).wait();

        await expect(fixture.project.promoteProject(2n)).to.be.revertedWith(
            "Project finish must be at least 7 days apart"
        );
    });

    it("updates contributions and pays finished project rewards proportionally", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createAndPromoteProject(fixture);

        await expect(
            fixture.project.acceptProject(1n, 4, [
                { contributor: fixture.manager.address, value: 40 },
                { contributor: fixture.contributor.address, value: 60 }
            ])
        )
            .to.emit(fixture.project, "ProjectChange")
            .withArgs(1n, 2n, 1n, 2n);

        await (await fixture.project.updateContribute(1n, {
            contributor: fixture.manager.address,
            value: 50
        })).wait();

        expect(await fixture.project.contributionOf(1n, fixture.manager.address)).to.equal(50n);
        expect(await fixture.project.contributionOf(1n, fixture.contributor.address)).to.equal(60n);

        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);

        await expect(fixture.project.promoteProject(1n))
            .to.emit(fixture.project, "ProjectChange")
            .withArgs(1n, 2n, 2n, 3n);

        const finishedProject = await fixture.project.projectOf(1n);
        expect(finishedProject.state).to.equal(3n);

        const managerBalanceBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        await (await fixture.project.withdrawContributions([1n])).wait();
        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerBalanceBefore + 4545n);

        const contributorBalanceBefore = await fixture.devToken.balanceOf(fixture.contributor.address);
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n])).wait();
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorBalanceBefore + 5454n);

        const versionInfo = await fixture.project.latestProjectVersion(PROJECT_NAME);
        expect(versionInfo.version).to.equal(PROJECT_VERSION);
        expect(await fixture.project.versionReleasedTime(PROJECT_NAME, PROJECT_VERSION)).to.be.greaterThan(0n);
    });
});