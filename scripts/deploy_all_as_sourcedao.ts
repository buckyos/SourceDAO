import { ethers, upgrades } from "hardhat";

// Polygon amoy main contract: 0x785423901a501bcef29ab2a8cafa25d5a8c027d3

// Polygon main contract: 0xb91d38d7fAc9618A5480309b8b4b5d675D5Ae472

async function main() {
    let signers = await ethers.getSigners();
    console.log("prepareing contract...");
    const daoFactory = await ethers.getContractFactory('SourceDao')
    const committeeFactory = await ethers.getContractFactory('SourceDaoCommittee');
    const tokenFactory = await ethers.getContractFactory('SourceDaoToken')
    const tokenlockupFactory = await ethers.getContractFactory('SourceTokenLockup')
    const tokenDividendFactory = await ethers.getContractFactory('DividendContract')
    const projectFactory = await ethers.getContractFactory('ProjectManagement')
    const investmentFactory = await ethers.getContractFactory('Investment')
    const marketingFactory = await ethers.getContractFactory('MarketingContract')
    const multiWalletFactory = await ethers.getContractFactory('MultiSigWallet')
    const twoStepInvestmentFactory = await ethers.getContractFactory('TwoStepWhitelistInvestment')

    // Deploying the master contract
    console.log("Deploying main contract...");
    //let dao = daoFactory.attach("0xb91d38d7fAc9618A5480309b8b4b5d675D5Ae472") as unknown as SourceDao;
    
    const dao = await (await upgrades.deployProxy(daoFactory, undefined, {
        initializer: 'initialize',
        kind: "uups",
        timeout: 0,
    })).waitForDeployment();
    
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

        const committee = await (await upgrades.deployProxy(committeeFactory, [initCommittee, await dao.getAddress()], {
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
        ],
        tokenAmounts: [
        ],
    }

    if (await dao.token() == ethers.ZeroAddress) {
        // Deploying the Token contract
        console.log("Deploying token contract...");
        const token = await (await upgrades.deployProxy(tokenFactory, ["BuckyOS DAO Token", "BDT",
            ethers.parseEther("2100000000"), initToken.addresses, initToken.tokenAmounts, await dao.getAddress()
        ], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup Token Contract Address into Master Contract
        console.log("Set token address to main...");
        await (await dao.setTokenAddress(await token.getAddress())).wait();
    }

    if (await dao.lockup() == ethers.ZeroAddress) {
        // Deploying the TokenLockup contract
        console.log("Deploying token lockup contract...");
        const tokenlockup = await (await upgrades.deployProxy(tokenlockupFactory, [await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        console.log("Set committee address to main...");
        await (await dao.setTokenLockupAddress(await tokenlockup.getAddress())).wait();
    }

    if (await dao.devGroup() == ethers.ZeroAddress) {
        // Deploying the ProjectManagement contract
        console.log("Deploying project contract...");
        const project = await (await upgrades.deployProxy(projectFactory, [await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup ProjectManagement(Dev) Contract Address into Master Contract
        console.log("Set project address to main...");
        await (await dao.setDevAddress(await project.getAddress())).wait();
    }

    if (await dao.dividend() == ethers.ZeroAddress) {
        // Deploying the TokenDividend contract
        console.log("Deploying token devidend contract...");
        const tokenDividend = await (await upgrades.deployProxy(tokenDividendFactory, [await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup TokenDividend Contract Address into Master Contract
        console.log("Set token dividend address to main...");
        await (await dao.setTokenDividendAddress(await tokenDividend.getAddress())).wait();
    }

    if (await dao.investment() == ethers.ZeroAddress) {
        // Deploying the Investment contract
        console.log("Deploying investment contract...");
        const investment = await (await upgrades.deployProxy(investmentFactory, [await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup Investment Contract Address into Master Contract
        console.log("Set investment address to main...");
        await (await dao.setInvestmentAddress(await investment.getAddress())).wait();
    }

    if (await dao.twostepInvestment() == ethers.ZeroAddress) {
        console.log("Deploying two step investment contract...");
        const twostep = await (await upgrades.deployProxy(twoStepInvestmentFactory, [await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        console.log("Set two step investment address to main...");
        await (await dao.setTwoStepInvestmentAddress(await twostep.getAddress())).wait();
    }

    if (await dao.marketing() == ethers.ZeroAddress) {
        // Deploying the Income contract
        console.log("Deploying marketing contract...");
        const marketing = await (await upgrades.deployProxy(marketingFactory, [await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup Marketing Contract Address into Master Contract
        console.log("Set marketing address to main...");
        await (await dao.setMarketingAddress(await marketing.getAddress())).wait();
    }

    if (await dao.assetWallet() == ethers.ZeroAddress) {
        // Deploying the MultiSigWallet contract
        console.log("Deploying asset wallet contract...");
        const assetWallet = await (await upgrades.deployProxy(multiWalletFactory, ["asset", await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup Asset Wallet Address into Master Contract
        console.log("Set asset address to main...");
        await (await dao.setAssetWallet(await assetWallet.getAddress(), 0)).wait();

    }

    if (await dao.incomeWallet() == ethers.ZeroAddress) {
        // Deploying the Income contract
        console.log("Deploying asset income contract...");
        const incomeWallet = await (await upgrades.deployProxy(multiWalletFactory, ["income", await dao.getAddress()], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).waitForDeployment();

        // Setup Income wallet Address into Master Contract
        console.log("Set income address to main...");
        await (await dao.setIncomeWallet(await incomeWallet.getAddress(), 0)).wait();

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