import { exit } from "node:process";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { readFile, writeFile } from "node:fs/promises";

import { ethers, Transaction, Wallet } from "ethers";
import hre from "hardhat";

import {
    encodeProposalParams,
    fetchProposalParams,
    getConfiguredVoterAddress,
    getDaoAddress,
    getLoadedConfigPaths,
    getOfflineBroadcastOutputPathFromConfig,
    getOfflineInputPathFromConfig,
    getOfflineModeFromConfig,
    getOfflineOutputPathFromConfig,
    getOfflineSignedOutputPathFromConfig,
    getProposalApiBase,
    parseProposalId,
    requireAddress,
    type OfflineMode,
    type SupportedProposalType
} from "./vote_common.js";

type VoteChoice = "support" | "reject";

interface StoredUnsignedTransaction {
    to: string;
    data: string;
    nonce: number;
    chainId: string;
    gasLimit: string;
    value: string;
    type: number;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasPrice?: string;
}

interface OfflineVoteBundle {
    format: "sourcedao-offline-vote-v1";
    createdAt: string;
    networkName: string;
    rpcUrl: string;
    daoAddress: string;
    committeeAddress: string;
    voterAddress: string;
    proposal: {
        id: number;
        type: SupportedProposalType;
        isFullProposal: boolean;
        state: string;
        expired: string;
        rawParams: unknown[];
        encodedParams: string[];
    };
    voteChoice: VoteChoice;
    unsignedTransaction: StoredUnsignedTransaction;
    signedTransaction?: string;
    signedAt?: string;
    broadcastTxHash?: string;
    broadcastAt?: string;
}

function getOfflineMode(): OfflineMode {
    const configured = getOfflineModeFromConfig();
    if (configured === undefined) {
        return "prepare";
    }

    return configured;
}

function getRpcUrl(networkConfig: unknown): string {
    const maybeUrl = (networkConfig as { url?: unknown }).url;
    return typeof maybeUrl === "string" ? maybeUrl : "N/A";
}

function getOfflinePrivateKey(): string {
    const privateKey = process.env.SOURCE_DAO_OFFLINE_PRIVATE_KEY;
    if (privateKey === undefined || privateKey.trim() === "") {
        throw new Error("Missing SOURCE_DAO_OFFLINE_PRIVATE_KEY for offline signing.");
    }

    return privateKey.trim();
}

function getOfflineInputPath(): string {
    const inputPath = getOfflineInputPathFromConfig();
    if (inputPath === undefined || inputPath.trim() === "") {
        throw new Error("Missing SOURCE_DAO_OFFLINE_INPUT.");
    }

    return inputPath.trim();
}

function getDefaultUnsignedPath(proposalId: number, voteChoice: VoteChoice): string {
    return resolve(`vote-offline-${proposalId}-${voteChoice}-unsigned.json`);
}

function getDefaultSignedPath(inputPath: string): string {
    const resolved = resolve(inputPath);
    const ext = extname(resolved);
    const base = basename(resolved, ext);
    return join(dirname(resolved), `${base.replace(/-unsigned$/, "")}-signed.json`);
}

function serializeUnsignedTransaction(tx: {
    to: string;
    data: string;
    nonce: number;
    chainId: bigint;
    gasLimit: bigint;
    value?: bigint;
    type: number;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    gasPrice?: bigint;
}): StoredUnsignedTransaction {
    return {
        to: tx.to,
        data: tx.data,
        nonce: tx.nonce,
        chainId: tx.chainId.toString(),
        gasLimit: tx.gasLimit.toString(),
        value: (tx.value ?? 0n).toString(),
        type: tx.type,
        maxFeePerGas: tx.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(),
        gasPrice: tx.gasPrice?.toString()
    };
}

function materializeUnsignedTransaction(tx: StoredUnsignedTransaction): ethers.TransactionLike<string> {
    return {
        to: tx.to,
        data: tx.data,
        nonce: tx.nonce,
        chainId: BigInt(tx.chainId),
        gasLimit: BigInt(tx.gasLimit),
        value: BigInt(tx.value),
        type: tx.type,
        maxFeePerGas: tx.maxFeePerGas === undefined ? undefined : BigInt(tx.maxFeePerGas),
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas === undefined ? undefined : BigInt(tx.maxPriorityFeePerGas),
        gasPrice: tx.gasPrice === undefined ? undefined : BigInt(tx.gasPrice)
    };
}

