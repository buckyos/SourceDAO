import { Contract, ZeroAddress, decodeBytes32String, getAddress } from "ethers";

const PROPOSAL_STATE_NAMES = [
    "NotFound",
    "InProgress",
    "Accepted",
    "Rejected",
    "Executed",
    "Expired"
] as const;

type ModuleKey =
    | "devToken"
    | "normalToken"
    | "committee"
    | "project"
    | "lockup"
    | "dividend"
    | "acquired";

export interface ModuleStatus {
    key: ModuleKey;
    address: string;
    configured: boolean;
    hasCode: boolean;
    isDaoContract: boolean;
    version: string | null;
}

export interface DaoStatus {
    daoAddress: string;
    version: string;
    bootstrapAdmin: string;
    selfRecognizedAsDaoContract: boolean;
    modules: ModuleStatus[];
}

export interface ProposalStatus {
    daoAddress: string;
    committeeAddress: string;
    proposalId: number;
    exists: boolean;
    kind: "ordinary" | "full";
    stateId: number;
    stateName: string;
    fromGroup: string;
    origin: string;
    expiredAt: string;
    expiredAtIso: string;
    isExpiredByTime: boolean;
    supportCount: number;
    rejectCount: number;
    supportAddresses: string[];
    rejectAddresses: string[];
    ordinary: {
        snapshotVersionExposed: false;
    };
    full: null | {
        proposer: string;
        threshold: string;
        agree: string;
        reject: string;
        settled: string;
        totalReleasedToken: string;
        pendingSettleCount: number;
    };
}

export interface CommitteeObservedAddressStatus {
    address: string;
    isCurrentMember: boolean;
    currentOrdinaryProposalEligible: boolean;
    currentFullProposalEligible: boolean;
    normalTokenBalance: string;
    devTokenBalance: string;
    currentFullProposalVotingPower: string;
}

export interface CommitteeStatus {
    daoAddress: string;
    committeeAddress: string;
    version: string;
    committeeVersion: string;
    memberCount: number;
    members: string[];
    devRatio: string;
    finalRatio: string;
    finalRatioCurrentlyApplied: boolean;
    mainProjectNameRaw: string;
    mainProjectName: string;
    finalVersion: string;
    finalVersionText: string;
    finalVersionReleased: boolean;
    finalVersionReleasedAt: string;
    finalVersionReleasedAtIso: string | null;
    observed: CommitteeObservedAddressStatus | null;
    latestProposalIdExposed: false;
}

export interface ProjectExtraTokenStatus {
    token: string;
    amount: string;
}

export interface ProjectContributionStatus {
    contributor: string;
    value: string;
    hasClaim: boolean;
}

export interface ProjectObservedAddressStatus {
    address: string;
    contributionValue: string;
    hasClaim: boolean;
}

export interface ProjectStatus {
    daoAddress: string;
    projectAddress: string;
    committeeAddress: string;
    projectId: number;
    exists: boolean;
    manager: string;
    proposalId: string;
    proposalStateId: number | null;
    proposalStateName: string | null;
    budget: string;
    projectNameRaw: string;
    projectName: string;
    version: string;
    versionText: string;
    startDate: string;
    startDateIso: string;
    endDate: string;
    endDateIso: string;
    stateId: number;
    stateName: string;
    resultId: number;
    resultName: string;
    extraTokens: ProjectExtraTokenStatus[];
    contributions: ProjectContributionStatus[];
    contributionCount: number;
    totalContribution: string;
    latestKnownVersion: string;
    latestKnownVersionText: string;
    latestKnownVersionReleasedAt: string;
    latestKnownVersionReleasedAtIso: string | null;
    requestedVersionReleased: boolean;
    requestedVersionReleasedAt: string;
    requestedVersionReleasedAtIso: string | null;
    observed: ProjectObservedAddressStatus | null;
}

const PROJECT_STATE_NAMES = ["Preparing", "Developing", "Accepting", "Finished", "Rejected"] as const;
const PROJECT_RESULT_NAMES = ["InProgress", "Expired", "Failed", "Normal", "Good", "Excellent"] as const;

