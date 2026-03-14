import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { ethers } from "ethers";

export const DEFAULT_DAO_ADDRESS = "0x2fc3186176B80EA829A7952b874F36f7cb8bd184";
export const DEFAULT_PROPOSAL_API_BASE = "https://dao.buckyos.org/api";
const CONFIG_PATH_ENV = "SOURCE_DAO_CONFIG";

export type OfflineMode = "prepare" | "sign" | "broadcast";

export type SupportedProposalType =
    | "createProject"
    | "acceptProject"
    | "upgradeContract"
    | "setCommittees";

interface VoteToolConfig {
    daoAddress?: string;
    proposalApiBase?: string;
    voterAddress?: string;
    offline?: {
        mode?: OfflineMode;
        input?: string;
        output?: string;
        signedOutput?: string;
        broadcastOutput?: string;
    };
}

interface ProposalApiSuccess {
    code: 0;
    data: {
        params: unknown[];
    };
    message?: string;
}

interface ProposalApiFailure {
    code: number;
    message?: string;
    data?: {
        params?: unknown[];
    };
}

type ProposalApiResponse = ProposalApiSuccess | ProposalApiFailure;
const { config: loadedConfig, path: loadedConfigPath } = await loadVoteToolConfig();

async function loadVoteToolConfig(): Promise<{ config: VoteToolConfig; path?: string }> {
    const configuredPath = process.env[CONFIG_PATH_ENV]?.trim();
    const candidatePaths =
        configuredPath !== undefined && configuredPath !== ""
            ? [resolve(configuredPath)]
            : [resolve("vote.config.json"), resolve("tools/vote.config.json")];

    for (const candidatePath of candidatePaths) {
        try {
            await access(candidatePath);
        } catch {
            continue;
        }

        const raw = await readFile(candidatePath, "utf8");
        return {
            config: JSON.parse(raw) as VoteToolConfig,
            path: candidatePath
        };
    }

    return { config: {} };
}

function getOptionalString(value: unknown, label: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== "string") {
        throw new Error(`Invalid ${label}: expected string, got ${typeof value}.`);
    }

    return value;
}

function resolveRelativeToConfig(path: string): string {
    if (loadedConfigPath === undefined) {
        return path;
    }

    return resolve(dirname(loadedConfigPath), path);
}

export function convertVersion(version: string): number {
    const segments = version.split(".");
    if (segments.length < 3) {
        throw new Error(`Invalid version format: ${version}. Expected format is 'major.minor.patch'.`);
    }

    const major = parseInt(segments[0], 10);
    const minor = parseInt(segments[1], 10);
    const patch = parseInt(segments[2], 10);

    return major * 10000000000 + minor * 100000 + patch;
}

export function zeroPadUint256(value: number | string | bigint): string {
    const hex = ethers.toBeHex(ethers.toBigInt(value));
    return ethers.zeroPadValue(hex, 32);
}

export function requireString(value: unknown, label: string): string {
    if (typeof value !== "string") {
        throw new Error(`Invalid ${label}: expected string, got ${typeof value}.`);
    }

    return value;
}

export function requireAddress(value: unknown, label: string): string {
    return ethers.getAddress(requireString(value, label));
}

export function getDaoAddress(): string {
    return ethers.getAddress(process.env.SOURCE_DAO_ADDRESS ?? loadedConfig.daoAddress ?? DEFAULT_DAO_ADDRESS);
}

export function getProposalApiBase(): string {
    return process.env.SOURCE_DAO_API_BASE ?? loadedConfig.proposalApiBase ?? DEFAULT_PROPOSAL_API_BASE;
}

export function getConfiguredVoterAddress(): string | undefined {
    const value = process.env.SOURCE_DAO_VOTER_ADDRESS ?? loadedConfig.voterAddress;
    if (value === undefined) {
        return undefined;
    }

    return requireAddress(value, "voter address");
}

export function getOfflineModeFromConfig(): OfflineMode | undefined {
    const configured = process.env.SOURCE_DAO_OFFLINE_MODE ?? loadedConfig.offline?.mode;
    if (configured === undefined) {
        return undefined;
    }

    switch (configured) {
        case "prepare":
        case "sign":
        case "broadcast":
            return configured;
        default:
            throw new Error(`Unsupported offline mode: ${configured}`);
    }
}

