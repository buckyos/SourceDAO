import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "chai";
import { Wallet } from "ethers";

const REPO_ROOT = process.cwd();
const FIRST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FIRST_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const SECOND_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

interface ToolResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

interface OfflineVoteBundle {
    format: string;
    createdAt: string;
    networkName: string;
    rpcUrl: string;
    daoAddress: string;
    committeeAddress: string;
    voterAddress: string;
    proposal: {
        id: number;
        type: string;
        isFullProposal: boolean;
        state: string;
        expired: string;
        rawParams: unknown[];
        encodedParams: string[];
    };
    voteChoice: string;
    unsignedTransaction: {
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
    };
    signedTransaction?: string;
    signedAt?: string;
    broadcastTxHash?: string;
}

function runHardhatScript(script: string, env: NodeJS.ProcessEnv): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
        const child = spawn("npx", ["hardhat", "run", "--no-compile", script], {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                ...env
            },
            stdio: ["ignore", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
            resolve({ code, stdout, stderr });
        });
    });
}

function buildUnsignedBundle(committeeAddress = SECOND_ADDRESS): OfflineVoteBundle {
    return {
        format: "sourcedao-offline-vote-v1",
        createdAt: "2026-03-14T00:00:00.000Z",
        networkName: "default",
        rpcUrl: "N/A",
        daoAddress: "0x0000000000000000000000000000000000000001",
        committeeAddress,
        voterAddress: FIRST_ADDRESS,
        proposal: {
            id: 1,
            type: "setCommittees",
            isFullProposal: false,
            state: "1",
            expired: "0",
            rawParams: [committeeAddress, "setCommittees"],
            encodedParams: [
                "0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8",
                "0x736574436f6d6d69747465657300000000000000000000000000000000000000"
            ]
        },
        voteChoice: "support",
        unsignedTransaction: {
            to: committeeAddress,
            data: "0x",
            nonce: 0,
            chainId: "31337",
            gasLimit: "21000",
            value: "0",
            type: 2,
            maxFeePerGas: "2000000000",
            maxPriorityFeePerGas: "1000000000"
        }
    };
}