export async function readDaoStatus(hardhatEthers: any, daoAddress: string): Promise<DaoStatus> {
    const provider = hardhatEthers.provider;
    const dao = await hardhatEthers.getContractAt("SourceDao", daoAddress);

    const moduleEntries: Array<[ModuleKey, string]> = [
        ["devToken", await dao.devToken()],
        ["normalToken", await dao.normalToken()],
        ["committee", await dao.committee()],
        ["project", await dao.project()],
        ["lockup", await dao.lockup()],
        ["dividend", await dao.dividend()],
        ["acquired", await dao.acquired()]
    ];

    const modules = await Promise.all(
        moduleEntries.map(async ([key, address]) => {
            const configured = address !== ZeroAddress;
            const code = configured ? await provider.getCode(address) : "0x";
            const hasCode = code !== "0x";

            return {
                key,
                address,
                configured,
                hasCode,
                isDaoContract: configured ? await dao.isDAOContract(address) : false,
                version: configured && hasCode ? await readContractVersion(provider, address) : null
            } satisfies ModuleStatus;
        })
    );

    return {
        daoAddress: await dao.getAddress(),
        version: await dao.version(),
        bootstrapAdmin: await dao.bootstrapAdmin(),
        selfRecognizedAsDaoContract: await dao.isDAOContract(await dao.getAddress()),
        modules
    };
}

export async function readProposalStatus(
    hardhatEthers: any,
    daoAddress: string,
    proposalId: number
): Promise<ProposalStatus> {
    const dao = await hardhatEthers.getContractAt("SourceDao", daoAddress);
    const committeeAddress = await dao.committee();
    const committee = await hardhatEthers.getContractAt("SourceDaoCommittee", committeeAddress);
    const proposal = await committee.proposalOf(proposalId);
    const extra = await committee.proposalExtraOf(proposalId);

    const exists = proposal.origin !== ZeroAddress;
    const stateId = Number(proposal.state);
    const expiredAt = Number(proposal.expired);
    const kind = extra.from === ZeroAddress ? "ordinary" : "full";
    const supportCount = proposal.support.length;
    const rejectCount = proposal.reject.length;

    return {
        daoAddress: await dao.getAddress(),
        committeeAddress: await committee.getAddress(),
        proposalId,
        exists,
        kind,
        stateId,
        stateName: PROPOSAL_STATE_NAMES[stateId] ?? `Unknown(${stateId})`,
        fromGroup: proposal.fromGroup,
        origin: proposal.origin,
        expiredAt: proposal.expired.toString(),
        expiredAtIso: new Date(expiredAt * 1000).toISOString(),
        isExpiredByTime: expiredAt < Math.floor(Date.now() / 1000),
        supportCount,
        rejectCount,
        supportAddresses: [...proposal.support],
        rejectAddresses: [...proposal.reject],
        ordinary: {
            snapshotVersionExposed: false
        },
        full:
            kind === "full"
                ? {
                      proposer: extra.from,
                      threshold: extra.threshold.toString(),
                      agree: extra.agree.toString(),
                      reject: extra.reject.toString(),
                      settled: extra.settled.toString(),
                      totalReleasedToken: extra.totalReleasedToken.toString(),
                      pendingSettleCount: supportCount + rejectCount - Number(extra.settled)
                  }
                : null
    };
}

export async function readCommitteeStatus(
    hardhatEthers: any,
    daoAddress: string,
    observedAddress?: string
): Promise<CommitteeStatus> {
    const provider = hardhatEthers.provider;
    const dao = await hardhatEthers.getContractAt("SourceDao", daoAddress);
    const committeeAddress = await dao.committee();
    const committee = await hardhatEthers.getContractAt("SourceDaoCommittee", committeeAddress);

    const members = [...(await committee.members())];
    const devRatio = await committee.devRatio();
    const finalRatio = await committee.finalRatio();
    const mainProjectNameRaw = await committee.mainProjectName();
    const finalVersion = await committee.finalVersion();
    const releasedAt = await readProjectReleaseTime(provider, await dao.project(), mainProjectNameRaw, finalVersion);

    let observed: CommitteeObservedAddressStatus | null = null;
    if (observedAddress !== undefined) {
        const normalizedAddress = getAddress(observedAddress);
        const devToken = await hardhatEthers.getContractAt("DevToken", await dao.devToken());
        const normalToken = await hardhatEthers.getContractAt("NormalToken", await dao.normalToken());
        const devTokenBalance = await devToken.balanceOf(normalizedAddress);
        const normalTokenBalance = await normalToken.balanceOf(normalizedAddress);
        const currentFullProposalVotingPower = normalTokenBalance + (devTokenBalance * devRatio) / 100n;
        const isCurrentMember = await committee.isMember(normalizedAddress);

        observed = {
            address: normalizedAddress,
            isCurrentMember,
            currentOrdinaryProposalEligible: isCurrentMember,
            currentFullProposalEligible: currentFullProposalVotingPower > 0n,
            normalTokenBalance: normalTokenBalance.toString(),
            devTokenBalance: devTokenBalance.toString(),
            currentFullProposalVotingPower: currentFullProposalVotingPower.toString()
        };
    }

    return {
        daoAddress: await dao.getAddress(),
        committeeAddress: await committee.getAddress(),
        version: await committee.version(),
        committeeVersion: (await committee.committeeVersion()).toString(),
        memberCount: members.length,
        members,
        devRatio: devRatio.toString(),
        finalRatio: finalRatio.toString(),
        finalRatioCurrentlyApplied: devRatio === finalRatio,
        mainProjectNameRaw,
        mainProjectName: decodeBytes32Value(mainProjectNameRaw),
        finalVersion: finalVersion.toString(),
        finalVersionText: formatVersionNumber(finalVersion),
        finalVersionReleased: releasedAt > 0n,
        finalVersionReleasedAt: releasedAt.toString(),
        finalVersionReleasedAtIso: releasedAt > 0n ? new Date(Number(releasedAt) * 1000).toISOString() : null,
        observed,
        latestProposalIdExposed: false
    };
}