export function getOfflineInputPathFromConfig(): string | undefined {
    const envValue = getOptionalString(process.env.SOURCE_DAO_OFFLINE_INPUT, "offline input path");
    if (envValue !== undefined) {
        return envValue;
    }

    const configValue = getOptionalString(loadedConfig.offline?.input, "offline input path");
    return configValue === undefined ? undefined : resolveRelativeToConfig(configValue);
}

export function getOfflineOutputPathFromConfig(): string | undefined {
    const envValue = getOptionalString(process.env.SOURCE_DAO_OFFLINE_OUTPUT, "offline output path");
    if (envValue !== undefined) {
        return envValue;
    }

    const configValue = getOptionalString(loadedConfig.offline?.output, "offline output path");
    return configValue === undefined ? undefined : resolveRelativeToConfig(configValue);
}

export function getOfflineSignedOutputPathFromConfig(): string | undefined {
    const envValue = getOptionalString(process.env.SOURCE_DAO_OFFLINE_SIGNED_OUTPUT, "offline signed output path");
    if (envValue !== undefined) {
        return envValue;
    }

    const configValue = getOptionalString(loadedConfig.offline?.signedOutput, "offline signed output path");
    return configValue === undefined ? undefined : resolveRelativeToConfig(configValue);
}

export function getOfflineBroadcastOutputPathFromConfig(): string | undefined {
    const envValue = getOptionalString(process.env.SOURCE_DAO_OFFLINE_BROADCAST_OUTPUT, "offline broadcast output path");
    if (envValue !== undefined) {
        return envValue;
    }

    const configValue = getOptionalString(loadedConfig.offline?.broadcastOutput, "offline broadcast output path");
    return configValue === undefined ? undefined : resolveRelativeToConfig(configValue);
}

export function getLoadedConfigPath(): string | undefined {
    return loadedConfigPath;
}

export function getProposalType(params: unknown[]): SupportedProposalType {
    const proposalType = requireString(params[params.length - 1], "proposal type");
    switch (proposalType) {
        case "createProject":
        case "acceptProject":
        case "upgradeContract":
        case "setCommittees":
            return proposalType;
        default:
            throw new Error(`Unsupported proposal type: ${proposalType}.`);
    }
}

export function encodeProposalParams(params: unknown[]): string[] {
    const proposalType = getProposalType(params);
    switch (proposalType) {
        case "createProject":
        case "acceptProject":
            if (params.length !== 7) {
                throw new Error(`Invalid ${proposalType} params length: expected 7, got ${params.length}.`);
            }

            return [
                zeroPadUint256(requireString(params[0], "project id")),
                ethers.encodeBytes32String(requireString(params[1], "project name")),
                zeroPadUint256(convertVersion(requireString(params[2], "version"))),
                zeroPadUint256(requireString(params[3], "start date")),
                zeroPadUint256(requireString(params[4], "end date")),
                ethers.encodeBytes32String(requireString(params[5], "action")),
            ];
        case "upgradeContract":
            if (params.length !== 3) {
                throw new Error(`Invalid upgradeContract params length: expected 3, got ${params.length}.`);
            }

            return [
                ethers.zeroPadValue(requireAddress(params[0], "old contract address"), 32),
                ethers.zeroPadValue(requireAddress(params[1], "new contract address"), 32),
                ethers.encodeBytes32String(proposalType),
            ];
        case "setCommittees":
            if (params.length < 2) {
                throw new Error("Invalid setCommittees params: expected at least one committee address.");
            }

            return params
                .slice(0, -1)
                .map((param, index) => ethers.zeroPadValue(requireAddress(param, `committee address ${index}`), 32))
                .concat(ethers.encodeBytes32String(proposalType));
    }
}

export function parseProposalId(value: string): number {
    const proposalId = parseInt(value, 10);
    if (Number.isNaN(proposalId) || proposalId <= 0) {
        throw new Error("Invalid proposal id. Please input a valid number greater than 0.");
    }

    return proposalId;
}

export async function fetchProposalParams(apiBase: string, proposalId: number): Promise<unknown[]> {
    const response = await fetch(`${apiBase}/proposal/${proposalId}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch proposal ${proposalId}: HTTP ${response.status}.`);
    }

    const proposalResult = (await response.json()) as ProposalApiResponse;
    if (proposalResult.code !== 0) {
        throw new Error(
            `Failed to get proposal ${proposalId} parameters: err code ${proposalResult.code}, ${proposalResult.message ?? "unknown error"}.`
        );
    }

    return proposalResult.data.params;
}