describe("vote tools", function () {
    this.timeout(60000);

    it("signs an offline vote bundle using JSON config with relative paths", async function () {
        const dir = await mkdtemp(join(tmpdir(), "source-dao-vote-tool-"));
        const configPath = join(dir, "vote.config.json");
        const unsignedPath = join(dir, "bundle-unsigned.json");
        const signedPath = join(dir, "bundle-signed.json");

        await writeFile(
            configPath,
            JSON.stringify(
                {
                    daoAddress: "0x0000000000000000000000000000000000000001",
                    proposalApiBase: "https://dao.example.test/api",
                    voterAddress: FIRST_ADDRESS,
                    offline: {
                        mode: "sign",
                        input: "bundle-unsigned.json",
                        signedOutput: "bundle-signed.json"
                    }
                },
                null,
                2
            )
        );
        await writeFile(unsignedPath, JSON.stringify(buildUnsignedBundle(), null, 2));

        const result = await runHardhatScript("tools/vote_offline.ts", {
            SOURCE_DAO_CONFIG: configPath,
            SOURCE_DAO_OFFLINE_PRIVATE_KEY: FIRST_PRIVATE_KEY
        });

        expect(result.code).to.equal(0);
        expect(result.stdout).to.contain("Signed transaction bundle written to:");

        const signedBundle = JSON.parse(await readFile(signedPath, "utf8")) as OfflineVoteBundle;
        expect(signedBundle.signedTransaction).to.match(/^0x[0-9a-f]+$/i);
        expect(signedBundle.signedAt).to.be.a("string");
    });

    it("merges shared profile config with local config overrides", async function () {
        const dir = await mkdtemp(join(tmpdir(), "source-dao-vote-tool-"));
        const profilePath = join(dir, "opmain.json");
        const localPath = join(dir, "local.json");

        await writeFile(
            profilePath,
            JSON.stringify(
                {
                    daoAddress: "0x0000000000000000000000000000000000000001",
                    proposalApiBase: "https://dao.example.test/api"
                },
                null,
                2
            )
        );
        await writeFile(
            localPath,
            JSON.stringify(
                {
                    status: {
                        output: "text"
                    }
                },
                null,
                2
            )
        );

        const result = await runHardhatScript("tools/vote.ts", {
            SOURCE_DAO_PROFILE_PATH: profilePath,
            SOURCE_DAO_LOCAL_CONFIG: localPath
        });

        expect(result.code).to.not.equal(0);
        expect(result.stdout).to.contain(`Using DAO address: 0x0000000000000000000000000000000000000001`);
        expect(result.stdout).to.contain("Using proposal API: https://dao.example.test/api");
        expect(result.stdout).to.contain(`Using config files: ${profilePath}, ${localPath}`);
    });

    it("rejects offline signing when the private key does not match the configured voter", async function () {
        const dir = await mkdtemp(join(tmpdir(), "source-dao-vote-tool-"));
        const configPath = join(dir, "vote.config.json");
        const unsignedPath = join(dir, "bundle-unsigned.json");

        await writeFile(
            configPath,
            JSON.stringify(
                {
                    offline: {
                        mode: "sign",
                        input: "bundle-unsigned.json"
                    }
                },
                null,
                2
            )
        );
        await writeFile(unsignedPath, JSON.stringify(buildUnsignedBundle(), null, 2));

        const wrongPrivateKey = Wallet.createRandom().privateKey;
        const result = await runHardhatScript("tools/vote_offline.ts", {
            SOURCE_DAO_CONFIG: configPath,
            SOURCE_DAO_OFFLINE_PRIVATE_KEY: wrongPrivateKey
        });

        expect(result.code).to.not.equal(0);
        expect(result.stderr).to.contain("does not match bundle voter");
    });

    it("broadcasts a signed bundle and writes back the transaction hash", async function () {
        const dir = await mkdtemp(join(tmpdir(), "source-dao-vote-tool-"));
        const configPath = join(dir, "vote.config.json");
        const signedPath = join(dir, "bundle-signed.json");
        const broadcastedPath = join(dir, "bundle-broadcasted.json");

        const wallet = new Wallet(FIRST_PRIVATE_KEY);
        const unsignedBundle = buildUnsignedBundle();
        const signedTransaction = await wallet.signTransaction({
            to: unsignedBundle.unsignedTransaction.to,
            data: unsignedBundle.unsignedTransaction.data,
            nonce: unsignedBundle.unsignedTransaction.nonce,
            chainId: BigInt(unsignedBundle.unsignedTransaction.chainId),
            gasLimit: BigInt(unsignedBundle.unsignedTransaction.gasLimit),
            value: BigInt(unsignedBundle.unsignedTransaction.value),
            type: unsignedBundle.unsignedTransaction.type,
            maxFeePerGas: BigInt(unsignedBundle.unsignedTransaction.maxFeePerGas!),
            maxPriorityFeePerGas: BigInt(unsignedBundle.unsignedTransaction.maxPriorityFeePerGas!)
        });

        await writeFile(
            configPath,
            JSON.stringify(
                {
                    offline: {
                        mode: "broadcast",
                        input: "bundle-signed.json",
                        broadcastOutput: "bundle-broadcasted.json"
                    }
                },
                null,
                2
            )
        );
        await writeFile(
            signedPath,
            JSON.stringify(
                {
                    ...unsignedBundle,
                    signedTransaction,
                    signedAt: "2026-03-14T00:00:00.000Z"
                },
                null,
                2
            )
        );

        const result = await runHardhatScript("tools/vote_offline.ts", {
            SOURCE_DAO_CONFIG: configPath
        });

        expect(result.code).to.equal(0);
        expect(result.stdout).to.contain("Broadcasted transaction:");

        const broadcastedBundle = JSON.parse(await readFile(broadcastedPath, "utf8")) as OfflineVoteBundle;
        expect(broadcastedBundle.broadcastTxHash).to.match(/^0x[0-9a-f]{64}$/i);
    });

    it("rejects broadcast when the signed transaction target does not match the bundle committee address", async function () {
        const dir = await mkdtemp(join(tmpdir(), "source-dao-vote-tool-"));
        const configPath = join(dir, "vote.config.json");
        const signedPath = join(dir, "bundle-signed.json");

        const wallet = new Wallet(FIRST_PRIVATE_KEY);
        const unsignedBundle = buildUnsignedBundle();
        const signedTransaction = await wallet.signTransaction({
            to: unsignedBundle.unsignedTransaction.to,
            data: unsignedBundle.unsignedTransaction.data,
            nonce: unsignedBundle.unsignedTransaction.nonce,
            chainId: BigInt(unsignedBundle.unsignedTransaction.chainId),
            gasLimit: BigInt(unsignedBundle.unsignedTransaction.gasLimit),
            value: BigInt(unsignedBundle.unsignedTransaction.value),
            type: unsignedBundle.unsignedTransaction.type,
            maxFeePerGas: BigInt(unsignedBundle.unsignedTransaction.maxFeePerGas!),
            maxPriorityFeePerGas: BigInt(unsignedBundle.unsignedTransaction.maxPriorityFeePerGas!)
        });

        await writeFile(
            configPath,
            JSON.stringify(
                {
                    offline: {
                        mode: "broadcast",
                        input: "bundle-signed.json"
                    }
                },
                null,
                2
            )
        );
        await writeFile(
            signedPath,
            JSON.stringify(
                {
                    ...unsignedBundle,
                    committeeAddress: "0x1111111111111111111111111111111111111111",
                    signedTransaction,
                    signedAt: "2026-03-14T00:00:00.000Z"
                },
                null,
                2
            )
        );

        const result = await runHardhatScript("tools/vote_offline.ts", {
            SOURCE_DAO_CONFIG: configPath
        });

        expect(result.code).to.not.equal(0);
        expect(result.stderr).to.contain("Signed transaction target does not match");
    });
});