async function loadBundle(inputPath: string): Promise<OfflineVoteBundle> {
    const file = await readFile(resolve(inputPath), "utf8");
    const bundle = JSON.parse(file) as OfflineVoteBundle;
    if (bundle.format !== "sourcedao-offline-vote-v1") {
        throw new Error(`Unsupported offline vote bundle format: ${bundle.format}`);
    }

    return bundle;
}

async function promptVoterAddress(rl: ReturnType<typeof createInterface>): Promise<string> {
    const configured = getConfiguredVoterAddress();
    if (configured !== undefined) {
        return configured;
    }

    return requireAddress(await rl.question("Please input the voter address for offline signing: "), "voter address");
}

async function promptVoteChoice(rl: ReturnType<typeof createInterface>): Promise<VoteChoice> {
    while (true) {
        const voteInput = await rl.question("Please input your vote (s for support, r for reject): ");
        if (voteInput === "s" || voteInput === "support") {
            return "support";
        }

        if (voteInput === "r" || voteInput === "reject") {
            return "reject";
        }

        console.error("Invalid input. Please input 's' for support or 'r' for reject.");
    }
}

async function prepareOfflineVote(): Promise<void> {
    const connection = await hre.network.connect();
    const { ethers: hardhatEthers } = connection;
    const provider = hardhatEthers.provider;
    const daoAddress = getDaoAddress();
    const proposalApiBase = getProposalApiBase();
    const rpcUrl = getRpcUrl(connection.networkConfig);
    const loadedConfigPaths = getLoadedConfigPaths();

    console.log(`Using network ${connection.networkName}, endpoint: ${rpcUrl}`);
    console.log(`Using DAO address: ${daoAddress}`);
    console.log(`Using proposal API: ${proposalApiBase}`);
    if (loadedConfigPaths.length > 0) {
        console.log(`Using config files: ${loadedConfigPaths.join(", ")}`);
    }

    const dao = await hardhatEthers.getContractAt("SourceDao", daoAddress);
    const committeeAddress = await dao.committee();
    const committee = await hardhatEthers.getContractAt("SourceDaoCommittee", committeeAddress);
    console.log(`Using Committee contract address: ${committeeAddress}`);

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        const voterAddress = await promptVoterAddress(rl);
        console.log(`Using voter address: ${voterAddress}`);

        const proposalId = parseProposalId(await rl.question("Please input the proposal id to prepare: "));
        const proposalInfo = await committee.proposalOf(proposalId);
        if (proposalInfo.origin === hardhatEthers.ZeroAddress) {
            throw new Error(`Proposal ${proposalId} not found.`);
        }

        console.log(`Proposal ${proposalId} info:`);
        console.log(`\torigin: ${proposalInfo.origin}`);
        console.log(`\tstate: ${proposalInfo.state}`);
        console.log(`\texpired at: ${new Date(Number(proposalInfo.expired) * 1000).toLocaleString()}`);

        const extra = await committee.proposalExtraOf(proposalId);
        const isFullProposal = extra.from !== hardhatEthers.ZeroAddress;
        if (isFullProposal) {
            console.log("This is a full proposal. The signed transaction will still follow the current on-chain settlement logic.");
        }

        const voteChoice = await promptVoteChoice(rl);

        console.log("Getting proposal parameters from BuckyOS SourceDAO backend...");
        const proposalParams = await fetchProposalParams(proposalApiBase, proposalId);
        console.log(`Please check proposal ${proposalId} parameters:`, proposalParams);

        const confirm = await rl.question(
            `Do you confirm to prepare an offline ${voteChoice} transaction for proposal ${proposalId}? (y/n): `
        );
        if (confirm !== "y" && confirm !== "yes") {
            console.log("Offline vote preparation cancelled.");
            return;
        }

        const encodedParams = encodeProposalParams(proposalParams);
        const functionName = voteChoice === "support" ? "support" : "reject";
        const data = committee.interface.encodeFunctionData(functionName, [proposalId, encodedParams]);
        const nonce = await provider.getTransactionCount(voterAddress, "pending");
        const feeData = await provider.getFeeData();
        const chainId = (await provider.getNetwork()).chainId;
        const estimatedGas = await provider.estimateGas({
            from: voterAddress,
            to: committeeAddress,
            data
        });
        const gasLimit = (estimatedGas * 120n) / 100n;

        const unsignedTransaction = serializeUnsignedTransaction({
            to: committeeAddress,
            data,
            nonce,
            chainId,
            gasLimit,
            value: 0n,
            type: feeData.maxFeePerGas !== null && feeData.maxPriorityFeePerGas !== null ? 2 : 0,
            maxFeePerGas: feeData.maxFeePerGas ?? undefined,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
            gasPrice: feeData.gasPrice ?? undefined
        });

        const bundle: OfflineVoteBundle = {
            format: "sourcedao-offline-vote-v1",
            createdAt: new Date().toISOString(),
            networkName: connection.networkName,
            rpcUrl,
            daoAddress,
            committeeAddress,
            voterAddress,
            proposal: {
                id: proposalId,
                type: proposalParams[proposalParams.length - 1] as SupportedProposalType,
                isFullProposal,
                state: proposalInfo.state.toString(),
                expired: proposalInfo.expired.toString(),
                rawParams: proposalParams,
                encodedParams
            },
            voteChoice,
            unsignedTransaction
        };

        const outputPath = getOfflineOutputPathFromConfig() ?? getDefaultUnsignedPath(proposalId, voteChoice);
        await writeFile(resolve(outputPath), JSON.stringify(bundle, null, 2));

        console.log(`Unsigned transaction bundle written to: ${resolve(outputPath)}`);
        console.log("Move this file to your offline machine for signing.");
    } finally {
        rl.close();
    }
}

