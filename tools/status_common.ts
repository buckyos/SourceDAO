import { Contract, ZeroAddress } from "ethers";

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
    bootstrapFinalized: boolean;
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
        bootstrapFinalized: await dao.bootstrapFinalized(),
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

export function formatDaoStatus(status: DaoStatus): string {
    const moduleLines = status.modules.map((module) => {
        const versionText = module.version === null ? "n/a" : module.version;
        return `- ${module.key}: ${module.address} | configured=${module.configured} | code=${module.hasCode} | dao=${module.isDaoContract} | version=${versionText}`;
    });

    return [
        `DAO: ${status.daoAddress}`,
        `Version: ${status.version}`,
        `Bootstrap admin: ${status.bootstrapAdmin}`,
        `Bootstrap finalized: ${status.bootstrapFinalized}`,
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

async function readContractVersion(provider: any, address: string): Promise<string | null> {
    try {
        const contract = new Contract(address, ["function version() view returns (string)"], provider);
        return await contract.version();
    } catch {
        return null;
    }
}
