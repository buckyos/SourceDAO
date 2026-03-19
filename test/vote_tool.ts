import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "chai";
import { Contract, ContractFactory, Interface, JsonRpcProvider, Wallet, ethers } from "ethers";

const REPO_ROOT = process.cwd();
const FIRST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FIRST_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const SECOND_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const DAO_ARTIFACT_PATH = "artifacts/contracts/Dao.sol/SourceDao.json";
const COMMITTEE_ARTIFACT_PATH = "artifacts/contracts/Committee.sol/SourceDaoCommittee.json";
const PROXY_ARTIFACT_PATH = "artifacts/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json";

interface ToolResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

interface ScriptOptions {
    network?: string;
    stdin?: string;
    configPath?: string;
    interactions?: Array<{
        when: RegExp;
        send: string;
    }>;
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

function runHardhatScript(script: string, env: NodeJS.ProcessEnv, options: ScriptOptions = {}): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
        const args = ["hardhat", "run", "--no-compile"];
        if (options.configPath !== undefined) {
            args.push("--config", options.configPath);
        }
        if (options.network !== undefined) {
            args.push("--network", options.network);
        }
        args.push(script);

        const child = spawn("npx", args, {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                ...env
            },
            stdio: ["pipe", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        const pendingInteractions = [...(options.interactions ?? [])];

        const trySatisfyInteractions = () => {
            if (pendingInteractions.length === 0) {
                return;
            }

            const combinedOutput = stdout + stderr;
            while (pendingInteractions.length > 0 && pendingInteractions[0].when.test(combinedOutput)) {
                const next = pendingInteractions.shift()!;
                child.stdin.write(next.send);
            }

            if (pendingInteractions.length === 0 && options.interactions !== undefined) {
                child.stdin.end();
            }
        };

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
            trySatisfyInteractions();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            trySatisfyInteractions();
        });
        child.on("error", reject);
        child.on("close", (code) => {
            resolve({ code, stdout, stderr });
        });

        if (options.interactions !== undefined) {
            trySatisfyInteractions();
        } else if (options.stdin !== undefined) {
            child.stdin.end(options.stdin);
        } else {
            child.stdin.end();
        }
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

async function readArtifact(relativePath: string): Promise<{ abi: ethers.InterfaceAbi; bytecode: string }> {
    return JSON.parse(await readFile(join(REPO_ROOT, relativePath), "utf8")) as {
        abi: ethers.InterfaceAbi;
        bytecode: string;
    };
}

async function deployUupsProxyOnProvider(
    relativeArtifactPath: string,
    signer: ethers.Signer,
    initializerArgs: unknown[] = []
): Promise<Contract> {
    const implementationArtifact = await readArtifact(relativeArtifactPath);
    const implementationFactory = new ContractFactory(
        implementationArtifact.abi,
        implementationArtifact.bytecode,
        signer
    );
    const implementation = await implementationFactory.deploy();
    await implementation.waitForDeployment();

    const proxyArtifact = await readArtifact(PROXY_ARTIFACT_PATH);
    const proxyFactory = new ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, signer);
    const initializerData = new Interface(implementationArtifact.abi).encodeFunctionData("initialize", initializerArgs);
    const proxy = await proxyFactory.deploy(await implementation.getAddress(), initializerData);
    await proxy.waitForDeployment();

    return new Contract(await proxy.getAddress(), implementationArtifact.abi, signer);
}

function setCommitteesApiParams(members: string[]) {
    return [...members, "setCommittees"];
}

async function startHardhatNode(): Promise<{
    process: ChildProcessWithoutNullStreams;
    stop: () => Promise<void>;
}> {
    return startHardhatNodeOnPort(8545);
}

async function findFreePort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.listen(0, "127.0.0.1", () => {
            const address = server.address() as AddressInfo;
            server.close((error) => {
                if (error !== undefined) {
                    reject(error);
                    return;
                }

                resolve(address.port);
            });
        });
        server.once("error", reject);
    });
}

