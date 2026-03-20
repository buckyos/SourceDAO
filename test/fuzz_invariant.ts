import hre from "hardhat";
import { expect } from "chai";

import { deployUUPSProxy } from "../test-hh3/helpers/uups.js";

const { ethers, networkHelpers } = await hre.network.connect();

const MAIN_PROJECT_NAME = ethers.encodeBytes32String("SourceDao");
const COMMITTEE_PROJECT_NAME = ethers.encodeBytes32String("main");
const ONE_HOUR = 3600n;
const SEVEN_DAYS = 7n * 24n * 60n * 60n;
const THIRTY_DAYS = 30n * 24n * 60n * 60n;
const SIX_MONTHS = 180n * 24n * 60n * 60n;
const FULL_PROPOSAL_DURATION = 7n * 24n * 60n * 60n;

function createPrng(seed: number) {
    let state = BigInt(seed);
    const modulus = 2n ** 31n;
    return () => {
        state = (state * 1103515245n + 12345n) % modulus;
        return Number(state);
    };
}

function pick<T>(items: T[], next: () => number): T {
    return items[next() % items.length];
}

function randomBetween(min: bigint, max: bigint, next: () => number): bigint {
    if (max <= min) {
        return min;
    }
    const span = Number(max - min + 1n);
    return min + BigInt(next() % span);
}

function coefficientForResult(result: number) {
    if (result === 5) {
        return 120n;
    }
    if (result === 4) {
        return 100n;
    }
    return 80n;
}

function projectParams(
    projectId: bigint,
    version: bigint,
    startDate: bigint,
    endDate: bigint,
    action: "createProject" | "acceptProject"
) {
    return [
        ethers.zeroPadValue(ethers.toBeHex(projectId), 32),
        MAIN_PROJECT_NAME,
        ethers.zeroPadValue(ethers.toBeHex(version), 32),
        ethers.zeroPadValue(ethers.toBeHex(startDate), 32),
        ethers.zeroPadValue(ethers.toBeHex(endDate), 32),
        ethers.encodeBytes32String(action)
    ];
}

async function deployDividendInvariantFixture() {
    const signers = await ethers.getSigners();
    const [owner, ...users] = signers;
    const stakers = users.slice(0, 3);

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        20_000,
        stakers.map((user: { address: string }) => user.address),
        [3_000, 2_500, 2_000],
        daoAddress
    ]);
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["BDT", "BDT", daoAddress]);
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();

    const dividend = await deployUUPSProxy(ethers, "DividendContract", [Number(ONE_HOUR), daoAddress]);
    await (await dao.setTokenDividendAddress(await dividend.getAddress())).wait();

    await (await devToken.connect(stakers[0]).dev2normal(900n)).wait();
    await (await devToken.connect(stakers[1]).dev2normal(700n)).wait();
    await (await devToken.connect(stakers[2]).dev2normal(500n)).wait();

    const rewardToken = await (await ethers.getContractFactory("TestToken")).deploy(
        "InvariantReward",
        "IRWD",
        18,
        1_000_000n,
        owner.address
    );
    await rewardToken.waitForDeployment();
    await (await rewardToken.approve(await dividend.getAddress(), 1_000_000n)).wait();

    return {
        owner,
        stakers,
        devToken,
        normalToken,
        dividend,
        rewardToken
    };
}

async function deployLockupInvariantFixture() {
    const signers = await ethers.getSigners();
    const [owner, alice, bob] = signers;

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const project = await (await ethers.getContractFactory("ProjectVersionMock")).deploy();
    await project.waitForDeployment();
    await (await dao.setProjectAddress(await project.getAddress())).wait();

    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        15_000,
        [owner.address],
        [8_000],
        daoAddress
    ]);
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["BDT", "BDT", daoAddress]);
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();
    await (await devToken.dev2normal(3_000n)).wait();

    const lockup = await deployUUPSProxy(ethers, "SourceTokenLockup", [
        MAIN_PROJECT_NAME,
        100001,
        daoAddress
    ]);
    await (await dao.setTokenLockupAddress(await lockup.getAddress())).wait();

    return {
        owner,
        users: [owner, alice, bob],
        project,
        devToken,
        normalToken,
        lockup
    };
}

