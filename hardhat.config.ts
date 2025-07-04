import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'hardhat-abi-exporter';
import "hardhat-gas-reporter";
import '@openzeppelin/hardhat-upgrades';

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            },
            viaIR: true
        }
    },
    abiExporter: {
        runOnCompile: true,
        clear: true,
    },
    gasReporter: {
        enabled: false,
    },
    networks: {
        
    },
    mocha: {
        bail: true,
    }
};

export default config;
