import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'hardhat-abi-exporter';
import '@openzeppelin/hardhat-upgrades';

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.18",
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
        goerli: {
            url: "https://goerli.infura.io/v3/8ee80cc4b7c34819957fa2c6d63429e3",
            chainId: 5,
            accounts: [
                "0x703715dee0b20e07f2a22c83599a03ac283da5866639f397ebbebad243c373dc",
                "0xfed28063044d0014049394caf302f56ead653c0553ff86d571dc88d2b08ced47",
                "0x2a29b82c569459d23ce1a7705baaecbb096c12ce50e89a1934df66d6436372a7"
            ]
        },
        mumbai: {
            url: "https://polygon-mumbai.infura.io/v3/8ee80cc4b7c34819957fa2c6d63429e3",
            accounts: [
                "0x703715dee0b20e07f2a22c83599a03ac283da5866639f397ebbebad243c373dc",
                "0xfed28063044d0014049394caf302f56ead653c0553ff86d571dc88d2b08ced47",
                "0x2a29b82c569459d23ce1a7705baaecbb096c12ce50e89a1934df66d6436372a7"
            ]
        },
    },
};

export default config;
