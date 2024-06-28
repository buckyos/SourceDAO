import { ethers, upgrades } from "hardhat";
import { SourceDao, SourceDaoCommittee, SourceDaoToken, Investment, MultiSigWallet, ProjectManagement, SourceTokenLockup, DividendContract, TwoStepWhitelistInvestment, MarketingContract } from "../typechain-types";

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
    //let dao = daoFactory.attach("0x05F2E406606f82Ec96DcE822B295278795c5053B"); 
    const dao = await (await upgrades.deployProxy(daoFactory, undefined, {
        initializer: 'initialize',
        kind: "uups",
        timeout: 0,
    })).deployed() as SourceDao;

    // Display all the contract addresses
    console.log("depolyed main contract address:", dao.address);

    // {nonce: (await ethers.getSigners())[0].getTransactionCount("latest")}

    if (await dao.committee() == ethers.constants.AddressZero) {
        // Deploying committee contract
        console.log("Deploying committee contract...");
        // Preparation of initial committee members

        const committee = await (await upgrades.deployProxy(committeeFactory, [[signers[0], ""], dao.address], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).deployed() as SourceDaoCommittee;

        // Setup Committee Contract Address into Master Contract
        console.log("Set committee address to main...");
        await (await dao.setCommitteeAddress(committee.address)).wait();
    }

    if (await dao.token() == ethers.constants.AddressZero) {
        // Deploying the Token contract
        console.log("Deploying token contract...");
        const token = await (await upgrades.deployProxy(tokenFactory, [
            ethers.utils.parseEther("10000000000"), [signers[0], ""], [ethers.utils.parseEther("10000"), ethers.utils.parseEther("10000")], dao.address
        ], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).deployed() as SourceDaoToken;

        // Setup Token Contract Address into Master Contract
        console.log("Set token address to main...");
        await (await dao.setTokenAddress(token.address)).wait();
    }

    if (await dao.lockup() == ethers.constants.AddressZero) {
        // Deploying the TokenLockup contract
        console.log("Deploying token lockup contract...");
        const tokenlockup = await (await upgrades.deployProxy(tokenlockupFactory, [dao.address], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).deployed() as SourceTokenLockup;

        console.log("Set committee address to main...");
        await (await dao.setTokenLockupAddress(tokenlockup.address)).wait();
    }

    if (await dao.devGroup() == ethers.constants.AddressZero) {
        // Deploying the ProjectManagement contract
        console.log("Deploying project contract...");
        const project = await (await upgrades.deployProxy(projectFactory, [dao.address], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).deployed() as ProjectManagement;

        // Setup ProjectManagement(Dev) Contract Address into Master Contract
        console.log("Set project address to main...");
        await (await dao.setDevAddress(project.address)).wait();
    }

    if (await dao.dividend() == ethers.constants.AddressZero) {
        // Deploying the TokenDividend contract
        console.log("Deploying token devidend contract...");
        const tokenDividend = await (await upgrades.deployProxy(tokenDividendFactory, [dao.address], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).deployed() as DividendContract;

        // Setup TokenDividend Contract Address into Master Contract
        console.log("Set token dividend address to main...");
        await (await dao.setTokenDividendAddress(tokenDividend.address)).wait();
    }

    if (await dao.investment() == ethers.constants.AddressZero) {
        // Deploying the Investment contract
        console.log("Deploying investment contract...");
        const investment = await (await upgrades.deployProxy(investmentFactory, [dao.address], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).deployed() as Investment;

        // Setup Investment Contract Address into Master Contract
        console.log("Set investment address to main...");
        await (await dao.setInvestmentAddress(investment.address)).wait();
    }

    if (await dao.twostepInvestment() == ethers.constants.AddressZero) {
        console.log("Deploying two step investment contract...");
        const twostep = await (await upgrades.deployProxy(twoStepInvestmentFactory, [dao.address], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).deployed() as TwoStepWhitelistInvestment;

        console.log("Set two step investment address to main...");
        await (await dao.setTwoStepInvestmentAddress(twostep.address)).wait();
    }

    if (await dao.marketing() == ethers.constants.AddressZero) {
        // Deploying the Income contract
        console.log("Deploying marketing contract...");
        const marketing = await (await upgrades.deployProxy(marketingFactory, [dao.address], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).deployed() as MarketingContract;

        // Setup Marketing Contract Address into Master Contract
        console.log("Set marketing address to main...");
        await (await dao.setMarketingAddress(marketing.address)).wait();
    }

    if (await dao.assetWallet() == ethers.constants.AddressZero) {
        // Deploying the MultiSigWallet contract
        console.log("Deploying asset wallet contract...");
        const assetWallet = await (await upgrades.deployProxy(multiWalletFactory, ["asset", dao.address], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).deployed() as MultiSigWallet;

        // Setup Asset Wallet Address into Master Contract
        console.log("Set asset address to main...");
        await (await dao.setAssetWallet(assetWallet.address, 0)).wait();

    }

    if (await dao.incomeWallet() == ethers.constants.AddressZero) {
        // Deploying the Income contract
        console.log("Deploying asset income contract...");
        const incomeWallet = await (await upgrades.deployProxy(multiWalletFactory, ["income", dao.address], {
            initializer: 'initialize',
            kind: "uups",
            timeout: 0
        })).deployed() as MultiSigWallet;

        // Setup Income wallet Address into Master Contract
        console.log("Set income address to main...");
        await (await dao.setIncomeWallet(incomeWallet.address, 0)).wait();

    }
    // After all contracts are deployed, perform the following steps:
    // Display all the contract addresses
    console.log("depolyed main contract address:", dao.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});