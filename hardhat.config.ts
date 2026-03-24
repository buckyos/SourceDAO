import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

const artifactsDir = process.env.SOURCE_DAO_ARTIFACTS_DIR ?? "./artifacts";
const cacheDir = process.env.SOURCE_DAO_CACHE_DIR ?? "./cache";
const commonCompilerSettings = {
    optimizer: {
        enabled: true,
        runs: 200
    },
    viaIR: true
};

export default defineConfig({
    plugins: [hardhatToolboxMochaEthers],
    networks: {
        localhost: {
            type: "http",
            chainType: "l1",
            url: "http://127.0.0.1:8545",
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
