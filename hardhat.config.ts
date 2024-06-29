import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'hardhat-abi-exporter';
import '@openzeppelin/hardhat-upgrades';

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    abiExporter: {
        runOnCompile: true,
        clear: true,
    },
    networks: {
        
    },
};

export default config;
