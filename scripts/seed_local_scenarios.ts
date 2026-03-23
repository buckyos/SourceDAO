import hre from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const connection: any = await hre.network.connect("localhost");
const ethers = connection.ethers;
const networkHelpers = connection.networkHelpers;

const TOKEN_DECIMALS = 18;
const ONE_HOUR = 3600n;
const ONE_DAY = 24n * 60n * 60n;
const TWO_DAYS = 2n * ONE_DAY;
const THREE_DAYS = 3n * ONE_DAY;
const FOUR_DAYS = 4n * ONE_DAY;
const SEVEN_DAYS = 7n * ONE_DAY;
const THIRTY_DAYS = 30n * ONE_DAY;
const NINETY_DAYS = 90n * ONE_DAY;

const DEFAULT_BACKEND_URL = "http://127.0.0.1:3333";
const DEFAULT_MANIFEST_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.local-dev/seed-manifest.json",
);

type CliOptions = {
    preset: string;
    backendUrl: string;
    manifestPath: string;
};

type BackendOutput<T> = {
    code: number;
    msg?: string | null;
    data?: T;
};

type ContractInfo = {
    main: string;
    committee: string;
    project: string;
    lockup: string;
    dividend: string;
    acquired: string;
    normal_token: string;
    dev_token: string;
    chainId: number;
};

type BackendStatus = {
    cur_block: number;
    total_propose: number;
    total_project: number;
    total_acquired: number;
};

type BackendSession = {
    label: string;
    address: string;
    token: string;
    signer: any;
};

type ProjectProfileDraft = {
    project_name: string;
    github_url: string;
    description: string;
    state: string;
    current_version: string;
    stage: string;
};

type SeedProject = {
    label: string;
    projectName: string;
    version: string;
    versionValue: bigint;
    manager: BackendSession;
    projectId: bigint;
    createProposalId: bigint;
    acceptProposalId?: bigint;
    startDate: bigint;
    endDate: bigint;
    createTxHash: string;
    acceptTxHash?: string;
    issueLink: string;
};

type SeedInvestment = {
    label: string;
    id: bigint;
    txHash: string;
};

type SeedManifest = {
    preset: string;
    backendUrl: string;
    chainId: number;
    generatedAt: string;
    seedTag: string;
    accounts: Record<string, string>;
    contracts: Record<string, string>;
    tokens: {
        rewardToken: string;
        saleToken: string;
    };
    projectProfiles: Array<{
        label: string;
        name: string;
        owner: string;
        currentVersion: string;
        state: string;
    }>;
    projects: Array<{
        label: string;
        projectId: string;
        name: string;
        version: string;
        createProposalId: string;
        acceptProposalId?: string;
        note: string;
    }>;
    investments: Array<{
        label: string;
        id: string;
        note: string;
    }>;
    notes: string[];
};

const INVESTMENT_RATIO_FIVE_TO_ONE = {
    tokenAmount: 5n,
    daoTokenAmount: 1n,
};

function printHeader(title: string) {
    console.log(`\n=== ${title} ===`);
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenUnits(value: number | string | bigint) {
    return ethers.parseUnits(value.toString(), TOKEN_DECIMALS);
}

function toBytes32(value: bigint) {
    return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

function convertVersion(version: string): bigint {
    const [majorRaw, minorRaw, patchRaw] = version.split(".");
    if (
        majorRaw === undefined
        || minorRaw === undefined
        || patchRaw === undefined
    ) {
        throw new Error(`invalid version string ${version}`);
    }

    const major = BigInt(majorRaw);
    const minor = BigInt(minorRaw);
    const patch = BigInt(patchRaw);
    return major * 10_000_000_000n + minor * 100_000n + patch;
}

function buildProjectParams(
    projectId: bigint,
    projectName: string,
    version: bigint,
    startDate: bigint,
    endDate: bigint,
    action: "createProject" | "acceptProject",
) {
    return [
        toBytes32(projectId),
        ethers.encodeBytes32String(projectName),
        toBytes32(version),
        toBytes32(startDate),
        toBytes32(endDate),
        ethers.encodeBytes32String(action),
    ];
}

function buildProjectSlug(projectName: string) {
    const slug = projectName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return slug || encodeURIComponent(projectName.trim());
}

function parseCliOptions(argv: string[]): CliOptions {
    let preset = process.env.SOURCE_DAO_LOCAL_SCENARIO?.trim() || "full-ui";
    let backendUrl = process.env.SOURCE_DAO_BACKEND_URL?.trim() || DEFAULT_BACKEND_URL;
    let manifestPath =
        process.env.SOURCE_DAO_LOCAL_SCENARIO_MANIFEST?.trim() || DEFAULT_MANIFEST_PATH;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--preset") {
            const next = argv[index + 1];
            if (!next || next.startsWith("--")) {
                throw new Error("--preset requires a value");
            }
            preset = next;
            index += 1;
            continue;
        }

        if (arg === "--backend-url") {
            const next = argv[index + 1];
            if (!next || next.startsWith("--")) {
                throw new Error("--backend-url requires a value");
            }
            backendUrl = next;
            index += 1;
            continue;
        }

        if (arg === "--manifest") {
            const next = argv[index + 1];
            if (!next || next.startsWith("--")) {
                throw new Error("--manifest requires a path");
            }
            manifestPath = path.resolve(process.cwd(), next);
            index += 1;
        }
    }

    return { preset, backendUrl, manifestPath };
}

