import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
    plugins: [hardhatToolboxMochaEthers],
    paths: {
        tests: {
            mocha: "./test-hh3"
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
