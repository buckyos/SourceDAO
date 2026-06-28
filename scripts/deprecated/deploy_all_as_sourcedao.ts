import { ethers, upgrades } from "hardhat";
import { SourceDao } from "../typechain-types";

function convertVersion(version: string): number {
    let versions = version.split('.');
    if (versions.length < 3) {
        throw new Error(`Invalid version format: ${version}. Expected format is 'major.minor.patch'.`);
    }

    let major = parseInt(versions[0], 10);
    let minor = parseInt(versions[1], 10);
    let patch = parseInt(versions[2], 10);

    return major*10000000000+minor*100000+patch
}

// Polygon amoy main contract: 0x785423901a501bcef29ab2a8cafa25d5a8c027d3

// Polygon main contract: 0xb91d38d7fAc9618A5480309b8b4b5d675D5Ae472
// xlayer main contract: 0x81e929BFF98C30Ab4BE484E35F96B69863C451Dd

// opmain main contract: 0x191Af8663fF88823d6b226621DC4700809D042fa
// opmain main new contract: 0x2fc3186176B80EA829A7952b874F36f7cb8bd184 
async function main() {
    let signers = await ethers.getSigners();
    console.log("prepareing contract...");
    const daoFactory = await ethers.getContractFactory('SourceDao')
    const committeeFactory = await ethers.getContractFactory('SourceDaoCommittee');
    const devTokenFactory = await ethers.getContractFactory('DevToken');
    const normalTokenFactory = await ethers.getContractFactory('NormalToken');
    const acquiredFactory = await ethers.getContractFactory('Acquired');
    const tokenlockupFactory = await ethers.getContractFactory('SourceTokenLockup')
    const tokenDividendFactory = await ethers.getContractFactory('DividendContract')
    const projectFactory = await ethers.getContractFactory('ProjectManagement')

    // Deploying the master contract
    console.log("Deploying main contract...");
    let dao = daoFactory.attach("0x2fc3186176B80EA829A7952b874F36f7cb8bd184") as unknown as SourceDao;
    /*
    const dao = await (await upgrades.deployProxy(daoFactory, undefined, {
        initializer: 'initialize',
        kind: "uups",
        timeout: 0,
    })).waitForDeployment() as unknown as SourceDao;
    */
    // Display all the contract addresses
    console.log("depolyed main contract address:", await dao.getAddress());

    // {nonce: (await ethers.getSigners())[0].getTransactionCount("latest")}
    const initCommittee = [
        "0xad82A5fb394a525835A3a6DC34C1843e19160CFA",
        "0x2514d2FEAAC3bFD8361333d1341dC8823595f744",
        "0x2DFD1FCFC9601E7De871b0BbcBCbB6Cad6901697"
    ]

    if (await dao.committee() == ethers.ZeroAddress) {
        // Deploying committee contract
        console.log("Deploying committee contract...");
        // Preparation of initial committee members

        const committee = await (await upgrades.deployProxy(committeeFactory, [initCommittee, 7, 400, ethers.encodeBytes32String("Buckyos"), convertVersion("1.0.0"), 120, await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup Committee Contract Address into Master Contract
        console.log("Set committee address to main...");
        await (await dao.setCommitteeAddress(await committee.getAddress())).wait();
    }

    const initToken = {
        addresses: [
            '0x2DFD1FCFC9601E7De871b0BbcBCbB6Cad6901697',
            '0xad82A5fb394a525835A3a6DC34C1843e19160CFA',
            '0x0Ef9534aE246d24e1C79BC1fE8c8718C11a7fF09',
            '0x2514d2FEAAC3bFD8361333d1341dC8823595f744',
            '0x0F56a6f7662B38506f7Ad0ad0cc952b79b8e90e7',
            '0x71165cD9579b495276De7b0389bB2Cd5352DaFE6',
            '0x865d123D1CFC7F95B48495A854173408032b9358',
            '0x19b54B60908241C301d5c95EDbd4C80081dF95B5',
            '0xC7ced856D14720547533E1E32D7FEfb9877E84E5',
            '0xdc7dD66eafdBf4B2e40CbC7bEb93f732f8F86518',
        ],
        tokenAmounts: [
            109876068779349609949184721n,
            6035901558616593430477310n,
            6830778957104289571042895n,
            2580803954604539546045395n,
            4155646470352964703529647n,
            35000000000000000000000n,
            1950866948305169483051694n,
            4466415393460653934606539n,
            4945967938206179382061793n,
            6122550000000000000000000n,
          ],
    }

    if (await dao.devToken() == ethers.ZeroAddress) {
        // Deploying the Token contract
        console.log("Deploying dev token contract...");
        const token = await (await upgrades.deployProxy(devTokenFactory, ["BuckyOS Develop DAO Token", "BDDT",
            ethers.parseEther("2100000000"), initToken.addresses, initToken.tokenAmounts, await dao.getAddress()
        ], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup Token Contract Address into Master Contract
        console.log("Set dev token address to main...");
        await (await dao.setDevTokenAddress(await token.getAddress())).wait();
    }

    if (await dao.normalToken() == ethers.ZeroAddress) {
        // Deploying the Token contract
        console.log("Deploying normal token contract...");
        const token = await (await upgrades.deployProxy(normalTokenFactory, ["BuckyOS DAO Token", "BDT", await dao.getAddress()], 
        {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup Token Contract Address into Master Contract
        console.log("Set normal token address to main...");
        await (await dao.setNormalTokenAddress(await token.getAddress())).wait();
    }

    if (await dao.lockup() == ethers.ZeroAddress) {
        // Deploying the TokenLockup contract
        console.log("Deploying token lockup contract...");
        const tokenlockup = await (await upgrades.deployProxy(tokenlockupFactory, [ethers.encodeBytes32String("Buckyos"), convertVersion("1.0.0"), await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        console.log("Set lockup address to main...");
        await (await dao.setTokenLockupAddress(await tokenlockup.getAddress())).wait();
    }

    if (await dao.project() == ethers.ZeroAddress) {
        // Deploying the ProjectManagement contract
        console.log("Deploying project contract...");
        const project = await (await upgrades.deployProxy(projectFactory, [4, await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup ProjectManagement(Dev) Contract Address into Master Contract
        console.log("Set project address to main...");
        await (await dao.setProjectAddress(await project.getAddress())).wait();
    }

    if (await dao.dividend() == ethers.ZeroAddress) {
        // Deploying the TokenDividend contract
        console.log("Deploying token devidend contract...");
        const tokenDividend = await (await upgrades.deployProxy(tokenDividendFactory, [7*24*60*60, await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup TokenDividend Contract Address into Master Contract
        console.log("Set token dividend address to main...");
        await (await dao.setTokenDividendAddress(await tokenDividend.getAddress())).wait();
    }

    if (await dao.acquired() == ethers.ZeroAddress) {
        console.log("Deploying two step investment contract...");
        const twostep = await (await upgrades.deployProxy(acquiredFactory, [4, await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        console.log("Set two step investment address to main...");
        await (await dao.setAcquiredAddress(await twostep.getAddress())).wait();
    }
    // After all contracts are deployed, perform the following steps:
    // Display all the contract addresses
    console.log("depolyed finish.");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});