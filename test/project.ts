import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

const PROJECT_NAME = ethers.encodeBytes32String("SourceDao");
const ALT_PROJECT_NAME = ethers.encodeBytes32String("AnotherDao");
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
    version: bigint = PROJECT_VERSION,
    name: string = PROJECT_NAME
) {
    return [
        toBytes32(projectId),
        name,
        toBytes32(version),
        toBytes32(startDate),
        toBytes32(endDate),
        ethers.encodeBytes32String(action)
    ];
}

function setCommitteesParams(members: string[]) {
    return [
        ...members.map((member) => ethers.zeroPadValue(member, 32)),
        ethers.encodeBytes32String("setCommittees")
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

    const extraTokenFactory = await ethers.getContractFactory("TestToken");
    const extraToken = await extraTokenFactory.deploy("ExtraToken", "EXT", 18, 1_000_000n, manager.address);
    await extraToken.waitForDeployment();
    const extraTokenTwo = await extraTokenFactory.deploy("ExtraTokenTwo", "EXT2", 18, 1_000_000n, manager.address);
    await extraTokenTwo.waitForDeployment();

    return {
        manager,
        contributor,
        outsider,
        dao,
        committee,
        project,
        devToken,
        extraToken,
        extraTokenTwo
    };
}

async function deployProjectCommitteeSnapshotFixture() {
    const signers = await ethers.getSigners();
    const [manager, contributor, secondMember, thirdMember, outsider, candidate] = signers;
    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const committeeMembers = [manager, secondMember, thirdMember];
    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        committeeMembers.map((signer: { address: string }) => signer.address),
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

    const extraTokenFactory = await ethers.getContractFactory("TestToken");
    const extraToken = await extraTokenFactory.deploy("ExtraToken", "EXT", 18, 1_000_000n, manager.address);
    await extraToken.waitForDeployment();
    const extraTokenTwo = await extraTokenFactory.deploy("ExtraTokenTwo", "EXT2", 18, 1_000_000n, manager.address);
    await extraTokenTwo.waitForDeployment();

    return {
        manager,
        contributor,
        secondMember,
        thirdMember,
        outsider,
        candidate,
        dao,
        committee,
        project,
        devToken,
        extraToken,
        extraTokenTwo,
        committeeMembers
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

async function createAndPromoteNamedProject(
    fixture: any,
    projectId: bigint,
    proposalId: bigint,
    name: string,
    version: bigint
) {
    const latestBlock = await ethers.provider.getBlock("latest");
    if (latestBlock === null) {
        throw new Error("latest block not found");
    }

    const startDate = BigInt(latestBlock.timestamp);
    const endDate = startDate + THIRTY_DAYS;

    await (await fixture.project.createProject(10_000, name, version, startDate, endDate, [], [])).wait();
    await (await fixture.committee.support(proposalId, projectParams(projectId, startDate, endDate, "createProject", version, name))).wait();
    await (await fixture.project.promoteProject(projectId)).wait();

    return { startDate, endDate };
}

async function createProjectWithExtraToken(
    fixture: any,
    version: bigint = PROJECT_VERSION,
    amount: bigint = 500n
) {
    const latestBlock = await ethers.provider.getBlock("latest");
    if (latestBlock === null) {
        throw new Error("latest block not found");
    }

    const startDate = BigInt(latestBlock.timestamp);
    const endDate = startDate + THIRTY_DAYS;

    await (await fixture.extraToken.approve(await fixture.project.getAddress(), amount)).wait();
    await (await fixture.project.createProject(
        10_000,
        PROJECT_NAME,
        version,
        startDate,
        endDate,
        [await fixture.extraToken.getAddress()],
        [amount]
    )).wait();

    return { startDate, endDate, amount, version };
}

async function moveProjectToAcceptingWithExtraToken(
    fixture: any,
    result: number,
    version: bigint = PROJECT_VERSION,
    amount: bigint = 500n
) {
    const { startDate, endDate } = await createProjectWithExtraToken(fixture, version, amount);
    await (await fixture.committee.support(1n, projectParams(1n, startDate, endDate, "createProject", version))).wait();
    await (await fixture.project.promoteProject(1n)).wait();
    await (await fixture.project.acceptProject(1n, result, [
        { contributor: fixture.manager.address, value: 40 },
        { contributor: fixture.contributor.address, value: 60 }
    ])).wait();
    await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject", version))).wait();

    return { startDate, endDate, amount, version };
}

async function moveProjectToAcceptingWithExtraTokens(
    fixture: any,
    result: number,
    version: bigint,
    amounts: [bigint, bigint]
) {
    const latestBlock = await ethers.provider.getBlock("latest");
    if (latestBlock === null) {
        throw new Error("latest block not found");
    }

    const startDate = BigInt(latestBlock.timestamp);
    const endDate = startDate + THIRTY_DAYS;

    await (await fixture.extraToken.approve(await fixture.project.getAddress(), amounts[0])).wait();
    await (await fixture.extraTokenTwo.approve(await fixture.project.getAddress(), amounts[1])).wait();

    await (await fixture.project.createProject(
        10_000,
        PROJECT_NAME,
        version,
        startDate,
        endDate,
        [await fixture.extraToken.getAddress(), await fixture.extraTokenTwo.getAddress()],
        [amounts[0], amounts[1]]
    )).wait();

    await (await fixture.committee.support(1n, projectParams(1n, startDate, endDate, "createProject", version))).wait();
    await (await fixture.project.promoteProject(1n)).wait();
    await (await fixture.project.acceptProject(1n, result, [
        { contributor: fixture.manager.address, value: 40 },
        { contributor: fixture.contributor.address, value: 60 }
    ])).wait();
    await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject", version))).wait();

    return { startDate, endDate };
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

    it("rejects projects whose extra token arrays have mismatched lengths", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        await expect(
            fixture.project.createProject(
                10_000,
                PROJECT_NAME,
                PROJECT_VERSION,
                BigInt(latestBlock.timestamp),
                BigInt(latestBlock.timestamp) + THIRTY_DAYS,
                [await fixture.extraToken.getAddress()],
                []
            )
        ).to.be.revertedWith("extra token length mismatch");
    });

    it("rejects createProject when extra token escrow transfer returns false", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const falseToken = await (await ethers.getContractFactory("FalseReturnToken")).deploy(
            1_000_000n,
            fixture.manager.address
        );
        await falseToken.waitForDeployment();

        await (await falseToken.approve(await fixture.project.getAddress(), 500n)).wait();

        let reverted = false;
        try {
            await (await fixture.project.createProject(
                10_000,
                PROJECT_NAME,
                PROJECT_VERSION,
                BigInt(latestBlock.timestamp),
                BigInt(latestBlock.timestamp) + THIRTY_DAYS,
                [await falseToken.getAddress()],
                [500n]
            )).wait();
        } catch {
            reverted = true;
        }

        expect(reverted).to.equal(true);
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

    it("keeps a createProject proposal bound to its original committee snapshot after committee replacement", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectCommitteeSnapshotFixture);
        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const startDate = BigInt(latestBlock.timestamp);
        const endDate = startDate + THIRTY_DAYS;
        const createProposalId = 1n;
        const replaceProposalId = 2n;
        const replacementMembers = [
            fixture.manager.address,
            fixture.candidate.address,
            fixture.outsider.address
        ];

        await (await fixture.project.createProject(10_000, PROJECT_NAME, PROJECT_VERSION, startDate, endDate, [], [])).wait();
        await (await fixture.committee.connect(fixture.manager).support(
            createProposalId,
            projectParams(1n, startDate, endDate, "createProject")
        )).wait();

        await (await fixture.committee.connect(fixture.manager).prepareSetCommittees(replacementMembers, false)).wait();
        await (await fixture.committee.connect(fixture.manager).support(
            replaceProposalId,
            setCommitteesParams(replacementMembers)
        )).wait();
        await (await fixture.committee.connect(fixture.secondMember).support(
            replaceProposalId,
            setCommitteesParams(replacementMembers)
        )).wait();
        await (await fixture.committee.setCommittees(replacementMembers, replaceProposalId)).wait();

        await expect(
            fixture.committee.connect(fixture.candidate).support(
                createProposalId,
                projectParams(1n, startDate, endDate, "createProject")
            )
        ).to.be.revertedWith("only committee can vote");

        await (await fixture.committee.connect(fixture.secondMember).support(
            createProposalId,
            projectParams(1n, startDate, endDate, "createProject")
        )).wait();

        await (await fixture.project.promoteProject(1n)).wait();

        const storedProject = await fixture.project.projectOf(1n);
        expect(storedProject.state).to.equal(1n);
        expect((await fixture.committee.proposalOf(createProposalId)).state).to.equal(4n);
    });

    it("keeps an acceptProject proposal bound to its original committee snapshot after committee replacement", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectCommitteeSnapshotFixture);
        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const startDate = BigInt(latestBlock.timestamp);
        const endDate = startDate + THIRTY_DAYS;
        const createProposalId = 1n;
        const acceptProposalId = 2n;
        const replaceProposalId = 3n;
        const replacementMembers = [
            fixture.manager.address,
            fixture.candidate.address,
            fixture.outsider.address
        ];

        await (await fixture.project.createProject(10_000, PROJECT_NAME, PROJECT_VERSION, startDate, endDate, [], [])).wait();
        await (await fixture.committee.connect(fixture.manager).support(
            createProposalId,
            projectParams(1n, startDate, endDate, "createProject")
        )).wait();
        await (await fixture.committee.connect(fixture.secondMember).support(
            createProposalId,
            projectParams(1n, startDate, endDate, "createProject")
        )).wait();
        await (await fixture.project.promoteProject(1n)).wait();

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.connect(fixture.manager).support(
            acceptProposalId,
            projectParams(1n, startDate, endDate, "acceptProject")
        )).wait();

        await (await fixture.committee.connect(fixture.manager).prepareSetCommittees(replacementMembers, false)).wait();
        await (await fixture.committee.connect(fixture.manager).support(
            replaceProposalId,
            setCommitteesParams(replacementMembers)
        )).wait();
        await (await fixture.committee.connect(fixture.secondMember).support(
            replaceProposalId,
            setCommitteesParams(replacementMembers)
        )).wait();
        await (await fixture.committee.setCommittees(replacementMembers, replaceProposalId)).wait();

        await expect(
            fixture.committee.connect(fixture.candidate).support(
                acceptProposalId,
                projectParams(1n, startDate, endDate, "acceptProject")
            )
        ).to.be.revertedWith("only committee can vote");

        await (await fixture.committee.connect(fixture.secondMember).support(
            acceptProposalId,
            projectParams(1n, startDate, endDate, "acceptProject")
        )).wait();

        await (await fixture.project.promoteProject(1n)).wait();

        const storedProject = await fixture.project.projectOf(1n);
        expect(storedProject.state).to.equal(3n);
        expect((await fixture.committee.proposalOf(acceptProposalId)).state).to.equal(4n);
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

    it("rejects accepting a project with an empty contribution list", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(fixture);

        await expect(
            fixture.project.acceptProject(1n, 4, [])
        ).to.be.revertedWith("No contributions");
    });

    it("rejects accepting a project with duplicate contributors", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(fixture);

        await expect(
            fixture.project.acceptProject(1n, 4, [
                { contributor: fixture.manager.address, value: 40 },
                { contributor: fixture.manager.address, value: 60 }
            ])
        ).to.be.revertedWith("Duplicate contributor");
    });

    it("rejects accepting a project with zero-value contributions", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(fixture);

        await expect(
            fixture.project.acceptProject(1n, 4, [
                { contributor: fixture.manager.address, value: 0 }
            ])
        ).to.be.revertedWith("Invalid contribution");
    });

    it("rejects accepting a project before the create proposal has been promoted", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const startDate = BigInt(latestBlock.timestamp);
        const endDate = startDate + THIRTY_DAYS;

        await (await fixture.project.createProject(10_000, PROJECT_NAME, PROJECT_VERSION, startDate, endDate, [], [])).wait();

        await expect(
            fixture.project.acceptProject(1n, 4, [
                { contributor: fixture.manager.address, value: 100 }
            ])
        ).to.be.revertedWith("state error");
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

    it("marks committee proposals as executed after each successful promotion", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createAndPromoteProject(fixture);

        const createProposal = await fixture.committee.proposalOf(1n);
        expect(createProposal.state).to.equal(4n);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();

        const acceptProposalBeforeFinish = await fixture.committee.proposalOf(2n);
        expect(acceptProposalBeforeFinish.state).to.equal(1n);

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const acceptProposalAfterFinish = await fixture.committee.proposalOf(2n);
        expect(acceptProposalAfterFinish.state).to.equal(4n);
    });

    it("returns escrowed extra tokens when a preparing project is rejected", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate, amount } = await createProjectWithExtraToken(fixture);

        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(amount);

        await (await fixture.committee.reject(1n, projectParams(1n, startDate, endDate, "createProject"))).wait();
        await (await fixture.project.cancelProject(1n)).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(1_000_000n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
        expect((await fixture.project.projectOf(1n)).state).to.equal(4n);
    });

    it("returns escrowed extra tokens when an accepting project is rejected", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate, amount } = await createProjectWithExtraToken(fixture);

        await (await fixture.committee.support(1n, projectParams(1n, startDate, endDate, "createProject"))).wait();
        await (await fixture.project.promoteProject(1n)).wait();

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();

        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(amount);

        await (await fixture.committee.reject(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();
        await (await fixture.project.cancelProject(1n)).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(1_000_000n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
        expect((await fixture.project.projectOf(1n)).state).to.equal(4n);
    });

    it("returns escrowed extra tokens when an accepting proposal expires", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate, amount } = await createProjectWithExtraToken(fixture);

        await (await fixture.committee.support(1n, projectParams(1n, startDate, endDate, "createProject"))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();

        await networkHelpers.time.increase(30n * 24n * 60n * 60n + 1n);
        await (await fixture.project.cancelProject(1n)).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(1_000_000n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
        expect((await fixture.project.projectOf(1n)).state).to.equal(4n);
        expect(amount).to.equal(500n);
    });

    it("rejects canceling proposals that are still in progress or already accepted", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const startDate = BigInt(latestBlock.timestamp);
        const endDate = startDate + THIRTY_DAYS;

        await (await fixture.project.createProject(10_000, PROJECT_NAME, PROJECT_VERSION, startDate, endDate, [], [])).wait();

        await expect(
            fixture.project.cancelProject(1n)
        ).to.be.revertedWith("Proposal status is not failed");

        await (await fixture.committee.support(1n, projectParams(1n, startDate, endDate, "createProject"))).wait();

        await expect(
            fixture.project.cancelProject(1n)
        ).to.be.revertedWith("Proposal status is not failed");
    });

    it("rejects promoting a preparing project when the proposal is in progress rejected or expired", async function () {
        const inProgressFixture = await networkHelpers.loadFixture(deployProjectFixture);
        const inProgressBlock = await ethers.provider.getBlock("latest");
        if (inProgressBlock === null) {
            throw new Error("latest block not found");
        }

        const inProgressStart = BigInt(inProgressBlock.timestamp);
        const inProgressEnd = inProgressStart + THIRTY_DAYS;
        await (await inProgressFixture.project.createProject(10_000, PROJECT_NAME, PROJECT_VERSION, inProgressStart, inProgressEnd, [], [])).wait();

        await expect(
            inProgressFixture.project.promoteProject(1n)
        ).to.be.revertedWith("Proposal status is not accept");

        const rejectedFixture = await networkHelpers.loadFixture(deployProjectFixture);
        const rejectedBlock = await ethers.provider.getBlock("latest");
        if (rejectedBlock === null) {
            throw new Error("latest block not found");
        }

        const rejectedStart = BigInt(rejectedBlock.timestamp);
        const rejectedEnd = rejectedStart + THIRTY_DAYS;
        await (await rejectedFixture.project.createProject(10_000, PROJECT_NAME, PROJECT_VERSION, rejectedStart, rejectedEnd, [], [])).wait();
        await (await rejectedFixture.committee.reject(1n, projectParams(1n, rejectedStart, rejectedEnd, "createProject"))).wait();

        await expect(
            rejectedFixture.project.promoteProject(1n)
        ).to.be.revertedWith("Proposal status is not accept");

        const expiredFixture = await networkHelpers.loadFixture(deployProjectFixture);
        const expiredBlock = await ethers.provider.getBlock("latest");
        if (expiredBlock === null) {
            throw new Error("latest block not found");
        }

        const expiredStart = BigInt(expiredBlock.timestamp);
        const expiredEnd = expiredStart + THIRTY_DAYS;
        await (await expiredFixture.project.createProject(10_000, PROJECT_NAME, PROJECT_VERSION, expiredStart, expiredEnd, [], [])).wait();
        await networkHelpers.time.increase(30n * 24n * 60n * 60n + 1n);

        await expect(
            expiredFixture.project.promoteProject(1n)
        ).to.be.revertedWith("Proposal status is not accept");
    });

    it("rejects promoting an accepting project when the proposal is in progress rejected or expired", async function () {
        const inProgressFixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate: inProgressStart, endDate: inProgressEnd } = await createAndPromoteProject(inProgressFixture);
        await (await inProgressFixture.project.acceptProject(1n, 4, [
            { contributor: inProgressFixture.manager.address, value: 100 }
        ])).wait();

        await expect(
            inProgressFixture.project.promoteProject(1n)
        ).to.be.revertedWith("Proposal status is not accept");

        const rejectedFixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate: rejectedStart, endDate: rejectedEnd } = await createAndPromoteProject(rejectedFixture);
        await (await rejectedFixture.project.acceptProject(1n, 4, [
            { contributor: rejectedFixture.manager.address, value: 100 }
        ])).wait();
        await (await rejectedFixture.committee.reject(2n, projectParams(1n, rejectedStart, rejectedEnd, "acceptProject"))).wait();

        await expect(
            rejectedFixture.project.promoteProject(1n)
        ).to.be.revertedWith("Proposal status is not accept");

        const expiredFixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(expiredFixture);
        await (await expiredFixture.project.acceptProject(1n, 4, [
            { contributor: expiredFixture.manager.address, value: 100 }
        ])).wait();
        await networkHelpers.time.increase(30n * 24n * 60n * 60n + 1n);

        await expect(
            expiredFixture.project.promoteProject(1n)
        ).to.be.revertedWith("Proposal status is not accept");
    });

    it("rejects repeating lifecycle actions after a create proposal has already been executed", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(fixture);

        const storedProject = await fixture.project.projectOf(1n);
        expect(storedProject.state).to.equal(1n);

        await expect(
            fixture.project.promoteProject(1n)
        ).to.be.revertedWith("state error");

        await expect(
            fixture.project.cancelProject(1n)
        ).to.be.revertedWith("state error");
    });

    it("rejects repeating acceptProject once a project is already in accepting", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();

        expect((await fixture.project.projectOf(1n)).state).to.equal(2n);

        await expect(
            fixture.project.acceptProject(1n, 4, [
                { contributor: fixture.manager.address, value: 100 }
            ])
        ).to.be.revertedWith("state error");
    });

    it("rejects repeating lifecycle actions after a project has finished", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        expect((await fixture.project.projectOf(1n)).state).to.equal(3n);

        await expect(
            fixture.project.promoteProject(1n)
        ).to.be.revertedWith("state error");

        await expect(
            fixture.project.cancelProject(1n)
        ).to.be.revertedWith("state error");
    });

    it("rejects accepting a project after it has already finished", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        await expect(
            fixture.project.acceptProject(1n, 4, [
                { contributor: fixture.manager.address, value: 100 }
            ])
        ).to.be.revertedWith("state error");
    });

    it("rejects repeating lifecycle actions after a project has been canceled as rejected", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createProjectWithExtraToken(fixture);

        await (await fixture.committee.reject(1n, projectParams(1n, startDate, endDate, "createProject"))).wait();
        await (await fixture.project.cancelProject(1n)).wait();

        expect((await fixture.project.projectOf(1n)).state).to.equal(4n);

        await expect(
            fixture.project.cancelProject(1n)
        ).to.be.revertedWith("state error");

        await expect(
            fixture.project.promoteProject(1n)
        ).to.be.revertedWith("state error");
    });

    it("rejects accepting a project after it has already been canceled", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createProjectWithExtraToken(fixture);

        await (await fixture.committee.reject(1n, projectParams(1n, startDate, endDate, "createProject"))).wait();
        await (await fixture.project.cancelProject(1n)).wait();

        await expect(
            fixture.project.acceptProject(1n, 4, [
                { contributor: fixture.manager.address, value: 100 }
            ])
        ).to.be.revertedWith("state error");
    });

    it("rejects updating contributions outside the accepting state", async function () {
        const developingFixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(developingFixture);

        await expect(
            developingFixture.project.updateContribute(1n, {
                contributor: developingFixture.manager.address,
                value: 100
            })
        ).to.be.revertedWith("status error");

        const finishedFixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate: finishedStart, endDate: finishedEnd } = await createAndPromoteProject(finishedFixture);
        await (await finishedFixture.project.acceptProject(1n, 4, [
            { contributor: finishedFixture.manager.address, value: 100 }
        ])).wait();
        await (await finishedFixture.committee.support(2n, projectParams(1n, finishedStart, finishedEnd, "acceptProject"))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await finishedFixture.project.promoteProject(1n)).wait();

        await expect(
            finishedFixture.project.updateContribute(1n, {
                contributor: finishedFixture.manager.address,
                value: 120
            })
        ).to.be.revertedWith("status error");

        const rejectedFixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate: rejectedStart, endDate: rejectedEnd } = await createAndPromoteProject(rejectedFixture);
        await (await rejectedFixture.project.acceptProject(1n, 4, [
            { contributor: rejectedFixture.manager.address, value: 100 }
        ])).wait();
        await (await rejectedFixture.committee.reject(2n, projectParams(1n, rejectedStart, rejectedEnd, "acceptProject"))).wait();
        await (await rejectedFixture.project.cancelProject(1n)).wait();

        await expect(
            rejectedFixture.project.updateContribute(1n, {
                contributor: rejectedFixture.manager.address,
                value: 120
            })
        ).to.be.revertedWith("status error");
    });

    it("updates latestProjectFinishTime only when a project actually finishes", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const first = await createAndPromoteProject(fixture, PROJECT_VERSION);

        expect(await fixture.project.latestProjectFinishTime()).to.equal(0n);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        expect(await fixture.project.latestProjectFinishTime()).to.equal(0n);

        await (await fixture.committee.reject(2n, projectParams(1n, first.startDate, first.endDate, "acceptProject", PROJECT_VERSION))).wait();
        await (await fixture.project.cancelProject(1n)).wait();
        expect(await fixture.project.latestProjectFinishTime()).to.equal(0n);

        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const secondVersion = PROJECT_VERSION + 1n;
        const secondStart = BigInt(latestBlock.timestamp);
        const secondEnd = secondStart + THIRTY_DAYS;
        await (await fixture.project.createProject(10_000, PROJECT_NAME, secondVersion, secondStart, secondEnd, [], [])).wait();
        await (await fixture.committee.support(3n, projectParams(2n, secondStart, secondEnd, "createProject", secondVersion))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, secondStart, secondEnd, "acceptProject", secondVersion))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        expect(await fixture.project.latestProjectFinishTime()).to.be.greaterThan(0n);
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

    it("does not pay the same contribution twice", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const balanceBeforeFirstClaim = await fixture.devToken.balanceOf(fixture.manager.address);
        await (await fixture.project.withdrawContributions([1n])).wait();
        const balanceAfterFirstClaim = await fixture.devToken.balanceOf(fixture.manager.address);
        expect(balanceAfterFirstClaim).to.equal(balanceBeforeFirstClaim + 10000n);

        await (await fixture.project.withdrawContributions([1n])).wait();
        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(balanceAfterFirstClaim);
    });

    it("adds new contributors during accepting through updateContribute", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();

        await (await fixture.project.updateContribute(1n, {
            contributor: fixture.outsider.address,
            value: 25
        })).wait();

        expect(await fixture.project.contributionOf(1n, fixture.outsider.address)).to.equal(25n);

        const detail = await fixture.project.projectDetailOf(1n);
        expect(detail.contributions).to.have.length(2);
        expect(detail.contributions[0].contributor).to.equal(fixture.manager.address);
        expect(detail.contributions[1].contributor).to.equal(fixture.outsider.address);
        expect(detail.contributions[1].value).to.equal(25n);
        expect(detail.contributions[1].hasClaim).to.equal(false);
    });

    it("overwrites an existing contributor instead of appending a duplicate entry", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();

        await (await fixture.project.updateContribute(1n, {
            contributor: fixture.manager.address,
            value: 55
        })).wait();
        await (await fixture.project.updateContribute(1n, {
            contributor: fixture.manager.address,
            value: 45
        })).wait();

        const detail = await fixture.project.projectDetailOf(1n);
        expect(detail.contributions).to.have.length(2);
        expect(detail.contributions[0].contributor).to.equal(fixture.manager.address);
        expect(detail.contributions[0].value).to.equal(45n);
        expect(detail.contributions[1].contributor).to.equal(fixture.contributor.address);
        expect(detail.contributions[1].value).to.equal(60n);
    });

    it("rejects adding a zero-address contributor during accepting", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();

        await expect(
            fixture.project.updateContribute(1n, {
                contributor: ethers.ZeroAddress,
                value: 10
            })
        ).to.be.revertedWith("Invalid contributor");
    });

    it("rejects updating a contributor to a zero value during accepting", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();

        await expect(
            fixture.project.updateContribute(1n, {
                contributor: fixture.manager.address,
                value: 0
            })
        ).to.be.revertedWith("Invalid contribution");
    });

    it("marks only the withdrawing contributor as claimed", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        await (await fixture.project.withdrawContributions([1n])).wait();

        const detail = await fixture.project.projectDetailOf(1n);
        expect(detail.contributions[0].contributor).to.equal(fixture.manager.address);
        expect(detail.contributions[0].hasClaim).to.equal(true);
        expect(detail.contributions[1].contributor).to.equal(fixture.contributor.address);
        expect(detail.contributions[1].hasClaim).to.equal(false);
    });

    it("refunds undistributed extra tokens to the manager for normal results", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { amount } = await moveProjectToAcceptingWithExtraToken(fixture, 3, PROJECT_VERSION, 500n);

        const managerExtraBeforeFinish = await fixture.extraToken.balanceOf(fixture.manager.address);
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(
            managerExtraBeforeFinish + amount * 20n / 100n
        );

        await (await fixture.project.withdrawContributions([1n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n])).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999760n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(240n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
    });

    it("distributes all escrowed extra tokens for good results without refunding the manager", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await moveProjectToAcceptingWithExtraToken(fixture, 4, PROJECT_VERSION, 500n);

        const managerExtraBeforeFinish = await fixture.extraToken.balanceOf(fixture.manager.address);
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(managerExtraBeforeFinish);

        await (await fixture.project.withdrawContributions([1n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n])).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999700n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(300n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
    });

    it("treats expired results as zero-reward finished releases", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { amount } = await moveProjectToAcceptingWithExtraToken(fixture, 1, PROJECT_VERSION, 500n);

        const managerExtraBeforeFinish = await fixture.extraToken.balanceOf(fixture.manager.address);
        const managerDevBeforeFinish = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBeforeFinish = await fixture.devToken.balanceOf(fixture.contributor.address);

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(managerExtraBeforeFinish + amount);

        await (await fixture.project.withdrawContributions([1n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBeforeFinish);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBeforeFinish);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(0n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);

        const versionInfo = await fixture.project.latestProjectVersion(PROJECT_NAME);
        expect(versionInfo.version).to.equal(PROJECT_VERSION);
        expect(await fixture.project.versionReleasedTime(PROJECT_NAME, PROJECT_VERSION)).to.be.greaterThan(0n);
    });

    it("treats failed results as zero-reward finished releases", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { amount } = await moveProjectToAcceptingWithExtraToken(fixture, 2, PROJECT_VERSION, 500n);

        const managerExtraBeforeFinish = await fixture.extraToken.balanceOf(fixture.manager.address);
        const managerDevBeforeFinish = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBeforeFinish = await fixture.devToken.balanceOf(fixture.contributor.address);

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(managerExtraBeforeFinish + amount);

        await (await fixture.project.withdrawContributions([1n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBeforeFinish);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBeforeFinish);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(0n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);

        const versionInfo = await fixture.project.latestProjectVersion(PROJECT_NAME);
        expect(versionInfo.version).to.equal(PROJECT_VERSION);
        expect(await fixture.project.versionReleasedTime(PROJECT_NAME, PROJECT_VERSION)).to.be.greaterThan(0n);
    });

    it("caps extra token distribution at one hundred percent for excellent results", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await moveProjectToAcceptingWithExtraToken(fixture, 5, PROJECT_VERSION, 500n);

        const managerExtraBeforeFinish = await fixture.extraToken.balanceOf(fixture.manager.address);
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(managerExtraBeforeFinish);

        await (await fixture.project.withdrawContributions([1n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n])).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999700n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(300n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
    });

    it("settles multiple extra tokens proportionally in a normal result", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        await moveProjectToAcceptingWithExtraTokens(fixture, 3, PROJECT_VERSION, [500n, 250n]);

        const managerExtraOneBefore = await fixture.extraToken.balanceOf(fixture.manager.address);
        const managerExtraTwoBefore = await fixture.extraTokenTwo.balanceOf(fixture.manager.address);

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(managerExtraOneBefore + 100n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.manager.address)).to.equal(managerExtraTwoBefore + 50n);

        await (await fixture.project.withdrawContributions([1n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n])).wait();

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999760n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(240n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.manager.address)).to.equal(999880n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.contributor.address)).to.equal(120n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
        expect(await fixture.extraTokenTwo.balanceOf(await fixture.project.getAddress())).to.equal(0n);
    });

    it("distributes dev and extra tokens across three contributors with exact shares", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createProjectWithExtraToken(fixture, PROJECT_VERSION, 1_000n);

        await (await fixture.committee.support(1n, projectParams(1n, startDate, endDate, "createProject"))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 20 },
            { contributor: fixture.contributor.address, value: 30 },
            { contributor: fixture.outsider.address, value: 50 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const managerDevBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBefore = await fixture.devToken.balanceOf(fixture.contributor.address);
        const outsiderDevBefore = await fixture.devToken.balanceOf(fixture.outsider.address);

        await (await fixture.project.withdrawContributions([1n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n])).wait();
        await (await fixture.project.connect(fixture.outsider).withdrawContributions([1n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBefore + 2000n);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBefore + 3000n);
        expect(await fixture.devToken.balanceOf(fixture.outsider.address)).to.equal(outsiderDevBefore + 5000n);

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999200n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(300n);
        expect(await fixture.extraToken.balanceOf(fixture.outsider.address)).to.equal(500n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
    });

    it("keeps rounding remainder on the project contract when shares are not evenly divisible", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createProjectWithExtraToken(fixture, PROJECT_VERSION, 1_000n);

        await (await fixture.committee.support(1n, projectParams(1n, startDate, endDate, "createProject"))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 1 },
            { contributor: fixture.contributor.address, value: 1 },
            { contributor: fixture.outsider.address, value: 1 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const managerDevBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBefore = await fixture.devToken.balanceOf(fixture.contributor.address);
        const outsiderDevBefore = await fixture.devToken.balanceOf(fixture.outsider.address);

        await (await fixture.project.withdrawContributions([1n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n])).wait();
        await (await fixture.project.connect(fixture.outsider).withdrawContributions([1n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBefore + 3333n);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBefore + 3333n);
        expect(await fixture.devToken.balanceOf(fixture.outsider.address)).to.equal(outsiderDevBefore + 3333n);
        expect(await fixture.devToken.balanceOf(await fixture.project.getAddress())).to.equal(1n);

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999333n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(333n);
        expect(await fixture.extraToken.balanceOf(fixture.outsider.address)).to.equal(333n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(1n);
    });

    it("keeps rounding remainder isolated across multiple projects in a batched withdrawal", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const first = await createProjectWithExtraToken(fixture, PROJECT_VERSION, 1_000n);
        await (await fixture.committee.support(1n, projectParams(1n, first.startDate, first.endDate, "createProject", PROJECT_VERSION))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 1 },
            { contributor: fixture.contributor.address, value: 1 },
            { contributor: fixture.outsider.address, value: 1 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, first.startDate, first.endDate, "acceptProject", PROJECT_VERSION))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const secondVersion = PROJECT_VERSION + 1n;
        const secondStart = BigInt(latestBlock.timestamp);
        const secondEnd = secondStart + THIRTY_DAYS;
        await (await fixture.extraToken.approve(await fixture.project.getAddress(), 1_000n)).wait();
        await (await fixture.project.createProject(
            10_000,
            PROJECT_NAME,
            secondVersion,
            secondStart,
            secondEnd,
            [await fixture.extraToken.getAddress()],
            [1_000n]
        )).wait();
        await (await fixture.committee.support(3n, projectParams(2n, secondStart, secondEnd, "createProject", secondVersion))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 4, [
            { contributor: fixture.manager.address, value: 1 },
            { contributor: fixture.contributor.address, value: 1 },
            { contributor: fixture.outsider.address, value: 1 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, secondStart, secondEnd, "acceptProject", secondVersion))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const managerDevBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBefore = await fixture.devToken.balanceOf(fixture.contributor.address);
        const outsiderDevBefore = await fixture.devToken.balanceOf(fixture.outsider.address);

        await (await fixture.project.withdrawContributions([1n, 2n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n, 2n])).wait();
        await (await fixture.project.connect(fixture.outsider).withdrawContributions([1n, 2n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBefore + 6666n);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBefore + 6666n);
        expect(await fixture.devToken.balanceOf(fixture.outsider.address)).to.equal(outsiderDevBefore + 6666n);
        expect(await fixture.devToken.balanceOf(await fixture.project.getAddress())).to.equal(2n);

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(998666n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(666n);
        expect(await fixture.extraToken.balanceOf(fixture.outsider.address)).to.equal(666n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(2n);
    });

    it("does not mark claims or transfer balances when a non-contributor batch withdraws", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const first = await createProjectWithExtraToken(fixture, PROJECT_VERSION, 500n);
        await (await fixture.committee.support(1n, projectParams(1n, first.startDate, first.endDate, "createProject", PROJECT_VERSION))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 3, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, first.startDate, first.endDate, "acceptProject", PROJECT_VERSION))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const secondVersion = PROJECT_VERSION + 1n;
        const secondStart = BigInt(latestBlock.timestamp);
        const secondEnd = secondStart + THIRTY_DAYS;
        await (await fixture.project.createProject(10_000, ALT_PROJECT_NAME, secondVersion, secondStart, secondEnd, [], [])).wait();
        await (await fixture.committee.support(3n, projectParams(2n, secondStart, secondEnd, "createProject", secondVersion, ALT_PROJECT_NAME))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 4, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, secondStart, secondEnd, "acceptProject", secondVersion, ALT_PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const outsiderDevBefore = await fixture.devToken.balanceOf(fixture.outsider.address);
        const outsiderExtraBefore = await fixture.extraToken.balanceOf(fixture.outsider.address);

        await (await fixture.project.connect(fixture.outsider).withdrawContributions([1n, 2n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.outsider.address)).to.equal(outsiderDevBefore);
        expect(await fixture.extraToken.balanceOf(fixture.outsider.address)).to.equal(outsiderExtraBefore);

        const firstDetail = await fixture.project.projectDetailOf(1n);
        expect(firstDetail.contributions[0].hasClaim).to.equal(false);
        expect(firstDetail.contributions[1].hasClaim).to.equal(false);

        const secondDetail = await fixture.project.projectDetailOf(2n);
        expect(secondDetail.contributions[0].hasClaim).to.equal(false);
        expect(secondDetail.contributions[1].hasClaim).to.equal(false);
    });

    it("accumulates rounding remainders across mixed normal and good projects in one batch", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const first = await createProjectWithExtraToken(fixture, PROJECT_VERSION, 1_000n);
        await (await fixture.committee.support(1n, projectParams(1n, first.startDate, first.endDate, "createProject", PROJECT_VERSION))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 3, [
            { contributor: fixture.manager.address, value: 1 },
            { contributor: fixture.contributor.address, value: 1 },
            { contributor: fixture.outsider.address, value: 1 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, first.startDate, first.endDate, "acceptProject", PROJECT_VERSION))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const secondVersion = PROJECT_VERSION + 1n;
        const secondStart = BigInt(latestBlock.timestamp);
        const secondEnd = secondStart + THIRTY_DAYS;
        await (await fixture.extraToken.approve(await fixture.project.getAddress(), 1_000n)).wait();
        await (await fixture.project.createProject(
            10_000,
            PROJECT_NAME,
            secondVersion,
            secondStart,
            secondEnd,
            [await fixture.extraToken.getAddress()],
            [1_000n]
        )).wait();
        await (await fixture.committee.support(3n, projectParams(2n, secondStart, secondEnd, "createProject", secondVersion))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 4, [
            { contributor: fixture.manager.address, value: 1 },
            { contributor: fixture.contributor.address, value: 1 },
            { contributor: fixture.outsider.address, value: 1 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, secondStart, secondEnd, "acceptProject", secondVersion))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const managerDevBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBefore = await fixture.devToken.balanceOf(fixture.contributor.address);
        const outsiderDevBefore = await fixture.devToken.balanceOf(fixture.outsider.address);

        await (await fixture.project.withdrawContributions([1n, 2n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n, 2n])).wait();
        await (await fixture.project.connect(fixture.outsider).withdrawContributions([1n, 2n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBefore + 5999n);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBefore + 5999n);
        expect(await fixture.devToken.balanceOf(fixture.outsider.address)).to.equal(outsiderDevBefore + 5999n);
        expect(await fixture.devToken.balanceOf(await fixture.project.getAddress())).to.equal(3n);

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(998799n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(599n);
        expect(await fixture.extraToken.balanceOf(fixture.outsider.address)).to.equal(599n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(3n);
    });

    it("handles mixed normal excellent and failed projects in one batch without cross-project leakage", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const first = await createProjectWithExtraToken(fixture, PROJECT_VERSION, 500n);
        await (await fixture.committee.support(1n, projectParams(1n, first.startDate, first.endDate, "createProject", PROJECT_VERSION))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 3, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, first.startDate, first.endDate, "acceptProject", PROJECT_VERSION))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const secondBlock = await ethers.provider.getBlock("latest");
        if (secondBlock === null) {
            throw new Error("latest block not found");
        }

        const secondVersion = PROJECT_VERSION + 1n;
        const secondStart = BigInt(secondBlock.timestamp);
        const secondEnd = secondStart + THIRTY_DAYS;
        await (await fixture.extraToken.approve(await fixture.project.getAddress(), 500n)).wait();
        await (await fixture.project.createProject(
            10_000,
            PROJECT_NAME,
            secondVersion,
            secondStart,
            secondEnd,
            [await fixture.extraToken.getAddress()],
            [500n]
        )).wait();
        await (await fixture.committee.support(3n, projectParams(2n, secondStart, secondEnd, "createProject", secondVersion))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 5, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, secondStart, secondEnd, "acceptProject", secondVersion))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const thirdBlock = await ethers.provider.getBlock("latest");
        if (thirdBlock === null) {
            throw new Error("latest block not found");
        }

        const thirdVersion = PROJECT_VERSION + 2n;
        const thirdStart = BigInt(thirdBlock.timestamp);
        const thirdEnd = thirdStart + THIRTY_DAYS;
        await (await fixture.extraToken.approve(await fixture.project.getAddress(), 500n)).wait();
        await (await fixture.project.createProject(
            10_000,
            PROJECT_NAME,
            thirdVersion,
            thirdStart,
            thirdEnd,
            [await fixture.extraToken.getAddress()],
            [500n]
        )).wait();
        await (await fixture.committee.support(5n, projectParams(3n, thirdStart, thirdEnd, "createProject", thirdVersion))).wait();
        await (await fixture.project.promoteProject(3n)).wait();
        await (await fixture.project.acceptProject(3n, 2, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.support(6n, projectParams(3n, thirdStart, thirdEnd, "acceptProject", thirdVersion))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(3n)).wait();

        const managerDevBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBefore = await fixture.devToken.balanceOf(fixture.contributor.address);

        await (await fixture.project.withdrawContributions([1n, 2n, 3n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n, 2n, 3n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBefore + 8000n);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBefore + 12000n);
        expect(await fixture.devToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999460n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(540n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
    });

    it("isolates an expired dual-token project from a named good project in one three-contributor batch", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const firstBlock = await ethers.provider.getBlock("latest");
        if (firstBlock === null) {
            throw new Error("latest block not found");
        }

        const mainStart = BigInt(firstBlock.timestamp);
        const mainEnd = mainStart + THIRTY_DAYS;
        await (await fixture.extraToken.approve(await fixture.project.getAddress(), 600n)).wait();
        await (await fixture.extraTokenTwo.approve(await fixture.project.getAddress(), 300n)).wait();
        await (await fixture.project.createProject(
            10_000,
            PROJECT_NAME,
            PROJECT_VERSION,
            mainStart,
            mainEnd,
            [await fixture.extraToken.getAddress(), await fixture.extraTokenTwo.getAddress()],
            [600n, 300n]
        )).wait();
        await (await fixture.committee.support(1n, projectParams(1n, mainStart, mainEnd, "createProject", PROJECT_VERSION, PROJECT_NAME))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 1, [
            { contributor: fixture.manager.address, value: 20 },
            { contributor: fixture.contributor.address, value: 30 },
            { contributor: fixture.outsider.address, value: 50 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, mainStart, mainEnd, "acceptProject", PROJECT_VERSION, PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const secondBlock = await ethers.provider.getBlock("latest");
        if (secondBlock === null) {
            throw new Error("latest block not found");
        }

        const altVersion = PROJECT_VERSION;
        const altStart = BigInt(secondBlock.timestamp);
        const altEnd = altStart + THIRTY_DAYS;
        await (await fixture.extraToken.approve(await fixture.project.getAddress(), 900n)).wait();
        await (await fixture.extraTokenTwo.approve(await fixture.project.getAddress(), 450n)).wait();
        await (await fixture.project.createProject(
            10_000,
            ALT_PROJECT_NAME,
            altVersion,
            altStart,
            altEnd,
            [await fixture.extraToken.getAddress(), await fixture.extraTokenTwo.getAddress()],
            [900n, 450n]
        )).wait();
        await (await fixture.committee.support(3n, projectParams(2n, altStart, altEnd, "createProject", altVersion, ALT_PROJECT_NAME))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 4, [
            { contributor: fixture.manager.address, value: 20 },
            { contributor: fixture.contributor.address, value: 30 },
            { contributor: fixture.outsider.address, value: 50 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, altStart, altEnd, "acceptProject", altVersion, ALT_PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const managerDevBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBefore = await fixture.devToken.balanceOf(fixture.contributor.address);
        const outsiderDevBefore = await fixture.devToken.balanceOf(fixture.outsider.address);

        await (await fixture.project.withdrawContributions([1n, 2n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n, 2n])).wait();
        await (await fixture.project.connect(fixture.outsider).withdrawContributions([1n, 2n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBefore + 2000n);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBefore + 3000n);
        expect(await fixture.devToken.balanceOf(fixture.outsider.address)).to.equal(outsiderDevBefore + 5000n);
        expect(await fixture.devToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999280n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(270n);
        expect(await fixture.extraToken.balanceOf(fixture.outsider.address)).to.equal(450n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.manager.address)).to.equal(999640n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.contributor.address)).to.equal(135n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.outsider.address)).to.equal(225n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
        expect(await fixture.extraTokenTwo.balanceOf(await fixture.project.getAddress())).to.equal(0n);
    });

    it("isolates a failed dual-token project from a named normal project with rounding in one three-contributor batch", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const firstBlock = await ethers.provider.getBlock("latest");
        if (firstBlock === null) {
            throw new Error("latest block not found");
        }

        const mainStart = BigInt(firstBlock.timestamp);
        const mainEnd = mainStart + THIRTY_DAYS;
        await (await fixture.extraToken.approve(await fixture.project.getAddress(), 600n)).wait();
        await (await fixture.extraTokenTwo.approve(await fixture.project.getAddress(), 300n)).wait();
        await (await fixture.project.createProject(
            10_000,
            PROJECT_NAME,
            PROJECT_VERSION,
            mainStart,
            mainEnd,
            [await fixture.extraToken.getAddress(), await fixture.extraTokenTwo.getAddress()],
            [600n, 300n]
        )).wait();
        await (await fixture.committee.support(1n, projectParams(1n, mainStart, mainEnd, "createProject", PROJECT_VERSION, PROJECT_NAME))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 2, [
            { contributor: fixture.manager.address, value: 20 },
            { contributor: fixture.contributor.address, value: 30 },
            { contributor: fixture.outsider.address, value: 50 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, mainStart, mainEnd, "acceptProject", PROJECT_VERSION, PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const secondBlock = await ethers.provider.getBlock("latest");
        if (secondBlock === null) {
            throw new Error("latest block not found");
        }

        const altVersion = PROJECT_VERSION;
        const altStart = BigInt(secondBlock.timestamp);
        const altEnd = altStart + THIRTY_DAYS;
        await (await fixture.extraToken.approve(await fixture.project.getAddress(), 1_000n)).wait();
        await (await fixture.extraTokenTwo.approve(await fixture.project.getAddress(), 500n)).wait();
        await (await fixture.project.createProject(
            10_000,
            ALT_PROJECT_NAME,
            altVersion,
            altStart,
            altEnd,
            [await fixture.extraToken.getAddress(), await fixture.extraTokenTwo.getAddress()],
            [1_000n, 500n]
        )).wait();
        await (await fixture.committee.support(3n, projectParams(2n, altStart, altEnd, "createProject", altVersion, ALT_PROJECT_NAME))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 3, [
            { contributor: fixture.manager.address, value: 1 },
            { contributor: fixture.contributor.address, value: 1 },
            { contributor: fixture.outsider.address, value: 1 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, altStart, altEnd, "acceptProject", altVersion, ALT_PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const managerDevBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBefore = await fixture.devToken.balanceOf(fixture.contributor.address);
        const outsiderDevBefore = await fixture.devToken.balanceOf(fixture.outsider.address);

        await (await fixture.project.withdrawContributions([1n, 2n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n, 2n])).wait();
        await (await fixture.project.connect(fixture.outsider).withdrawContributions([1n, 2n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBefore + 2666n);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBefore + 2666n);
        expect(await fixture.devToken.balanceOf(fixture.outsider.address)).to.equal(outsiderDevBefore + 2666n);
        expect(await fixture.devToken.balanceOf(await fixture.project.getAddress())).to.equal(2n);

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999466n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(266n);
        expect(await fixture.extraToken.balanceOf(fixture.outsider.address)).to.equal(266n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.manager.address)).to.equal(999733n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.contributor.address)).to.equal(133n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.outsider.address)).to.equal(133n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(2n);
        expect(await fixture.extraTokenTwo.balanceOf(await fixture.project.getAddress())).to.equal(1n);
    });

    it("aggregates rewards across multiple finished projects in one withdrawal", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const first = await createAndPromoteProject(fixture, PROJECT_VERSION);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, first.startDate, first.endDate, "acceptProject", PROJECT_VERSION))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const secondVersion = PROJECT_VERSION + 1n;
        const startDate = BigInt(latestBlock.timestamp);
        const endDate = startDate + THIRTY_DAYS;

        await (await fixture.project.createProject(10_000, PROJECT_NAME, secondVersion, startDate, endDate, [], [])).wait();
        await (await fixture.committee.support(3n, projectParams(2n, startDate, endDate, "createProject", secondVersion))).wait();
        await (await fixture.project.promoteProject(2n)).wait();

        await (await fixture.project.acceptProject(2n, 3, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, startDate, endDate, "acceptProject", secondVersion))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const managerBalanceBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        await (await fixture.project.withdrawContributions([1n, 2n])).wait();
        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerBalanceBefore + 18000n);
    });

    it("aggregates batch withdrawals across projects with different extra tokens", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const firstStartInfo = await createProjectWithExtraToken(fixture, PROJECT_VERSION, 500n);
        await (await fixture.committee.support(1n, projectParams(1n, firstStartInfo.startDate, firstStartInfo.endDate, "createProject", PROJECT_VERSION))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 3, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, firstStartInfo.startDate, firstStartInfo.endDate, "acceptProject", PROJECT_VERSION))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const secondVersion = PROJECT_VERSION + 1n;
        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const secondStart = BigInt(latestBlock.timestamp);
        const secondEnd = secondStart + THIRTY_DAYS;
        await (await fixture.extraTokenTwo.approve(await fixture.project.getAddress(), 300n)).wait();
        await (await fixture.project.createProject(
            10_000,
            PROJECT_NAME,
            secondVersion,
            secondStart,
            secondEnd,
            [await fixture.extraTokenTwo.getAddress()],
            [300n]
        )).wait();
        await (await fixture.committee.support(3n, projectParams(2n, secondStart, secondEnd, "createProject", secondVersion))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 5, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, secondStart, secondEnd, "acceptProject", secondVersion))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const managerDevBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        await (await fixture.project.withdrawContributions([1n, 2n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBefore + 20000n);
        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(1_000_000n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.manager.address)).to.equal(1_000_000n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
        expect(await fixture.extraTokenTwo.balanceOf(await fixture.project.getAddress())).to.equal(0n);
    });

    it("aggregates mixed-result batch withdrawals across different project names and token sets", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const firstBlock = await ethers.provider.getBlock("latest");
        if (firstBlock === null) {
            throw new Error("latest block not found");
        }

        const mainStart = BigInt(firstBlock.timestamp);
        const mainEnd = mainStart + THIRTY_DAYS;
        await (await fixture.extraToken.approve(await fixture.project.getAddress(), 500n)).wait();
        await (await fixture.project.createProject(
            10_000,
            PROJECT_NAME,
            PROJECT_VERSION,
            mainStart,
            mainEnd,
            [await fixture.extraToken.getAddress()],
            [500n]
        )).wait();
        await (await fixture.committee.support(1n, projectParams(1n, mainStart, mainEnd, "createProject", PROJECT_VERSION, PROJECT_NAME))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 3, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, mainStart, mainEnd, "acceptProject", PROJECT_VERSION, PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const secondBlock = await ethers.provider.getBlock("latest");
        if (secondBlock === null) {
            throw new Error("latest block not found");
        }

        const altVersion = PROJECT_VERSION;
        const altStart = BigInt(secondBlock.timestamp);
        const altEnd = altStart + THIRTY_DAYS;
        await (await fixture.extraTokenTwo.approve(await fixture.project.getAddress(), 300n)).wait();
        await (await fixture.project.createProject(
            10_000,
            ALT_PROJECT_NAME,
            altVersion,
            altStart,
            altEnd,
            [await fixture.extraTokenTwo.getAddress()],
            [300n]
        )).wait();
        await (await fixture.committee.support(3n, projectParams(2n, altStart, altEnd, "createProject", altVersion, ALT_PROJECT_NAME))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 4, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, altStart, altEnd, "acceptProject", altVersion, ALT_PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const managerDevBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBefore = await fixture.devToken.balanceOf(fixture.contributor.address);

        await (await fixture.project.withdrawContributions([1n, 2n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n, 2n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBefore + 7200n);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBefore + 10800n);

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999760n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(240n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.manager.address)).to.equal(999820n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.contributor.address)).to.equal(180n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
        expect(await fixture.extraTokenTwo.balanceOf(await fixture.project.getAddress())).to.equal(0n);
    });

    it("isolates multi-token distribution from failed projects in one batch", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const first = await createProjectWithExtraToken(fixture, PROJECT_VERSION, 500n);
        await (await fixture.committee.support(1n, projectParams(1n, first.startDate, first.endDate, "createProject", PROJECT_VERSION))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 2, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, first.startDate, first.endDate, "acceptProject", PROJECT_VERSION))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const secondVersion = PROJECT_VERSION + 1n;
        const secondStart = BigInt(latestBlock.timestamp);
        const secondEnd = secondStart + THIRTY_DAYS;
        await (await fixture.extraToken.approve(await fixture.project.getAddress(), 500n)).wait();
        await (await fixture.extraTokenTwo.approve(await fixture.project.getAddress(), 250n)).wait();
        await (await fixture.project.createProject(
            10_000,
            PROJECT_NAME,
            secondVersion,
            secondStart,
            secondEnd,
            [await fixture.extraToken.getAddress(), await fixture.extraTokenTwo.getAddress()],
            [500n, 250n]
        )).wait();
        await (await fixture.committee.support(3n, projectParams(2n, secondStart, secondEnd, "createProject", secondVersion))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 5, [
            { contributor: fixture.manager.address, value: 40 },
            { contributor: fixture.contributor.address, value: 60 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, secondStart, secondEnd, "acceptProject", secondVersion))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const managerDevBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        const contributorDevBefore = await fixture.devToken.balanceOf(fixture.contributor.address);

        await (await fixture.project.withdrawContributions([1n, 2n])).wait();
        await (await fixture.project.connect(fixture.contributor).withdrawContributions([1n, 2n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerDevBefore + 4800n);
        expect(await fixture.devToken.balanceOf(fixture.contributor.address)).to.equal(contributorDevBefore + 7200n);
        expect(await fixture.devToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);

        expect(await fixture.extraToken.balanceOf(fixture.manager.address)).to.equal(999700n);
        expect(await fixture.extraToken.balanceOf(fixture.contributor.address)).to.equal(300n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.manager.address)).to.equal(999850n);
        expect(await fixture.extraTokenTwo.balanceOf(fixture.contributor.address)).to.equal(150n);
        expect(await fixture.extraToken.balanceOf(await fixture.project.getAddress())).to.equal(0n);
        expect(await fixture.extraTokenTwo.balanceOf(await fixture.project.getAddress())).to.equal(0n);
    });

    it("aggregates batch withdrawals across different project names", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const mainProject = await createAndPromoteNamedProject(fixture, 1n, 1n, PROJECT_NAME, PROJECT_VERSION);
        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, mainProject.startDate, mainProject.endDate, "acceptProject", PROJECT_VERSION, PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const altVersion = PROJECT_VERSION;
        const altProject = await createAndPromoteNamedProject(fixture, 2n, 3n, ALT_PROJECT_NAME, altVersion);
        await (await fixture.project.acceptProject(2n, 3, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, altProject.startDate, altProject.endDate, "acceptProject", altVersion, ALT_PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const managerBalanceBefore = await fixture.devToken.balanceOf(fixture.manager.address);
        await (await fixture.project.withdrawContributions([1n, 2n])).wait();

        expect(await fixture.devToken.balanceOf(fixture.manager.address)).to.equal(managerBalanceBefore + 18000n);

        const mainVersionInfo = await fixture.project.latestProjectVersion(PROJECT_NAME);
        const altVersionInfo = await fixture.project.latestProjectVersion(ALT_PROJECT_NAME);
        expect(mainVersionInfo.version).to.equal(PROJECT_VERSION);
        expect(altVersionInfo.version).to.equal(PROJECT_VERSION);
    });

    it("reverts a batch withdrawal when one project is not finished", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const first = await createAndPromoteProject(fixture, PROJECT_VERSION);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, first.startDate, first.endDate, "acceptProject", PROJECT_VERSION))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        const secondVersion = PROJECT_VERSION + 1n;
        await (await fixture.project.createProject(
            10_000,
            PROJECT_NAME,
            secondVersion,
            BigInt(latestBlock.timestamp),
            BigInt(latestBlock.timestamp) + THIRTY_DAYS,
            [],
            []
        )).wait();

        await expect(
            fixture.project.withdrawContributions([1n, 2n])
        ).to.be.revertedWith("status error");
    });

    it("rejects creating a version that is not newer than the latest released one", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const latestBlock = await ethers.provider.getBlock("latest");
        if (latestBlock === null) {
            throw new Error("latest block not found");
        }

        await expect(
            fixture.project.createProject(
                8_000,
                PROJECT_NAME,
                PROJECT_VERSION,
                BigInt(latestBlock.timestamp),
                BigInt(latestBlock.timestamp) + THIRTY_DAYS,
                [],
                []
            )
        ).to.be.revertedWith("Version must be greater than the latest version");
    });

    it("returns zero release time for versions newer than the latest released one", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);
        const { startDate, endDate } = await createAndPromoteProject(fixture);

        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, startDate, endDate, "acceptProject"))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        expect(await fixture.project.versionReleasedTime(PROJECT_NAME, PROJECT_VERSION + 1n)).to.equal(0n);
    });

    it("returns zeroed version info for unreleased project names", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const versionInfo = await fixture.project.latestProjectVersion(ALT_PROJECT_NAME);
        expect(versionInfo.version).to.equal(0n);
        expect(versionInfo.versionTime).to.equal(0n);
        expect(await fixture.project.versionReleasedTime(ALT_PROJECT_NAME, PROJECT_VERSION)).to.equal(0n);
    });

    it("tracks latest released versions independently per project name", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const firstBlock = await ethers.provider.getBlock("latest");
        if (firstBlock === null) {
            throw new Error("latest block not found");
        }

        const mainStart = BigInt(firstBlock.timestamp);
        const mainEnd = mainStart + THIRTY_DAYS;
        await (await fixture.project.createProject(10_000, PROJECT_NAME, PROJECT_VERSION, mainStart, mainEnd, [], [])).wait();
        await (await fixture.committee.support(1n, projectParams(1n, mainStart, mainEnd, "createProject", PROJECT_VERSION, PROJECT_NAME))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, mainStart, mainEnd, "acceptProject", PROJECT_VERSION, PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const secondBlock = await ethers.provider.getBlock("latest");
        if (secondBlock === null) {
            throw new Error("latest block not found");
        }

        const altStart = BigInt(secondBlock.timestamp);
        const altEnd = altStart + THIRTY_DAYS;
        await (await fixture.project.createProject(10_000, ALT_PROJECT_NAME, PROJECT_VERSION, altStart, altEnd, [], [])).wait();
        await (await fixture.committee.support(3n, projectParams(2n, altStart, altEnd, "createProject", PROJECT_VERSION, ALT_PROJECT_NAME))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, altStart, altEnd, "acceptProject", PROJECT_VERSION, ALT_PROJECT_NAME))).wait();
        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const mainVersion = await fixture.project.latestProjectVersion(PROJECT_NAME);
        const altVersion = await fixture.project.latestProjectVersion(ALT_PROJECT_NAME);
        expect(mainVersion.version).to.equal(PROJECT_VERSION);
        expect(altVersion.version).to.equal(PROJECT_VERSION);
        expect(mainVersion.versionTime).to.not.equal(0n);
        expect(altVersion.versionTime).to.not.equal(0n);
    });

    it("keeps the newest released version when an older version finishes later", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const firstVersion = PROJECT_VERSION;
        const secondVersion = PROJECT_VERSION + 1n;

        const firstBlock = await ethers.provider.getBlock("latest");
        if (firstBlock === null) {
            throw new Error("latest block not found");
        }

        const firstStart = BigInt(firstBlock.timestamp);
        const firstEnd = firstStart + THIRTY_DAYS;
        await (await fixture.project.createProject(10_000, PROJECT_NAME, firstVersion, firstStart, firstEnd, [], [])).wait();
        await (await fixture.committee.support(1n, projectParams(1n, firstStart, firstEnd, "createProject", firstVersion))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, firstStart, firstEnd, "acceptProject", firstVersion))).wait();

        const secondBlock = await ethers.provider.getBlock("latest");
        if (secondBlock === null) {
            throw new Error("latest block not found");
        }

        const secondStart = BigInt(secondBlock.timestamp);
        const secondEnd = secondStart + THIRTY_DAYS;
        await (await fixture.project.createProject(10_000, PROJECT_NAME, secondVersion, secondStart, secondEnd, [], [])).wait();
        await (await fixture.committee.support(3n, projectParams(2n, secondStart, secondEnd, "createProject", secondVersion))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, secondStart, secondEnd, "acceptProject", secondVersion))).wait();

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();

        const latestAfterNewer = await fixture.project.latestProjectVersion(PROJECT_NAME);
        expect(latestAfterNewer.version).to.equal(secondVersion);
        const newerReleaseTime = latestAfterNewer.versionTime;

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();

        const latestAfterOlder = await fixture.project.latestProjectVersion(PROJECT_NAME);
        expect(latestAfterOlder.version).to.equal(secondVersion);
        expect(latestAfterOlder.versionTime).to.equal(newerReleaseTime);
        expect(await fixture.project.versionReleasedTime(PROJECT_NAME, firstVersion)).to.equal(newerReleaseTime);
        expect(await fixture.project.versionReleasedTime(PROJECT_NAME, secondVersion)).to.equal(newerReleaseTime);
    });

    it("preserves the highest released version during three-version interleaved finishes", async function () {
        const fixture = await networkHelpers.loadFixture(deployProjectFixture);

        const firstVersion = PROJECT_VERSION;
        const secondVersion = PROJECT_VERSION + 1n;
        const thirdVersion = PROJECT_VERSION + 2n;

        const firstBlock = await ethers.provider.getBlock("latest");
        if (firstBlock === null) {
            throw new Error("latest block not found");
        }

        const firstStart = BigInt(firstBlock.timestamp);
        const firstEnd = firstStart + THIRTY_DAYS;
        await (await fixture.project.createProject(10_000, PROJECT_NAME, firstVersion, firstStart, firstEnd, [], [])).wait();
        await (await fixture.committee.support(1n, projectParams(1n, firstStart, firstEnd, "createProject", firstVersion))).wait();
        await (await fixture.project.promoteProject(1n)).wait();
        await (await fixture.project.acceptProject(1n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(2n, projectParams(1n, firstStart, firstEnd, "acceptProject", firstVersion))).wait();

        const secondBlock = await ethers.provider.getBlock("latest");
        if (secondBlock === null) {
            throw new Error("latest block not found");
        }

        const secondStart = BigInt(secondBlock.timestamp);
        const secondEnd = secondStart + THIRTY_DAYS;
        await (await fixture.project.createProject(10_000, PROJECT_NAME, secondVersion, secondStart, secondEnd, [], [])).wait();
        await (await fixture.committee.support(3n, projectParams(2n, secondStart, secondEnd, "createProject", secondVersion))).wait();
        await (await fixture.project.promoteProject(2n)).wait();
        await (await fixture.project.acceptProject(2n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(4n, projectParams(2n, secondStart, secondEnd, "acceptProject", secondVersion))).wait();

        const thirdBlock = await ethers.provider.getBlock("latest");
        if (thirdBlock === null) {
            throw new Error("latest block not found");
        }

        const thirdStart = BigInt(thirdBlock.timestamp);
        const thirdEnd = thirdStart + THIRTY_DAYS;
        await (await fixture.project.createProject(10_000, PROJECT_NAME, thirdVersion, thirdStart, thirdEnd, [], [])).wait();
        await (await fixture.committee.support(5n, projectParams(3n, thirdStart, thirdEnd, "createProject", thirdVersion))).wait();
        await (await fixture.project.promoteProject(3n)).wait();
        await (await fixture.project.acceptProject(3n, 4, [
            { contributor: fixture.manager.address, value: 100 }
        ])).wait();
        await (await fixture.committee.support(6n, projectParams(3n, thirdStart, thirdEnd, "acceptProject", thirdVersion))).wait();

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(2n)).wait();
        const afterSecond = await fixture.project.latestProjectVersion(PROJECT_NAME);
        const finishAfterSecond = await fixture.project.latestProjectFinishTime();
        expect(afterSecond.version).to.equal(secondVersion);
        expect(afterSecond.versionTime).to.be.greaterThan(0n);

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(3n)).wait();
        const afterThird = await fixture.project.latestProjectVersion(PROJECT_NAME);
        const finishAfterThird = await fixture.project.latestProjectFinishTime();
        expect(afterThird.version).to.equal(thirdVersion);
        expect(afterThird.versionTime).to.be.greaterThan(afterSecond.versionTime);
        expect(finishAfterThird).to.be.greaterThan(finishAfterSecond);

        await networkHelpers.time.increase(7n * 24n * 60n * 60n + 1n);
        await (await fixture.project.promoteProject(1n)).wait();
        const afterFirst = await fixture.project.latestProjectVersion(PROJECT_NAME);
        const finishAfterFirst = await fixture.project.latestProjectFinishTime();

        expect(afterFirst.version).to.equal(thirdVersion);
        expect(afterFirst.versionTime).to.equal(afterThird.versionTime);
        expect(finishAfterFirst).to.be.greaterThan(finishAfterThird);
        expect(await fixture.project.versionReleasedTime(PROJECT_NAME, firstVersion)).to.equal(afterThird.versionTime);
        expect(await fixture.project.versionReleasedTime(PROJECT_NAME, secondVersion)).to.equal(afterThird.versionTime);
        expect(await fixture.project.versionReleasedTime(PROJECT_NAME, thirdVersion)).to.equal(afterThird.versionTime);
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