async function writeLocalhostConfig(port: number): Promise<string> {
    const configPath = join(REPO_ROOT, `.hardhat.localhost.${port}.config.ts`);
    await writeFile(
        configPath,
        `import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  paths: {
    tests: {
      mocha: "./test-hh3"
    }
  },
  networks: {
    localhost: {
      type: "http",
      url: "http://127.0.0.1:${port}"
    }
  },
  solidity: {
    version: "0.8.20",
    npmFilesToBuild: ["@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol"],
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  test: {
    mocha: {
      bail: true
    }
  }
});
`
    );

    return configPath;
}

async function startHardhatNodeOnPort(port: number): Promise<{
    process: ChildProcessWithoutNullStreams;
    stop: () => Promise<void>;
}> {
    const child = spawn("npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: REPO_ROOT,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    const started = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timed out while starting hardhat node.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        }, 30000);

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
            if (stdout.includes("Started HTTP and WebSocket JSON-RPC server at")) {
                clearTimeout(timeout);
                resolve();
            }
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("exit", (code) => {
            clearTimeout(timeout);
            reject(new Error(`hardhat node exited early with code ${code}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        });
    });

    await started;

    return {
        process: child,
        stop: async () => {
            if (child.killed) {
                return;
            }

            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    child.kill("SIGKILL");
                }, 5000);

                child.once("exit", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                child.kill("SIGINT");
            });
        }
    };
}

async function startProposalApiServer(params: unknown[]): Promise<{
    baseUrl: string;
    close: () => Promise<void>;
}> {
    const server = createServer((req, res) => {
        if (req.url === "/api/proposal/1") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ code: 0, data: { params } }));
            return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 404, message: "not found" }));
    });

    await new Promise<void>((resolve, reject) => {
        server.listen(0, "127.0.0.1", () => resolve());
        server.once("error", reject);
    });

    const address = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${address.port}/api`,
        close: async () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error !== undefined) {
                        reject(error);
                        return;
                    }

                    resolve();
                });
            })
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

    it("runs prepare-sign-broadcast and reads the updated proposal through proposal_status on a local node", async function () {
        const dir = await mkdtemp(join(tmpdir(), "source-dao-vote-tool-e2e-"));
        const configPath = join(dir, "vote.config.json");
        const unsignedPath = join(dir, "bundle-unsigned.json");
        const signedPath = join(dir, "bundle-signed.json");
        const broadcastedPath = join(dir, "bundle-broadcasted.json");
        const port = await findFreePort();
        const rpcUrl = `http://127.0.0.1:${port}`;
        const localhostConfigPath = await writeLocalhostConfig(port);
        const node = await startHardhatNodeOnPort(port);
        let apiServer: Awaited<ReturnType<typeof startProposalApiServer>> | undefined;

        try {
            const provider = new JsonRpcProvider(rpcUrl);
            const proposer = await provider.getSigner(0);
            const candidate = await provider.getSigner(2);

            const dao = await deployUupsProxyOnProvider(DAO_ARTIFACT_PATH, proposer);
            const committeeMembers = [FIRST_ADDRESS, SECOND_ADDRESS, await candidate.getAddress()];
            const committee = await deployUupsProxyOnProvider(COMMITTEE_ARTIFACT_PATH, proposer, [
                committeeMembers,
                1,
                200,
                ethers.encodeBytes32String("SourceDao"),
                1,
                150,
                await dao.getAddress()
            ]);

            await (await dao.connect(proposer).setCommitteeAddress(await committee.getAddress())).wait();
            await (await committee.connect(proposer).prepareSetCommittees(committeeMembers, false)).wait();

            apiServer = await startProposalApiServer(setCommitteesApiParams(committeeMembers));

            await writeFile(
                configPath,
                JSON.stringify(
                    {
                        daoAddress: await dao.getAddress(),
                        proposalApiBase: apiServer.baseUrl,
                        voterAddress: FIRST_ADDRESS,
                        status: {
                            proposalId: 1,
                            output: "json"
                        },
                        offline: {
                            output: "bundle-unsigned.json"
                        }
                    },
                    null,
                    2
                )
            );

            const prepareResult = await runHardhatScript(
                "tools/vote_offline.ts",
                {
                    SOURCE_DAO_CONFIG: configPath
                },
                {
                    configPath: localhostConfigPath,
                    network: "localhost",
                    interactions: [
                        { when: /Please input the proposal id to prepare:/, send: "1\n" },
                        { when: /Please input your vote \(s for support, r for reject\):/, send: "s\n" },
                        { when: /Do you confirm to prepare an offline support transaction for proposal 1\? \(y\/n\):/, send: "y\n" }
                    ]
                }
            );

            expect(prepareResult.code, `${prepareResult.stdout}\n${prepareResult.stderr}`).to.equal(0);
            expect(prepareResult.stdout).to.contain("Unsigned transaction bundle written to:");

            const signResult = await runHardhatScript(
                "tools/vote_offline.ts",
                {
                    SOURCE_DAO_CONFIG: configPath,
                    SOURCE_DAO_OFFLINE_MODE: "sign",
                    SOURCE_DAO_OFFLINE_INPUT: unsignedPath,
                    SOURCE_DAO_OFFLINE_SIGNED_OUTPUT: signedPath,
                    SOURCE_DAO_OFFLINE_PRIVATE_KEY: FIRST_PRIVATE_KEY
                },
                {
                    configPath: localhostConfigPath,
                    network: "localhost"
                }
            );

            expect(signResult.code, `${signResult.stdout}\n${signResult.stderr}`).to.equal(0);

            const broadcastResult = await runHardhatScript(
                "tools/vote_offline.ts",
                {
                    SOURCE_DAO_CONFIG: configPath,
                    SOURCE_DAO_OFFLINE_MODE: "broadcast",
                    SOURCE_DAO_OFFLINE_INPUT: signedPath,
                    SOURCE_DAO_OFFLINE_BROADCAST_OUTPUT: broadcastedPath
                },
                {
                    configPath: localhostConfigPath,
                    network: "localhost"
                }
            );

            expect(broadcastResult.code, `${broadcastResult.stdout}\n${broadcastResult.stderr}`).to.equal(0);
            expect(broadcastResult.stdout).to.contain("Broadcasted transaction:");

            const statusResult = await runHardhatScript(
                "tools/proposal_status.ts",
                {
                    SOURCE_DAO_CONFIG: configPath
                },
                {
                    configPath: localhostConfigPath,
                    network: "localhost"
                }
            );

            expect(statusResult.code, `${statusResult.stdout}\n${statusResult.stderr}`).to.equal(0);

            const proposalStatus = JSON.parse(statusResult.stdout) as {
                exists: boolean;
                supportCount: number;
                rejectCount: number;
                supportAddresses: string[];
                rejectAddresses: string[];
                kind: string;
                stateName: string;
            };
            expect(proposalStatus.exists).to.equal(true);
            expect(proposalStatus.kind).to.equal("ordinary");
            expect(proposalStatus.stateName).to.equal("InProgress");
            expect(proposalStatus.supportCount).to.equal(1);
            expect(proposalStatus.rejectCount).to.equal(0);
            expect(proposalStatus.supportAddresses.map((address) => address.toLowerCase())).to.deep.equal([
                FIRST_ADDRESS.toLowerCase()
            ]);
            expect(proposalStatus.rejectAddresses).to.deep.equal([]);

            const broadcastedBundle = JSON.parse(await readFile(broadcastedPath, "utf8")) as OfflineVoteBundle;
            expect(broadcastedBundle.broadcastTxHash).to.match(/^0x[0-9a-f]{64}$/i);
        } finally {
            if (apiServer !== undefined) {
                await apiServer.close();
            }
            await node.stop();
            await unlink(localhostConfigPath).catch(() => undefined);
        }
    });
});