async function parseBackendOutput<T>(response: Response, label: string): Promise<T> {
    const text = await response.text();
    if (!text) {
        throw new Error(`${label}: empty response body (${response.status})`);
    }

    let payload: BackendOutput<T>;
    try {
        payload = JSON.parse(text) as BackendOutput<T>;
    } catch (error) {
        throw new Error(`${label}: invalid JSON response (${String(error)})`);
    }

    if (payload.code !== 0) {
        throw new Error(`${label}: ${payload.msg || `backend code ${payload.code}`}`);
    }

    if (payload.data === undefined) {
        throw new Error(`${label}: missing data field`);
    }

    return payload.data;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${url} failed with ${response.status}: ${text || "empty response"}`);
    }

    return (await response.json()) as T;
}

async function fetchContractInfo(backendUrl: string): Promise<ContractInfo> {
    return fetchJson<ContractInfo>(`${backendUrl}/contract/info`);
}

async function fetchStatus(backendUrl: string): Promise<BackendStatus> {
    return fetchJson<BackendStatus>(`${backendUrl}/status`);
}

async function waitForBackendSync(backendUrl: string, targetBlock: bigint) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
        const status = await fetchStatus(backendUrl);
        if (BigInt(status.cur_block) >= targetBlock) {
            return true;
        }
        await sleep(1000);
    }

    return false;
}

async function createBackendSession(
    backendUrl: string,
    label: string,
    signer: any,
): Promise<BackendSession> {
    const address = await signer.getAddress();
    const loginResp = await fetch(
        `${backendUrl}/user/devlogin?address=${encodeURIComponent(address)}`,
    );

    if (loginResp.status === 404) {
        throw new Error(
            "local backend devlogin is disabled; enable local dev auth before running seed:local",
        );
    }

    const token = await parseBackendOutput<string>(
        loginResp,
        `devlogin for ${label}`,
    );
    const sign = await signer.signMessage(token);

    const bindResp = await fetch(`${backendUrl}/user/bind`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "Dao-Token": token,
        },
        body: JSON.stringify({ sign }),
    });

    if (bindResp.status !== 200) {
        const text = await bindResp.text();
        throw new Error(
            `bind wallet failed for ${label}: ${bindResp.status} ${text || ""}`.trim(),
        );
    }

    return {
        label,
        address,
        token,
        signer,
    };
}

async function postBackend<T>(
    backendUrl: string,
    pathName: string,
    token: string,
    payload: Record<string, unknown>,
    label: string,
) {
    const response = await fetch(`${backendUrl}${pathName}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "Dao-Token": token,
        },
        body: JSON.stringify(payload),
    });

    return parseBackendOutput<T>(response, label);
}

async function upsertProjectProfile(
    backendUrl: string,
    session: BackendSession,
    profile: ProjectProfileDraft,
) {
    const projectId = buildProjectSlug(profile.project_name);
    const detail = {
        id: projectId,
        project_id: projectId,
        project_name: profile.project_name,
        state: profile.state,
        date: new Date().toISOString().slice(0, 10),
        current_version: profile.current_version,
        stage: profile.stage,
        github_url: profile.github_url,
        description: profile.description,
        project_logs: [],
    };

    await postBackend<unknown>(
        backendUrl,
        "/repo/detail",
        session.token,
        {
            name: profile.project_name,
            detail: JSON.stringify(detail),
        },
        `upsert project profile ${profile.project_name}`,
    );
}

async function createProjectVersion(
    backendUrl: string,
    contracts: {
        project: any;
    },
    session: BackendSession,
    input: {
        label: string;
        projectName: string;
        version: string;
        title: string;
        description: string;
        issueLink: string;
        budget: bigint;
    },
): Promise<SeedProject> {
    const latestBlock = await ethers.provider.getBlock("latest");
    if (!latestBlock) {
        throw new Error("latest block not found");
    }

    const startDate = BigInt(latestBlock.timestamp);
    const endDate = startDate + THIRTY_DAYS;
    const projectId = await contracts.project.projectIdCounter();
    const versionValue = convertVersion(input.version);

    const tx = await contracts.project.connect(session.signer).createProject(
        input.budget,
        ethers.encodeBytes32String(input.projectName),
        versionValue,
        startDate,
        endDate,
        [],
        [],
    );
    const receipt = await tx.wait();
    if (!receipt) {
        throw new Error(`missing receipt for ${input.label} createProject`);
    }

    await postBackend<unknown>(
        backendUrl,
        "/project/extra",
        session.token,
        {
            title: input.title,
            extra: input.description,
            pname: input.projectName,
            version: input.version,
            issueLink: input.issueLink,
            txHash: receipt.hash,
        },
        `project metadata ${input.label}`,
    );

    const brief = await contracts.project.projectOf(projectId);
    return {
        label: input.label,
        projectName: input.projectName,
        version: input.version,
        versionValue,
        manager: session,
        projectId,
        createProposalId: brief.proposalId,
        startDate,
        endDate,
        createTxHash: receipt.hash,
        issueLink: input.issueLink,
    };
}

