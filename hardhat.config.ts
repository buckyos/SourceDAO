import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatTypechain from "@nomicfoundation/hardhat-typechain";

const artifactsDir = process.env.SOURCE_DAO_ARTIFACTS_DIR ?? "./artifacts";
const cacheDir = process.env.SOURCE_DAO_CACHE_DIR ?? "./cache";
const opmainRpcUrl =
    process.env.SOURCE_DAO_OPMAIN_RPC_URL ??
    "https://mainnet.optimism.io";
const deployerPrivateKey = process.env.SOURCE_DAO_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
const commonCompilerSettings = {
    optimizer: {
        enabled: true,
        runs: 200
    },
    viaIR: true
};

export default defineConfig({
    plugins: [
        hardhatMocha,
        hardhatEthers,
        hardhatEthersChaiMatchers,
        hardhatNetworkHelpers,
        hardhatTypechain
    ],
    networks: {
        localhost: {
            type: "http",
            chainType: "l1",
            url: "http://127.0.0.1:8545",
        },
        opmain: {
            type: "http",
            chainType: "l1",
            url: opmainRpcUrl,
            ...(deployerPrivateKey ? { accounts: [deployerPrivateKey] } : {}),
        },
    },
    paths: {
        artifacts: artifactsDir,
        cache: cacheDir,
        tests: {
            mocha: "./test-hh3"
        }
    },
    solidity: {
        npmFilesToBuild: ["@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol"],
        profiles: {
            default: {
                version: "0.8.20",
                settings: commonCompilerSettings
            },
            usdb: {
                version: "0.8.20",
                settings: {
                    ...commonCompilerSettings,
                    evmVersion: "shanghai"
                }
            }
        }
    },
    test: {
        mocha: {
            bail: true
        }
    }
});