export async function readProjectStatus(
    hardhatEthers: any,
    daoAddress: string,
    projectId: number,
    observedAddress?: string
): Promise<ProjectStatus> {
    const dao = await hardhatEthers.getContractAt("SourceDao", daoAddress);
    const projectAddress = await dao.project();
    const committeeAddress = await dao.committee();
    const project = await hardhatEthers.getContractAt("ProjectManagement", projectAddress);
    const committee = await hardhatEthers.getContractAt("SourceDaoCommittee", committeeAddress);

    const projectInfo = await project.projectOf(projectId);
    const exists = projectInfo.manager !== ZeroAddress;
    const detail = exists ? await project.projectDetailOf(projectId) : { contributions: [] };
    const contributions = detail.contributions.map((contribution: any) => ({
        contributor: contribution.contributor,
        value: contribution.value.toString(),
        hasClaim: contribution.hasClaim
    })) satisfies ProjectContributionStatus[];
    const totalContribution = contributions.reduce((sum, contribution) => sum + BigInt(contribution.value), 0n);
    const projectNameRaw = projectInfo.projectName;
    const latestVersion = exists ? await project.latestProjectVersion(projectNameRaw) : { version: 0n, versionTime: 0n };
    const requestedVersionReleasedAt = exists
        ? BigInt(await project.versionReleasedTime(projectNameRaw, projectInfo.version))
        : 0n;

    let proposalStateId: number | null = null;
    let proposalStateName: string | null = null;
    if (exists && projectInfo.proposalId > 0n && committeeAddress !== ZeroAddress) {
        const proposal = await committee.proposalOf(projectInfo.proposalId);
        proposalStateId = Number(proposal.state);
        proposalStateName = PROPOSAL_STATE_NAMES[proposalStateId] ?? `Unknown(${proposalStateId})`;
    }

    let observed: ProjectObservedAddressStatus | null = null;
    if (observedAddress !== undefined) {
        const normalizedAddress = getAddress(observedAddress);
        const contributionValue = exists ? BigInt(await project.contributionOf(projectId, normalizedAddress)).toString() : "0";
        const contributionEntry = contributions.find((entry) => entry.contributor === normalizedAddress);
        observed = {
            address: normalizedAddress,
            contributionValue,
            hasClaim: contributionEntry?.hasClaim ?? false
        };
    }

    return {
        daoAddress: await dao.getAddress(),
        projectAddress: await project.getAddress(),
        committeeAddress: await committee.getAddress(),
        projectId,
        exists,
        manager: projectInfo.manager,
        proposalId: projectInfo.proposalId.toString(),
        proposalStateId,
        proposalStateName,
        budget: projectInfo.budget.toString(),
        projectNameRaw,
        projectName: decodeBytes32Value(projectNameRaw),
        version: projectInfo.version.toString(),
        versionText: formatVersionNumber(projectInfo.version),
        startDate: projectInfo.startDate.toString(),
        startDateIso: new Date(Number(projectInfo.startDate) * 1000).toISOString(),
        endDate: projectInfo.endDate.toString(),
        endDateIso: new Date(Number(projectInfo.endDate) * 1000).toISOString(),
        stateId: Number(projectInfo.state),
        stateName: PROJECT_STATE_NAMES[Number(projectInfo.state)] ?? `Unknown(${Number(projectInfo.state)})`,
        resultId: Number(projectInfo.result),
        resultName: PROJECT_RESULT_NAMES[Number(projectInfo.result)] ?? `Unknown(${Number(projectInfo.result)})`,
        extraTokens: projectInfo.extraTokens.map((token: string, index: number) => ({
            token,
            amount: projectInfo.extraTokenAmounts[index].toString()
        })),
        contributions,
        contributionCount: contributions.length,
        totalContribution: totalContribution.toString(),
        latestKnownVersion: latestVersion.version.toString(),
        latestKnownVersionText: formatVersionNumber(latestVersion.version),
        latestKnownVersionReleasedAt: latestVersion.versionTime.toString(),
        latestKnownVersionReleasedAtIso:
            BigInt(latestVersion.versionTime) > 0n
                ? new Date(Number(latestVersion.versionTime) * 1000).toISOString()
                : null,
        requestedVersionReleased: requestedVersionReleasedAt > 0n,
        requestedVersionReleasedAt: requestedVersionReleasedAt.toString(),
        requestedVersionReleasedAtIso:
            requestedVersionReleasedAt > 0n ? new Date(Number(requestedVersionReleasedAt) * 1000).toISOString() : null,
        observed
    };
}