async function supportProjectProposal(
    contracts: {
        committee: any;
        project: any;
    },
    seedProject: SeedProject,
    supporters: any[],
    action: "createProject" | "acceptProject",
) {
    const proposalId =
        action === "createProject"
            ? seedProject.createProposalId
            : seedProject.acceptProposalId;
    if (!proposalId) {
        throw new Error(`${seedProject.label} has no ${action} proposal id`);
    }

    const params = buildProjectParams(
        seedProject.projectId,
        seedProject.projectName,
        seedProject.versionValue,
        seedProject.startDate,
        seedProject.endDate,
        action,
    );

    for (const signer of supporters) {
        await (
            await contracts.committee.connect(signer).support(proposalId, params)
        ).wait();
    }
}

async function rejectProjectProposal(
    contracts: {
        committee: any;
    },
    seedProject: SeedProject,
    rejectors: any[],
    action: "createProject" | "acceptProject",
) {
    const proposalId =
        action === "createProject"
            ? seedProject.createProposalId
            : seedProject.acceptProposalId;
    if (!proposalId) {
        throw new Error(`${seedProject.label} has no ${action} proposal id`);
    }

    const params = buildProjectParams(
        seedProject.projectId,
        seedProject.projectName,
        seedProject.versionValue,
        seedProject.startDate,
        seedProject.endDate,
        action,
    );

    for (const signer of rejectors) {
        await (
            await contracts.committee.connect(signer).reject(proposalId, params)
        ).wait();
    }
}

async function promoteProject(
    contracts: {
        project: any;
    },
    seedProject: SeedProject,
) {
    await (
        await contracts.project
            .connect(seedProject.manager.signer)
            .promoteProject(seedProject.projectId)
    ).wait();
}

async function cancelProject(
    contracts: {
        project: any;
    },
    seedProject: SeedProject,
) {
    await (
        await contracts.project
            .connect(seedProject.manager.signer)
            .cancelProject(seedProject.projectId)
    ).wait();
}

async function openSettlementProposal(
    backendUrl: string,
    contracts: {
        project: any;
    },
    seedProject: SeedProject,
    result: number,
    contributions: Array<{ contributor: string; value: number }>,
    extra: string,
) {
    const tx = await contracts.project
        .connect(seedProject.manager.signer)
        .acceptProject(seedProject.projectId, result, contributions);
    const receipt = await tx.wait();
    if (!receipt) {
        throw new Error(`missing receipt for ${seedProject.label} acceptProject`);
    }

    const brief = await contracts.project.projectOf(seedProject.projectId);
    const acceptProposalId = brief.proposalId as bigint;

    await postBackend<unknown>(
        backendUrl,
        "/proposal/extra",
        seedProject.manager.token,
        {
            title: `Accept ${seedProject.projectName} ${seedProject.version}`,
            extra,
            params: buildProjectParams(
                seedProject.projectId,
                seedProject.projectName,
                seedProject.versionValue,
                seedProject.startDate,
                seedProject.endDate,
                "acceptProject",
            ),
            txHash: receipt.hash,
        },
        `settlement metadata ${seedProject.label}`,
    );

    seedProject.acceptProposalId = acceptProposalId;
    seedProject.acceptTxHash = receipt.hash;
}