async function deployCommitteeInvariantFixture() {
    const signers = await ethers.getSigners();
    const committeeMembers = signers.slice(1, 4);
    const holders = signers.slice(1, 9);

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        committeeMembers.map((signer: { address: string }) => signer.address),
        1,
        200,
        COMMITTEE_PROJECT_NAME,
        1,
        150,
        daoAddress
    ]);
    await (await dao.setCommitteeAddress(await committee.getAddress())).wait();

    const project = await (await ethers.getContractFactory("ProjectVersionMock")).deploy();
    await project.waitForDeployment();
    await (await dao.setProjectAddress(await project.getAddress())).wait();

    const proposalCaller = await (await ethers.getContractFactory("CommitteeProposalCallerMock")).deploy();
    await proposalCaller.waitForDeployment();
    await (await dao.setAcquiredAddress(await proposalCaller.getAddress())).wait();

    const devToken = await deployUUPSProxy(ethers, "DevToken", [
        "BDDT",
        "BDDT",
        20_000,
        holders.map((holder: { address: string }) => holder.address),
        [2_000, 1_500, 1_200, 1_000, 800, 700, 600, 500],
        daoAddress
    ]);
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

    const normalToken = await deployUUPSProxy(ethers, "NormalToken", ["BDT", "BDT", daoAddress]);
    await (await dao.setNormalTokenAddress(await normalToken.getAddress())).wait();

    await (await devToken.connect(holders[0]).dev2normal(600n)).wait();
    await (await devToken.connect(holders[3]).dev2normal(400n)).wait();
    await (await devToken.connect(holders[5]).dev2normal(250n)).wait();

    return {
        committee,
        proposalCaller,
        devToken,
        normalToken,
        holders
    };
}

async function deployProjectInvariantFixture() {
    const signers = await ethers.getSigners();
    const [manager, contributorA, contributorB, contributorC] = signers;

    const dao = await deployUUPSProxy(ethers, "SourceDao");
    const daoAddress = await dao.getAddress();

    const committee = await deployUUPSProxy(ethers, "SourceDaoCommittee", [
        [manager.address],
        1,
        200,
        MAIN_PROJECT_NAME,
        100001,
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
        [50_000],
        daoAddress
    ]);
    await (await dao.setDevTokenAddress(await devToken.getAddress())).wait();

    const extraToken = await (await ethers.getContractFactory("TestToken")).deploy(
        "ExtraOne",
        "EXT1",
        18,
        1_000_000n,
        manager.address
    );
    await extraToken.waitForDeployment();

    const extraTokenTwo = await (await ethers.getContractFactory("TestToken")).deploy(
        "ExtraTwo",
        "EXT2",
        18,
        1_000_000n,
        manager.address
    );
    await extraTokenTwo.waitForDeployment();

    await (await extraToken.approve(await project.getAddress(), 1_000_000n)).wait();
    await (await extraTokenTwo.approve(await project.getAddress(), 1_000_000n)).wait();

    return {
        manager,
        contributors: [contributorA, contributorB, contributorC],
        committee,
        project,
        devToken,
        extraToken,
        extraTokenTwo
    };
}