export function formatDaoStatus(status: DaoStatus): string {
    const moduleLines = status.modules.map((module) => {
        const versionText = module.version === null ? "n/a" : module.version;
        return `- ${module.key}: ${module.address} | configured=${module.configured} | code=${module.hasCode} | dao=${module.isDaoContract} | version=${versionText}`;
    });

    return [
        `DAO: ${status.daoAddress}`,
        `Version: ${status.version}`,
        `Bootstrap admin: ${status.bootstrapAdmin}`,
        `DAO recognizes itself: ${status.selfRecognizedAsDaoContract}`,
        "Modules:",
        ...moduleLines
    ].join("\n");
}

export function formatProposalStatus(status: ProposalStatus): string {
    const lines = [
        `DAO: ${status.daoAddress}`,
        `Committee: ${status.committeeAddress}`,
        `Proposal: ${status.proposalId}`,
        `Exists: ${status.exists}`,
        `Kind: ${status.kind}`,
        `State: ${status.stateName} (${status.stateId})`,
        `From group: ${status.fromGroup}`,
        `Origin: ${status.origin}`,
        `Expired at: ${status.expiredAt} (${status.expiredAtIso})`,
        `Expired by time: ${status.isExpiredByTime}`,
        `Support count: ${status.supportCount}`,
        `Reject count: ${status.rejectCount}`,
        `Support addresses: ${status.supportAddresses.join(", ") || "none"}`,
        `Reject addresses: ${status.rejectAddresses.join(", ") || "none"}`
    ];

    if (status.full !== null) {
        lines.push(`Full proposer: ${status.full.proposer}`);
        lines.push(`Threshold: ${status.full.threshold}`);
        lines.push(`Agree weight: ${status.full.agree}`);
        lines.push(`Reject weight: ${status.full.reject}`);
        lines.push(`Settled voters: ${status.full.settled}`);
        lines.push(`Pending settle count: ${status.full.pendingSettleCount}`);
        lines.push(`Total released token baseline: ${status.full.totalReleasedToken}`);
    } else {
        lines.push("Snapshot version: not exposed by the current on-chain interface");
    }

    return lines.join("\n");
}

export function formatCommitteeStatus(status: CommitteeStatus): string {
    const lines = [
        `DAO: ${status.daoAddress}`,
        `Committee: ${status.committeeAddress}`,
        `Version: ${status.version}`,
        `Committee version: ${status.committeeVersion}`,
        `Member count: ${status.memberCount}`,
        `Members: ${status.members.join(", ") || "none"}`,
        `Dev ratio: ${status.devRatio}`,
        `Final ratio: ${status.finalRatio}`,
        `Final ratio currently applied: ${status.finalRatioCurrentlyApplied}`,
        `Main project name: ${status.mainProjectName} (${status.mainProjectNameRaw})`,
        `Final version: ${status.finalVersionText} (${status.finalVersion})`,
        `Final version released: ${status.finalVersionReleased}`,
        `Final version released at: ${
            status.finalVersionReleasedAtIso === null
                ? `${status.finalVersionReleasedAt} (not released)`
                : `${status.finalVersionReleasedAt} (${status.finalVersionReleasedAtIso})`
        }`,
        "Latest proposal id: not exposed by the current on-chain interface"
    ];

    if (status.observed !== null) {
        lines.push(`Observed address: ${status.observed.address}`);
        lines.push(`Observed is current member: ${status.observed.isCurrentMember}`);
        lines.push(`Observed ordinary proposal eligible: ${status.observed.currentOrdinaryProposalEligible}`);
        lines.push(`Observed full proposal eligible: ${status.observed.currentFullProposalEligible}`);
        lines.push(`Observed normal token balance: ${status.observed.normalTokenBalance}`);
        lines.push(`Observed dev token balance: ${status.observed.devTokenBalance}`);
        lines.push(`Observed full proposal voting power: ${status.observed.currentFullProposalVotingPower}`);
    }

    return lines.join("\n");
}