async function signOfflineVote(inputPath: string): Promise<void> {
    const bundle = await loadBundle(inputPath);
    const wallet = new Wallet(getOfflinePrivateKey());
    const expectedAddress = requireAddress(bundle.voterAddress, "bundle voter address");
    if (wallet.address !== expectedAddress) {
        throw new Error(`Offline private key address ${wallet.address} does not match bundle voter ${expectedAddress}.`);
    }

    const signedTransaction = await wallet.signTransaction(materializeUnsignedTransaction(bundle.unsignedTransaction));
    const outputPath = getOfflineSignedOutputPathFromConfig() ?? getDefaultSignedPath(inputPath);

    const signedBundle: OfflineVoteBundle = {
        ...bundle,
        signedTransaction,
        signedAt: new Date().toISOString()
    };

    await writeFile(resolve(outputPath), JSON.stringify(signedBundle, null, 2));
    console.log(`Signed transaction bundle written to: ${resolve(outputPath)}`);
}

async function broadcastOfflineVote(inputPath: string): Promise<void> {
    const bundle = await loadBundle(inputPath);
    if (bundle.signedTransaction === undefined) {
        throw new Error("The input bundle does not contain a signedTransaction.");
    }

    const connection = await hre.network.connect();
    const { ethers: hardhatEthers } = connection;
    const provider = hardhatEthers.provider;
    const network = await provider.getNetwork();
    const parsed = Transaction.from(bundle.signedTransaction);

    if (parsed.to === null || hardhatEthers.getAddress(parsed.to) !== hardhatEthers.getAddress(bundle.committeeAddress)) {
        throw new Error("Signed transaction target does not match the committee address in the bundle.");
    }

    if (parsed.from === undefined || hardhatEthers.getAddress(parsed.from) !== hardhatEthers.getAddress(bundle.voterAddress)) {
        throw new Error("Signed transaction sender does not match the voter address in the bundle.");
    }

    if (parsed.chainId !== BigInt(bundle.unsignedTransaction.chainId) || parsed.chainId !== network.chainId) {
        throw new Error(`Signed transaction chainId ${parsed.chainId} does not match active network chainId ${network.chainId}.`);
    }

    const response = await provider.broadcastTransaction(bundle.signedTransaction);
    const outputPath = getOfflineBroadcastOutputPathFromConfig() ?? resolve(inputPath);
    const broadcastedBundle: OfflineVoteBundle = {
        ...bundle,
        broadcastTxHash: response.hash,
        broadcastAt: new Date().toISOString()
    };

    await writeFile(outputPath, JSON.stringify(broadcastedBundle, null, 2));
    console.log(`Broadcasted transaction: ${response.hash}`);
    console.log(`Updated bundle written to: ${outputPath}`);
}

async function main(): Promise<void> {
    const mode = getOfflineMode();
    switch (mode) {
        case "prepare":
            await prepareOfflineVote();
            return;
        case "sign":
            await signOfflineVote(getOfflineInputPath());
            return;
        case "broadcast":
            await broadcastOfflineVote(getOfflineInputPath());
    }
}

main()
    .then(() => {
        console.log("Offline vote tool finished.");
        exit(0);
    })
    .catch((error: unknown) => {
        console.error(error);
        exit(1);
    });