describe("Fuzz / Invariant", function () {
    it("keeps Dividend stake accounting and reward conservation stable under deterministic randomized operations", async function () {
        const { stakers, devToken, normalToken, dividend, rewardToken } = await networkHelpers.loadFixture(
            deployDividendInvariantFixture
        );
        const next = createPrng(1337);
        const model = new Map<string, { normal: bigint; dev: bigint }>(
            stakers.map((user: any) => [user.address, { normal: 0n, dev: 0n }])
        );
        let totalDepositedReward = 0n;

        async function assertStakeInvariant() {
            const currentCycle = await dividend.getCurrentCycleIndex();
            let totalExpected = 0n;

            for (const user of stakers) {
                const expected = model.get(user.address)!;
                totalExpected += expected.normal + expected.dev;
                expect(await dividend.connect(user).getStakeAmount(currentCycle)).to.equal(expected.normal + expected.dev);
            }

            expect(await dividend.getTotalStaked(currentCycle)).to.equal(totalExpected);
            expect(await rewardToken.balanceOf(await dividend.getAddress())).to.equal(
                await dividend.getDepositTokenBalance(await rewardToken.getAddress())
            );
        }

        for (let step = 0; step < 24; step++) {
            const action = next() % 6;
            const user = pick(stakers, next);
            const state = model.get(user.address)!;

            if (action === 0) {
                const balance = await normalToken.balanceOf(user.address);
                if (balance > 0n) {
                    const amount = randomBetween(1n, balance < 200n ? balance : 200n, next);
                    await (await normalToken.connect(user).approve(await dividend.getAddress(), amount)).wait();
                    await (await dividend.connect(user).stakeNormal(amount)).wait();
                    state.normal += amount;
                }
            } else if (action === 1) {
                if (state.normal > 0n) {
                    const amount = randomBetween(1n, state.normal < 150n ? state.normal : 150n, next);
                    await (await dividend.connect(user).unstakeNormal(amount)).wait();
                    state.normal -= amount;
                }
            } else if (action === 2) {
                const balance = await devToken.balanceOf(user.address);
                if (balance > 0n) {
                    const amount = randomBetween(1n, balance < 160n ? balance : 160n, next);
                    await (await devToken.connect(user).approve(await dividend.getAddress(), amount)).wait();
                    await (await dividend.connect(user).stakeDev(amount)).wait();
                    state.dev += amount;
                }
            } else if (action === 3) {
                if (state.dev > 0n) {
                    const amount = randomBetween(1n, state.dev < 120n ? state.dev : 120n, next);
                    await (await dividend.connect(user).unstakeDev(amount)).wait();
                    state.dev -= amount;
                }
            } else if (action === 4) {
                const amount = randomBetween(10n, 80n, next);
                await (await dividend.deposit(amount, await rewardToken.getAddress())).wait();
                totalDepositedReward += amount;
            } else {
                await networkHelpers.time.increase(ONE_HOUR + 1n);
                await (await dividend.tryNewCycle()).wait();
            }

            await assertStakeInvariant();
        }

        await networkHelpers.time.increase(ONE_HOUR + 1n);
        await (await dividend.tryNewCycle()).wait();
        await assertStakeInvariant();

        const currentCycle = await dividend.getCurrentCycleIndex();
        const claimCycles: bigint[] = [];
        for (let cycle = 1n; cycle < currentCycle; cycle++) {
            claimCycles.push(cycle);
        }

        const rewardBalancesBefore = new Map<string, bigint>();
        for (const user of stakers) {
            rewardBalancesBefore.set(user.address, await rewardToken.balanceOf(user.address));
        }

        if (claimCycles.length > 0) {
            for (const user of stakers) {
                await (await dividend.connect(user).withdrawDividends(claimCycles, [await rewardToken.getAddress()])).wait();
            }
        }

        let totalClaimedReward = 0n;
        for (const user of stakers) {
            totalClaimedReward += (await rewardToken.balanceOf(user.address)) - rewardBalancesBefore.get(user.address)!;
        }

        const remainingReward = await rewardToken.balanceOf(await dividend.getAddress());
        expect(totalClaimedReward + remainingReward).to.equal(totalDepositedReward);
    });

    it("keeps Lockup assignment and claim conservation stable under deterministic randomized operations", async function () {
        const { users, project, devToken, normalToken, lockup } = await networkHelpers.loadFixture(
            deployLockupInvariantFixture
        );
        const [owner] = users;
        const next = createPrng(4242);
        const assigned = new Map<string, bigint>(users.map((user: any) => [user.address, 0n]));
        const claimed = new Map<string, bigint>(users.map((user: any) => [user.address, 0n]));

        async function assertLockupInvariant() {
            let totalAssigned = 0n;
            let totalClaimed = 0n;

            for (const user of users) {
                totalAssigned += assigned.get(user.address)!;
                totalClaimed += claimed.get(user.address)!;
                expect(await lockup.totalAssigned(user.address)).to.equal(assigned.get(user.address)!);
                expect(await lockup.totalClaimed(user.address)).to.equal(claimed.get(user.address)!);
            }

            expect(await lockup.totalAssigned(ethers.ZeroAddress)).to.equal(totalAssigned);
            expect(await lockup.totalClaimed(ethers.ZeroAddress)).to.equal(totalClaimed);
            expect(await normalToken.balanceOf(await lockup.getAddress()) + totalClaimed).to.equal(totalAssigned);
        }

        for (let step = 0; step < 12; step++) {
            const isConvert = next() % 2 === 0;
            const batchSize = 1 + (next() % 3);
            const recipients: string[] = [];
            const amounts: bigint[] = [];
            let totalAmount = 0n;

            const available = isConvert
                ? await devToken.balanceOf(owner.address)
                : await normalToken.balanceOf(owner.address);
            if (available === 0n) {
                continue;
            }

            const maxPerEntry = available < 300n ? available : 300n;
            for (let i = 0; i < batchSize; i++) {
                const recipient = pick(users, next);
                const remaining = available - totalAmount;
                if (remaining === 0n) {
                    break;
                }
                const amount = randomBetween(1n, remaining < maxPerEntry ? remaining : maxPerEntry, next);
                recipients.push(recipient.address);
                amounts.push(amount);
                totalAmount += amount;
                assigned.set(recipient.address, assigned.get(recipient.address)! + amount);
            }

            if (recipients.length === 0) {
                continue;
            }

            if (isConvert) {
                await (await devToken.approve(await lockup.getAddress(), totalAmount)).wait();
                await (await lockup.convertAndLock(recipients, amounts)).wait();
            } else {
                await (await normalToken.approve(await lockup.getAddress(), totalAmount)).wait();
                await (await lockup.transferAndLock(recipients, amounts)).wait();
            }

            await assertLockupInvariant();
        }

        const releaseTime = BigInt(await networkHelpers.time.latest());
        await (await project.setVersionReleasedTime(MAIN_PROJECT_NAME, 100001, releaseTime)).wait();

        for (let step = 0; step < 6; step++) {
            await networkHelpers.time.increase(randomBetween(15n * 24n * 60n * 60n, 45n * 24n * 60n * 60n, next));
            const user = pick(users, next);
            const maxClaim = await lockup.connect(user).getCanClaimTokens();
            if (maxClaim > 0n) {
                const amount = randomBetween(1n, maxClaim, next);
                await (await lockup.connect(user).claimTokens(amount)).wait();
                claimed.set(user.address, claimed.get(user.address)! + amount);
            }
            await assertLockupInvariant();
        }

        await networkHelpers.time.increase(SIX_MONTHS);
        for (const user of users) {
            const remaining = await lockup.connect(user).getCanClaimTokens();
            if (remaining > 0n) {
                await (await lockup.connect(user).claimTokens(remaining)).wait();
                claimed.set(user.address, claimed.get(user.address)! + remaining);
            }
        }

        await assertLockupInvariant();
        expect(await lockup.totalAssigned(ethers.ZeroAddress)).to.equal(await lockup.totalClaimed(ethers.ZeroAddress));
    });

    it("settles a deterministic randomized full proposal consistently across shuffled batches when balances stay fixed", async function () {
        const { committee, proposalCaller, devToken, normalToken, holders } = await networkHelpers.loadFixture(
            deployCommitteeInvariantFixture
        );
        const next = createPrng(9090);
        const proposalParams = [ethers.encodeBytes32String("fuzz-full-proposal")];

        await (await proposalCaller.fullPropose(
            await committee.getAddress(),
            Number(FULL_PROPOSAL_DURATION),
            proposalParams,
            10
        )).wait();

        const voters: Array<{ signer: any; support: boolean }> = [];
        for (const holder of holders) {
            const support = next() % 2 === 0;
            if (support) {
                await (await committee.connect(holder).support(1n, proposalParams)).wait();
            } else {
                await (await committee.connect(holder).reject(1n, proposalParams)).wait();
            }
            voters.push({ signer: holder, support });
        }

        let expectedAgree = 0n;
        let expectedReject = 0n;
        for (const voter of voters) {
            const normalBalance = await normalToken.balanceOf(voter.signer.address);
            const devBalance = await devToken.balanceOf(voter.signer.address);
            const power = normalBalance + (devBalance * 200n) / 100n;
            if (voter.support) {
                expectedAgree += power;
            } else {
                expectedReject += power;
            }
        }

        await networkHelpers.time.increase(FULL_PROPOSAL_DURATION + 1n);

        const shuffled = [...voters.map((entry) => entry.signer.address)];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = next() % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        shuffled.splice(2, 0, shuffled[0]);
        shuffled.push(shuffled[3]);

        const batches = [
            shuffled.slice(0, 4),
            shuffled.slice(4, 8),
            shuffled.slice(8)
        ];

        for (const batch of batches) {
            await (await committee.endFullPropose(1n, batch)).wait();
        }

        const extra = await committee.proposalExtraOf(1n);
        const proposal = await committee.proposalOf(1n);

        expect(extra.agree).to.equal(expectedAgree);
        expect(extra.reject).to.equal(expectedReject);
        expect(extra.settled).to.equal(BigInt(voters.length));

        const totalReleased = await normalToken.totalSupply() + ((await devToken.totalReleased()) * 200n) / 100n;
        expect(extra.totalReleasedToken).to.equal(totalReleased);

        let expectedState = 5n;
        if (expectedAgree + expectedReject >= (totalReleased * 10n) / 100n) {
            expectedState = expectedAgree > expectedReject ? 2n : 3n;
        }
        expect(proposal.state).to.equal(expectedState);
    });

    it("keeps Project reward conservation stable across deterministic randomized contribution rewrites", async function () {
        const { contributors, committee, project, devToken, extraToken, extraTokenTwo } = await networkHelpers.loadFixture(
            deployProjectInvariantFixture
        );
        const next = createPrng(20260319);

        const projectIds: bigint[] = [];
        const expectedDevByContributor = new Map<string, bigint>(contributors.map((user: any) => [user.address, 0n]));
        const expectedExtraOneByContributor = new Map<string, bigint>(contributors.map((user: any) => [user.address, 0n]));
        const expectedExtraTwoByContributor = new Map<string, bigint>(contributors.map((user: any) => [user.address, 0n]));
        let expectedProjectDevDust = 0n;
        let expectedProjectExtraOneDust = 0n;
        let expectedProjectExtraTwoDust = 0n;

        for (let index = 0; index < 3; index++) {
            const latestBlock = await ethers.provider.getBlock("latest");
            if (latestBlock === null) {
                throw new Error("latest block not found");
            }

            const projectId = BigInt(index + 1);
            const version = 100001n + BigInt(index);
            const startDate = BigInt(latestBlock.timestamp);
            const endDate = startDate + THIRTY_DAYS;
            const budget = randomBetween(5_000n, 12_000n, next);
            const extraOneAmount = randomBetween(80n, 220n, next);
            const extraTwoAmount = randomBetween(60n, 180n, next);

            await (await project.createProject(
                budget,
                MAIN_PROJECT_NAME,
                version,
                startDate,
                endDate,
                [await extraToken.getAddress(), await extraTokenTwo.getAddress()],
                [extraOneAmount, extraTwoAmount]
            )).wait();

            await (await committee.support(
                BigInt(index * 2 + 1),
                projectParams(projectId, version, startDate, endDate, "createProject")
            )).wait();
            await (await project.promoteProject(projectId)).wait();

            const contributionState = new Map<string, bigint>();
            for (const contributor of contributors) {
                contributionState.set(contributor.address, randomBetween(10n, 80n, next));
            }

            await (await project.acceptProject(
                projectId,
                3 + (next() % 3),
                contributors.map((contributor: any) => ({
                    contributor: contributor.address,
                    value: contributionState.get(contributor.address)!
                }))
            )).wait();

            await (await committee.support(
                BigInt(index * 2 + 2),
                projectParams(projectId, version, startDate, endDate, "acceptProject")
            )).wait();

            const rewriteCount = 1 + (next() % 3);
            for (let rewrite = 0; rewrite < rewriteCount; rewrite++) {
                const contributor = pick(contributors, next);
                const newValue = randomBetween(10n, 120n, next);
                contributionState.set(contributor.address, newValue);
                await (await project.updateContribute(projectId, {
                    contributor: contributor.address,
                    value: newValue
                })).wait();
            }

            const projectBrief = await project.projectOf(projectId);
            const coefficient = coefficientForResult(Number(projectBrief.result));
            const reward = (budget * coefficient) / 100n;
            const totalContribution = [...contributionState.values()].reduce((sum, value) => sum + value, 0n);

            let distributedDev = 0n;
            let distributedExtraOne = 0n;
            let distributedExtraTwo = 0n;
            const extraRefundOne = coefficient < 100n ? (extraOneAmount * (100n - coefficient)) / 100n : 0n;
            const extraRefundTwo = coefficient < 100n ? (extraTwoAmount * (100n - coefficient)) / 100n : 0n;

            for (const contributor of contributors) {
                const contribution = contributionState.get(contributor.address)!;
                const devShare = (reward * contribution) / totalContribution;
                const extraOneShare = ((extraOneAmount * (coefficient > 100n ? 100n : coefficient)) / 100n) * contribution / totalContribution;
                const extraTwoShare = ((extraTwoAmount * (coefficient > 100n ? 100n : coefficient)) / 100n) * contribution / totalContribution;

                expectedDevByContributor.set(
                    contributor.address,
                    expectedDevByContributor.get(contributor.address)! + devShare
                );
                expectedExtraOneByContributor.set(
                    contributor.address,
                    expectedExtraOneByContributor.get(contributor.address)! + extraOneShare
                );
                expectedExtraTwoByContributor.set(
                    contributor.address,
                    expectedExtraTwoByContributor.get(contributor.address)! + extraTwoShare
                );

                distributedDev += devShare;
                distributedExtraOne += extraOneShare;
                distributedExtraTwo += extraTwoShare;
            }

            expectedProjectDevDust += reward - distributedDev;
            expectedProjectExtraOneDust += extraOneAmount - extraRefundOne - distributedExtraOne;
            expectedProjectExtraTwoDust += extraTwoAmount - extraRefundTwo - distributedExtraTwo;
            projectIds.push(projectId);

            if (index > 0) {
                await networkHelpers.time.increase(SEVEN_DAYS + 1n);
            }
            await (await project.promoteProject(projectId)).wait();
        }

        const withdrawalOrder = [...contributors];
        for (let i = withdrawalOrder.length - 1; i > 0; i--) {
            const j = next() % (i + 1);
            [withdrawalOrder[i], withdrawalOrder[j]] = [withdrawalOrder[j], withdrawalOrder[i]];
        }

        const devBalancesBefore = new Map<string, bigint>();
        const extraOneBalancesBefore = new Map<string, bigint>();
        const extraTwoBalancesBefore = new Map<string, bigint>();

        for (const contributor of contributors) {
            devBalancesBefore.set(contributor.address, await devToken.balanceOf(contributor.address));
            extraOneBalancesBefore.set(contributor.address, await extraToken.balanceOf(contributor.address));
            extraTwoBalancesBefore.set(contributor.address, await extraTokenTwo.balanceOf(contributor.address));
        }

        for (const contributor of withdrawalOrder) {
            await (await project.connect(contributor).withdrawContributions(projectIds)).wait();
        }

        for (const contributor of contributors) {
            expect((await devToken.balanceOf(contributor.address)) - devBalancesBefore.get(contributor.address)!).to.equal(
                expectedDevByContributor.get(contributor.address)!
            );
            expect((await extraToken.balanceOf(contributor.address)) - extraOneBalancesBefore.get(contributor.address)!).to.equal(
                expectedExtraOneByContributor.get(contributor.address)!
            );
            expect((await extraTokenTwo.balanceOf(contributor.address)) - extraTwoBalancesBefore.get(contributor.address)!).to.equal(
                expectedExtraTwoByContributor.get(contributor.address)!
            );
        }

        expect(await devToken.balanceOf(await project.getAddress())).to.equal(expectedProjectDevDust);
        expect(await extraToken.balanceOf(await project.getAddress())).to.equal(expectedProjectExtraOneDust);
        expect(await extraTokenTwo.balanceOf(await project.getAddress())).to.equal(expectedProjectExtraTwoDust);
    });
});