async function startInvestmentRound(
    backendUrl: string,
    contracts: {
        acquired: any;
    },
    session: BackendSession,
    input: {
        label: string;
        title: string;
        extra: string;
        whitelist: string[];
        firstPercent: number[];
        tokenAddress: string;
        tokenAmount: bigint;
        tokenRatio: { tokenAmount: bigint; daoTokenAmount: bigint };
        step1Duration: bigint;
        step2Duration: bigint;
        canEndEarly: boolean;
    },
): Promise<SeedInvestment> {
    const tx = await contracts.acquired.connect(session.signer).startInvestment(
        {
            whitelist: input.whitelist,
            firstPercent: input.firstPercent,
            tokenAddress: input.tokenAddress,
            tokenAmount: input.tokenAmount,
            tokenRatio: input.tokenRatio,
            step1Duration: Number(input.step1Duration),
            step2Duration: Number(input.step2Duration),
            canEndEarly: input.canEndEarly,
        },
        {
            // Hardhat localhost occasionally returns a generic provider error during
            // estimateGas for this struct-heavy call even though the transaction
            // itself is valid. Use a fixed limit to keep local seeding deterministic.
            gasLimit: 3_000_000n,
        },
    );
    const receipt = await tx.wait();
    if (!receipt) {
        throw new Error(`missing receipt for investment ${input.label}`);
    }

    let investmentId: bigint | null = null;
    for (const log of receipt.logs) {
        try {
            const parsed = contracts.acquired.interface.parseLog(log);
            if (parsed && parsed.name === "InvestmentStart") {
                investmentId = parsed.args.investmentId as bigint;
                break;
            }
        } catch {
            // Ignore non-Acquired logs.
        }
    }

    if (investmentId === null) {
        throw new Error(`failed to parse investment id for ${input.label}`);
    }

    await postBackend<unknown>(
        backendUrl,
        "/twostep/extra",
        session.token,
        {
            title: input.title,
            extra: input.extra,
            txHash: receipt.hash,
        },
        `investment metadata ${input.label}`,
    );

    return {
        label: input.label,
        id: investmentId,
        txHash: receipt.hash,
    };
}