export function formatProjectStatus(status: ProjectStatus): string {
    const lines = [
        `DAO: ${status.daoAddress}`,
        `Project contract: ${status.projectAddress}`,
        `Committee: ${status.committeeAddress}`,
        `Project id: ${status.projectId}`,
        `Exists: ${status.exists}`,
        `Manager: ${status.manager}`,
        `Proposal id: ${status.proposalId}`,
        `Proposal state: ${
            status.proposalStateName === null ? "n/a" : `${status.proposalStateName} (${status.proposalStateId})`
        }`,
        `Budget: ${status.budget}`,
        `Project name: ${status.projectName} (${status.projectNameRaw})`,
        `Version: ${status.versionText} (${status.version})`,
        `Start date: ${status.startDate} (${status.startDateIso})`,
        `End date: ${status.endDate} (${status.endDateIso})`,
        `State: ${status.stateName} (${status.stateId})`,
        `Result: ${status.resultName} (${status.resultId})`,
        `Extra tokens: ${
            status.extraTokens.length === 0
                ? "none"
                : status.extraTokens.map((entry) => `${entry.token}:${entry.amount}`).join(", ")
        }`,
        `Contribution count: ${status.contributionCount}`,
        `Total contribution: ${status.totalContribution}`,
        `Contributions: ${
            status.contributions.length === 0
                ? "none"
                : status.contributions
                      .map((entry) => `${entry.contributor}:${entry.value}:claimed=${entry.hasClaim}`)
                      .join(", ")
        }`,
        `Latest known version: ${status.latestKnownVersionText} (${status.latestKnownVersion})`,
        `Latest known version released at: ${
            status.latestKnownVersionReleasedAtIso === null
                ? `${status.latestKnownVersionReleasedAt} (not released)`
                : `${status.latestKnownVersionReleasedAt} (${status.latestKnownVersionReleasedAtIso})`
        }`,
        `Requested version released: ${status.requestedVersionReleased}`,
        `Requested version released at: ${
            status.requestedVersionReleasedAtIso === null
                ? `${status.requestedVersionReleasedAt} (not released)`
                : `${status.requestedVersionReleasedAt} (${status.requestedVersionReleasedAtIso})`
        }`
    ];

    if (status.observed !== null) {
        lines.push(`Observed address: ${status.observed.address}`);
        lines.push(`Observed contribution value: ${status.observed.contributionValue}`);
        lines.push(`Observed has claimed: ${status.observed.hasClaim}`);
    }

    return lines.join("\n");
}

async function readContractVersion(provider: any, address: string): Promise<string | null> {
    try {
        const contract = new Contract(address, ["function version() view returns (string)"], provider);
        return await contract.version();
    } catch {
        return null;
    }
}

async function readProjectReleaseTime(
    provider: any,
    projectAddress: string,
    projectName: string,
    version: bigint
): Promise<bigint> {
    if (projectAddress === ZeroAddress) {
        return 0n;
    }

    try {
        const contract = new Contract(
            projectAddress,
            ["function versionReleasedTime(bytes32 projectName, uint64 version) view returns (uint256)"],
            provider
        );
        return BigInt(await contract.versionReleasedTime(projectName, version));
    } catch {
        return 0n;
    }
}

function decodeBytes32Value(value: string): string {
    try {
        return decodeBytes32String(value);
    } catch {
        return value;
    }
}

function formatVersionNumber(version: bigint): string {
    const major = version / 10000000000n;
    const minor = (version % 10000000000n) / 100000n;
    const patch = version % 100000n;
    return `${major}.${minor}.${patch}`;
}