async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    if (options.preset !== "full-ui") {
        throw new Error(`unsupported preset ${options.preset}`);
    }

    const signers = await ethers.getSigners();
    const [
        deployer,
        committeeTwo,
        committeeThree,
        viewer,
        managerA,
        managerB,
        contributorA,
        contributorB,
        investorA,
        investorB,
    ] = signers;

    printHeader("Checking backend and contract addresses");
    const contractInfo = await fetchContractInfo(options.backendUrl);
    const chainId = BigInt(await ethers.provider.send("eth_chainId", []));
    if (chainId !== BigInt(contractInfo.chainId)) {
        throw new Error(
            `chain id mismatch: provider ${chainId.toString()} vs backend ${contractInfo.chainId}`,
        );
    }

    const dao = await ethers.getContractAt("SourceDao", contractInfo.main);
    const committee = await ethers.getContractAt(
        "SourceDaoCommittee",
        contractInfo.committee,
    );
    const project = await ethers.getContractAt(
        "ProjectManagement",
        contractInfo.project,
    );
    const devToken = await ethers.getContractAt("DevToken", contractInfo.dev_token);
    const normalToken = await ethers.getContractAt(
        "NormalToken",
        contractInfo.normal_token,
    );
    const lockup = await ethers.getContractAt(
        "SourceTokenLockup",
        contractInfo.lockup,
    );
    const dividend = await ethers.getContractAt(
        "DividendContract",
        contractInfo.dividend,
    );
    const acquired = await ethers.getContractAt("Acquired", contractInfo.acquired);

    const seedTag = (await project.projectIdCounter()).toString();
    const names = {
        empty: `UiEmpty${seedTag}`,
        vote: `UiVote${seedTag}`,
        developing: `UiDev${seedTag}`,
        settlement: `UiSettle${seedTag}`,
        done: `UiDone${seedTag}`,
        rejected: `UiReject${seedTag}`,
    };

    printHeader("Creating backend sessions");
    const deployerSession = await createBackendSession(
        options.backendUrl,
        "deployer",
        deployer,
    );
    const managerASession = await createBackendSession(
        options.backendUrl,
        "manager-a",
        managerA,
    );
    const managerBSession = await createBackendSession(
        options.backendUrl,
        "manager-b",
        managerB,
    );
    const investorASession = await createBackendSession(
        options.backendUrl,
        "investor-a",
        investorA,
    );
    const investorBSession = await createBackendSession(
        options.backendUrl,
        "investor-b",
        investorB,
    );

    printHeader("Distributing local tokens");
    await (await devToken.dev2normal(tokenUnits(4_000))).wait();
    await (await normalToken.transfer(contributorA.address, tokenUnits(250))).wait();
    await (await normalToken.transfer(contributorB.address, tokenUnits(150))).wait();
    await (await normalToken.transfer(managerA.address, tokenUnits(200))).wait();
    await (await normalToken.transfer(managerB.address, tokenUnits(200))).wait();
    await (await normalToken.transfer(viewer.address, tokenUnits(200))).wait();

    printHeader("Deploying reward and sale tokens");
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    const rewardToken = await testTokenFactory.deploy(
        "Local Reward Token",
        "LRWD",
        18,
        tokenUnits(1_000_000),
        deployer.address,
    );
    await rewardToken.waitForDeployment();
    const saleToken = await testTokenFactory.deploy(
        "Local Sale Token",
        "LSALE",
        18,
        tokenUnits(2_000_000),
        deployer.address,
    );
    await saleToken.waitForDeployment();

    await (await saleToken.transfer(investorA.address, tokenUnits(5_000))).wait();
    await (await saleToken.transfer(investorB.address, tokenUnits(5_000))).wait();

    printHeader("Extending lockup state");
    const lockupReleaseName = ethers.decodeBytes32String(
        await lockup.unlockProjectName(),
    );
    const lockupReleaseVersionRaw = await lockup.unlockProjectVersion();
    const lockupReleaseVersion = `${lockupReleaseVersionRaw / 10000000000n}.${(lockupReleaseVersionRaw % 10000000000n) / 100000n}.${lockupReleaseVersionRaw % 100000n}`;

    if ((await project.versionReleasedTime(
        await lockup.unlockProjectName(),
        lockupReleaseVersionRaw,
    )) === 0n) {
        await (await normalToken.approve(await lockup.getAddress(), tokenUnits(200))).wait();
        await (
            await lockup.transferAndLock(
                [viewer.address, managerA.address],
                [tokenUnits(50), tokenUnits(150)],
            )
        ).wait();
    }

    printHeader("Creating project lifecycle coverage");
    const projectContracts = { project, committee };

    const voteProject = await createProjectVersion(options.backendUrl, { project }, managerASession, {
        label: "waiting-vote",
        projectName: names.vote,
        version: "1.0.0",
        title: "Waiting vote version",
        description: "Seeded local version that is still waiting for committee approval.",
        issueLink: "https://github.com/buckyos/SourceDAO/issues/2001",
        budget: tokenUnits(600),
    });

    const developingProject = await createProjectVersion(options.backendUrl, { project }, managerASession, {
        label: "developing",
        projectName: names.developing,
        version: "1.0.0",
        title: "Developing version",
        description: "Seeded local version that already passed creation vote and is now developing.",
        issueLink: "https://github.com/buckyos/SourceDAO/issues/2002",
        budget: tokenUnits(720),
    });
    await supportProjectProposal(projectContracts, developingProject, [deployer, committeeTwo], "createProject");
    await promoteProject({ project }, developingProject);

    const settlementProject = await createProjectVersion(options.backendUrl, { project }, managerASession, {
        label: "waiting-settlement-vote",
        projectName: names.settlement,
        version: "1.0.0",
        title: "Settlement review version",
        description: "Seeded local version that is waiting for committee settlement review.",
        issueLink: "https://github.com/buckyos/SourceDAO/issues/2003",
        budget: tokenUnits(680),
    });
    await supportProjectProposal(projectContracts, settlementProject, [deployer, committeeTwo], "createProject");
    await promoteProject({ project }, settlementProject);
    await openSettlementProposal(
        options.backendUrl,
        { project },
        settlementProject,
        4,
        [
            { contributor: contributorA.address, value: 60 },
            { contributor: contributorB.address, value: 40 },
        ],
        "Seeded local settlement proposal kept in voting state.",
    );

    const doneProject = await createProjectVersion(options.backendUrl, { project }, managerBSession, {
        label: "finished",
        projectName: names.done,
        version: "1.0.0",
        title: "Finished version",
        description: "Seeded local version that goes all the way to finished state.",
        issueLink: "https://github.com/buckyos/SourceDAO/issues/2004",
        budget: tokenUnits(900),
    });
    await supportProjectProposal(projectContracts, doneProject, [deployer, committeeTwo], "createProject");
    await promoteProject({ project }, doneProject);
    await openSettlementProposal(
        options.backendUrl,
        { project },
        doneProject,
        4,
        [
            { contributor: contributorA.address, value: 70 },
            { contributor: contributorB.address, value: 30 },
        ],
        "Seeded local settlement proposal that will be accepted and released.",
    );

    const rejectedProject = await createProjectVersion(options.backendUrl, { project }, managerBSession, {
        label: "rejected",
        projectName: names.rejected,
        version: "1.0.0",
        title: "Rejected version",
        description: "Seeded local version rejected at the creation proposal stage.",
        issueLink: "https://github.com/buckyos/SourceDAO/issues/2005",
        budget: tokenUnits(550),
    });
    await rejectProjectProposal(projectContracts, rejectedProject, [deployer, committeeTwo], "createProject");
    await cancelProject({ project }, rejectedProject);

    let buckyosReleaseProjectId: bigint | null = null;
    let buckyosReleaseProposalId: bigint | null = null;
    const buckyosVersionReleased = await project.versionReleasedTime(
        await lockup.unlockProjectName(),
        lockupReleaseVersionRaw,
    );

    if (buckyosVersionReleased === 0n) {
        const buckyosRelease = await createProjectVersion(
            options.backendUrl,
            { project },
            deployerSession,
            {
                label: "buckyos-lockup-release",
                projectName: lockupReleaseName,
                version: lockupReleaseVersion,
                title: "Tracked lockup release version",
                description: "Seeded local version that releases the tracked lockup target.",
                issueLink: "https://github.com/buckyos/SourceDAO/issues/2006",
                budget: tokenUnits(500),
            },
        );
        await supportProjectProposal(projectContracts, buckyosRelease, [deployer, committeeTwo], "createProject");
        await promoteProject({ project }, buckyosRelease);
        await openSettlementProposal(
            options.backendUrl,
            { project },
            buckyosRelease,
            4,
            [{ contributor: viewer.address, value: 100 }],
            "Seeded local settlement proposal for the tracked lockup release version.",
        );

        await networkHelpers.time.increase(SEVEN_DAYS + 1n);
        await supportProjectProposal(projectContracts, doneProject, [deployer, committeeTwo], "acceptProject");
        await promoteProject({ project }, doneProject);

        await (await project.connect(contributorB).withdrawContributions([doneProject.projectId])).wait();

        await networkHelpers.time.increase(SEVEN_DAYS + 1n);
        await supportProjectProposal(projectContracts, buckyosRelease, [deployer, committeeTwo], "acceptProject");
        await promoteProject({ project }, buckyosRelease);

        buckyosReleaseProjectId = buckyosRelease.projectId;
        buckyosReleaseProposalId = buckyosRelease.acceptProposalId || buckyosRelease.createProposalId;
    } else {
        await networkHelpers.time.increase(SEVEN_DAYS + 1n);
        await supportProjectProposal(projectContracts, doneProject, [deployer, committeeTwo], "acceptProject");
        await promoteProject({ project }, doneProject);
        await (await project.connect(contributorB).withdrawContributions([doneProject.projectId])).wait();
    }

    printHeader("Making tracked lockup claimable");
    await networkHelpers.time.increase(NINETY_DAYS);
    const viewerClaimable = await lockup.connect(viewer).getCanClaimTokens.staticCall();
    let viewerClaimed = 0n;
    if (viewerClaimable > 0n) {
        viewerClaimed = viewerClaimable / 2n;
        if (viewerClaimed > 0n) {
            await (await lockup.connect(viewer).claimTokens(viewerClaimed)).wait();
        }
    }

    printHeader("Creating funding rounds");
    await (await normalToken.connect(viewer).approve(await acquired.getAddress(), tokenUnits(400))).wait();
    await (await normalToken.connect(contributorA).approve(await acquired.getAddress(), tokenUnits(400))).wait();

    await (await saleToken.connect(investorA).approve(await acquired.getAddress(), tokenUnits(1_200))).wait();
    await (await saleToken.connect(investorB).approve(await acquired.getAddress(), tokenUnits(2_000))).wait();

    const endedFullInvestment = await startInvestmentRound(
        options.backendUrl,
        { acquired },
        investorASession,
        {
            label: "ended-full",
            title: "Ended full local round",
            extra: "Seeded local investment round that sold out completely and ended early.",
            whitelist: [viewer.address],
            firstPercent: [10_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: tokenUnits(500),
            tokenRatio: INVESTMENT_RATIO_FIVE_TO_ONE,
            step1Duration: TWO_DAYS,
            step2Duration: TWO_DAYS,
            canEndEarly: true,
        },
    );
    await (await acquired.connect(viewer).invest(endedFullInvestment.id, tokenUnits(100))).wait();
    await (await acquired.connect(investorA).endInvestment(endedFullInvestment.id)).wait();

    const endedPartialInvestment = await startInvestmentRound(
        options.backendUrl,
        { acquired },
        investorBSession,
        {
            label: "ended-partial",
            title: "Ended partial local round",
            extra: "Seeded local investment round that ended with unsold allocation.",
            whitelist: [viewer.address, contributorA.address],
            firstPercent: [6_000, 4_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: tokenUnits(800),
            tokenRatio: INVESTMENT_RATIO_FIVE_TO_ONE,
            step1Duration: TWO_DAYS,
            step2Duration: TWO_DAYS,
            canEndEarly: false,
        },
    );
    await (await acquired.connect(viewer).invest(endedPartialInvestment.id, tokenUnits(60))).wait();
    await (await acquired.connect(contributorA).invest(endedPartialInvestment.id, tokenUnits(20))).wait();
    await networkHelpers.time.increase(FOUR_DAYS + 1n);
    await (await acquired.connect(investorB).endInvestment(endedPartialInvestment.id)).wait();

    const activeStep2Investment = await startInvestmentRound(
        options.backendUrl,
        { acquired },
        investorASession,
        {
            label: "active-step2",
            title: "Active step-2 local round",
            extra: "Seeded local round currently in step 2 with partial participation.",
            whitelist: [viewer.address, contributorA.address],
            firstPercent: [5_000, 5_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: tokenUnits(700),
            tokenRatio: INVESTMENT_RATIO_FIVE_TO_ONE,
            step1Duration: TWO_DAYS,
            step2Duration: THREE_DAYS,
            canEndEarly: false,
        },
    );
    await networkHelpers.time.increase(TWO_DAYS + 1n);
    await (await acquired.connect(contributorA).invest(activeStep2Investment.id, tokenUnits(30))).wait();

    const activeStep1Investment = await startInvestmentRound(
        options.backendUrl,
        { acquired },
        investorBSession,
        {
            label: "active-step1",
            title: "Active step-1 local round",
            extra: "Seeded local round still in whitelist step 1.",
            whitelist: [viewer.address, contributorA.address],
            firstPercent: [7_000, 3_000],
            tokenAddress: await saleToken.getAddress(),
            tokenAmount: tokenUnits(900),
            tokenRatio: INVESTMENT_RATIO_FIVE_TO_ONE,
            step1Duration: TWO_DAYS,
            step2Duration: FOUR_DAYS,
            canEndEarly: false,
        },
    );
    await (await acquired.connect(viewer).invest(activeStep1Investment.id, tokenUnits(10))).wait();

    printHeader("Creating dividend cycles");
    await (await devToken.approve(await dividend.getAddress(), tokenUnits(300))).wait();
    await (await normalToken.connect(viewer).approve(await dividend.getAddress(), tokenUnits(200))).wait();
    await (await dividend.stakeDev(tokenUnits(300))).wait();
    await (await dividend.connect(viewer).stakeNormal(tokenUnits(200))).wait();

    await networkHelpers.time.increase(ONE_HOUR + 1n);
    await (await dividend.tryNewCycle()).wait();

    await (await rewardToken.approve(await dividend.getAddress(), tokenUnits(600))).wait();
    await (await dividend.deposit(tokenUnits(600), await rewardToken.getAddress())).wait();

    await networkHelpers.time.increase(ONE_HOUR + 1n);
    await (await dividend.tryNewCycle()).wait();

    const deployerDividends = await dividend
        .estimateDividends([1n], [await rewardToken.getAddress()]);
    if (deployerDividends.length > 0) {
        await (
            await dividend
                .withdrawDividends([1n], [await rewardToken.getAddress()])
        ).wait();
    }

    printHeader("Upserting project profiles");
    const projectProfiles: Array<{
        label: string;
        session: BackendSession;
        profile: ProjectProfileDraft;
    }> = [
        {
            label: "empty",
            session: managerASession,
            profile: {
                project_name: names.empty,
                github_url: "https://github.com/buckyos/SourceDAO",
                description: "Seeded empty project profile with no versions yet.",
                state: "draft",
                current_version: "-",
                stage: "-",
            },
        },
        {
            label: "vote",
            session: managerASession,
            profile: {
                project_name: names.vote,
                github_url: "https://github.com/buckyos/SourceDAO",
                description: "Seeded profile whose first version is still waiting for committee approval.",
                state: "waiting vote",
                current_version: "1.0.0",
                stage: "proposal",
            },
        },
        {
            label: "developing",
            session: managerASession,
            profile: {
                project_name: names.developing,
                github_url: "https://github.com/buckyos/SourceDAO",
                description: "Seeded profile with an active developing version.",
                state: "developing",
                current_version: "1.0.0",
                stage: "active",
            },
        },
        {
            label: "settlement",
            session: managerASession,
            profile: {
                project_name: names.settlement,
                github_url: "https://github.com/buckyos/SourceDAO",
                description: "Seeded profile waiting for settlement proposal approval.",
                state: "waiting settlement vote",
                current_version: "1.0.0",
                stage: "accepting",
            },
        },
        {
            label: "finished",
            session: managerBSession,
            profile: {
                project_name: names.done,
                github_url: "https://github.com/buckyos/SourceDAO",
                description: "Seeded finished profile with contributor payouts available.",
                state: "version settled",
                current_version: "1.0.0",
                stage: "finished",
            },
        },
        {
            label: "rejected",
            session: managerBSession,
            profile: {
                project_name: names.rejected,
                github_url: "https://github.com/buckyos/SourceDAO",
                description: "Seeded profile rejected at project creation stage.",
                state: "rejected",
                current_version: "1.0.0",
                stage: "rejected",
            },
        },
        {
            label: "buckyos",
            session: deployerSession,
            profile: {
                project_name: lockupReleaseName,
                github_url: "https://github.com/buckyos/buckyos",
                description: "Tracked local lockup release profile used by the built-in seed lockup target.",
                state: "version settled",
                current_version: lockupReleaseVersion,
                stage: "finished",
            },
        },
    ];

    for (const item of projectProfiles) {
        await upsertProjectProfile(options.backendUrl, item.session, item.profile);
    }

    const targetBlock = BigInt(await ethers.provider.getBlockNumber());
    printHeader("Waiting for backend sync");
    const backendSynced = await waitForBackendSync(options.backendUrl, targetBlock);

    const manifest: SeedManifest = {
        preset: options.preset,
        backendUrl: options.backendUrl,
        chainId: Number(chainId),
        generatedAt: new Date().toISOString(),
        seedTag,
        accounts: {
            deployer: deployer.address,
            committeeTwo: committeeTwo.address,
            committeeThree: committeeThree.address,
            viewer: viewer.address,
            managerA: managerA.address,
            managerB: managerB.address,
            contributorA: contributorA.address,
            contributorB: contributorB.address,
            investorA: investorA.address,
            investorB: investorB.address,
        },
        contracts: {
            main: contractInfo.main,
            committee: contractInfo.committee,
            project: contractInfo.project,
            lockup: contractInfo.lockup,
            dividend: contractInfo.dividend,
            acquired: contractInfo.acquired,
            normalToken: contractInfo.normal_token,
            devToken: contractInfo.dev_token,
        },
        tokens: {
            rewardToken: await rewardToken.getAddress(),
            saleToken: await saleToken.getAddress(),
        },
        projectProfiles: projectProfiles.map((item) => ({
            label: item.label,
            name: item.profile.project_name,
            owner: item.session.address,
            currentVersion: item.profile.current_version,
            state: item.profile.state,
        })),
        projects: [
            {
                label: voteProject.label,
                projectId: voteProject.projectId.toString(),
                name: voteProject.projectName,
                version: voteProject.version,
                createProposalId: voteProject.createProposalId.toString(),
                note: "Waiting committee vote",
            },
            {
                label: developingProject.label,
                projectId: developingProject.projectId.toString(),
                name: developingProject.projectName,
                version: developingProject.version,
                createProposalId: developingProject.createProposalId.toString(),
                note: "Developing after creation vote",
            },
            {
                label: settlementProject.label,
                projectId: settlementProject.projectId.toString(),
                name: settlementProject.projectName,
                version: settlementProject.version,
                createProposalId: settlementProject.createProposalId.toString(),
                acceptProposalId: settlementProject.acceptProposalId?.toString(),
                note: "Waiting settlement vote",
            },
            {
                label: doneProject.label,
                projectId: doneProject.projectId.toString(),
                name: doneProject.projectName,
                version: doneProject.version,
                createProposalId: doneProject.createProposalId.toString(),
                acceptProposalId: doneProject.acceptProposalId?.toString(),
                note: "Finished with one contributor already withdrawn",
            },
            {
                label: rejectedProject.label,
                projectId: rejectedProject.projectId.toString(),
                name: rejectedProject.projectName,
                version: rejectedProject.version,
                createProposalId: rejectedProject.createProposalId.toString(),
                note: "Rejected during creation proposal",
            },
            ...(buckyosReleaseProjectId
                ? [
                    {
                        label: "buckyos-lockup-release",
                        projectId: buckyosReleaseProjectId.toString(),
                        name: lockupReleaseName,
                        version: lockupReleaseVersion,
                        createProposalId: buckyosReleaseProposalId?.toString() || "",
                        note: "Tracked release for local lockup unlock target",
                    },
                ]
                : []),
        ],
        investments: [
            {
                label: endedFullInvestment.label,
                id: endedFullInvestment.id.toString(),
                note: "Ended early after full sell-out",
            },
            {
                label: endedPartialInvestment.label,
                id: endedPartialInvestment.id.toString(),
                note: "Ended after step 2 with unsold allocation",
            },
            {
                label: activeStep2Investment.label,
                id: activeStep2Investment.id.toString(),
                note: "Currently in step 2",
            },
            {
                label: activeStep1Investment.label,
                id: activeStep1Investment.id.toString(),
                note: "Currently in step 1",
            },
        ],
        notes: [
            `Lockup unlock target: ${lockupReleaseName} ${lockupReleaseVersion}`,
            `Viewer partially claimed lockup amount: ${ethers.formatUnits(viewerClaimed, TOKEN_DECIMALS)}`,
            "Deployer already withdrew one dividend cycle reward token payout",
            "Contributor B already withdrew finished project contributions",
            "Contributor A still has withdrawable contribution on the finished project",
            backendSynced
                ? `Backend sync reached block ${targetBlock.toString()} before script exit`
                : `Backend sync did not reach block ${targetBlock.toString()} before script exit; refresh after the scanner catches up`,
        ],
    };

    await mkdir(path.dirname(options.manifestPath), { recursive: true });
    await writeFile(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    printHeader("Local scenario seed complete");
    console.log(`Preset          : ${options.preset}`);
    console.log(`Seed tag        : ${seedTag}`);
    console.log(`Manifest        : ${options.manifestPath}`);
    console.log(`Reward token    : ${await rewardToken.getAddress()}`);
    console.log(`Sale token      : ${await saleToken.getAddress()}`);
    console.log(`Waiting vote    : ${names.vote}`);
    console.log(`Developing      : ${names.developing}`);
    console.log(`Settlement vote : ${names.settlement}`);
    console.log(`Finished        : ${names.done}`);
    console.log(`Rejected        : ${names.rejected}`);
    console.log(`Lockup target   : ${lockupReleaseName} ${lockupReleaseVersion}`);
    console.log(`Backend synced  : ${backendSynced ? "yes" : "not yet (best-effort)"}`);
}

await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
