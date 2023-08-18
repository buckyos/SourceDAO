import { ethers, upgrades } from "hardhat";
import { SourceDao, SourceDaoCommittee, SourceDaoToken, Investment, MultiSigWallet, ProjectManagement } from "../typechain-types";

async function main() {
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

    // Deploying the master contract
    console.log("Deploying main contract...");
    const dao = await (await upgrades.deployProxy(daoFactory, undefined, {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDao;

    // Deploying committee contract
    console.log("Deploying committee contract...");
    // Preparation of initial committee members
    const committees = ["0xF481382d745581F0129979CD6766C834c5530594", "0x6F07f9bCEcaB1AA2EDBAD8308f5Df5E8468fC852", "0xF21DF293B951207dDb773Fb0774e001fBDdB40Db"];
    const committee = await (await upgrades.deployProxy(committeeFactory, [committees, dao.address], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDaoCommittee;

    // Deploying the Token contract
    console.log("Deploying token contract...");
    const token = await (await upgrades.deployProxy(tokenFactory, ["2100000000", dao.address], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDaoToken;

    // Deploying the TokenLockup contract
    console.log("Deploying token lockup contract...");
    const tokenlockup = await (await upgrades.deployProxy(tokenlockupFactory, [dao.address], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDaoToken;

    // Deploying the TokenDividend contract
    console.log("Deploying token devidend contract...");
    const tokenDividend = await (await upgrades.deployProxy(tokenDividendFactory, [dao.address], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDaoToken;

    // Deploying the ProjectManagement contract
    console.log("Deploying project contract...");
    const project = await (await upgrades.deployProxy(projectFactory, [dao.address], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as ProjectManagement;

    // Deploying the Investment contract
    console.log("Deploying investment contract...");
    const investment = await (await upgrades.deployProxy(investmentFactory, [dao.address], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as Investment;

    // Deploying the Income contract
    console.log("Deploying marketing contract...");
    const marketing = await (await upgrades.deployProxy(marketingFactory, [dao.address], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as MultiSigWallet;

    // Deploying the MultiSigWallet contract
    console.log("Deploying asset wallet contract...");
    const assetWallet = await (await upgrades.deployProxy(multiWalletFactory, ["asset", dao.address], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as MultiSigWallet;

    // Deploying the Income contract
    console.log("Deploying asset income contract...");
    const incomeWallet = await (await upgrades.deployProxy(multiWalletFactory, ["income", dao.address], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as MultiSigWallet;

    // After all contracts are deployed, perform the following steps:

    // Setup Committee Contract Address into Master Contract
    console.log("Set committee address to main...");
    await (await dao.setCommitteeAddress(committee.address)).wait();

    // Setup Token Contract Address into Master Contract
    console.log("Set token address to main...");
    await (await dao.setTokenAddress(token.address)).wait();

    // Setup ProjectManagement(Dev) Contract Address into Master Contract
    console.log("Set project address to main...");
    await (await dao.setDevAddress(project.address)).wait();

    // Setup TokenLockup Contract Address into Master Contract
    console.log("Set token lockup address to main...");
    await (await dao.setTokenLockupAddress(tokenlockup.address)).wait();

    // Setup TokenDividend Contract Address into Master Contract
    console.log("Set token dividend address to main...");
    await (await dao.setTokenDividendAddress(tokenDividend.address)).wait();

    // Setup Investment Contract Address into Master Contract
    console.log("Set investment address to main...");
    await (await dao.setInvestmentAddress(investment.address)).wait();

    // Setup Marketing Contract Address into Master Contract
    console.log("Set marketing address to main...");
    await (await dao.setMarketingAddress(marketing.address)).wait();

    // Setup Asset Wallet Address into Master Contract
    console.log("Set asset address to main...");
    await (await dao.setAssetWallet(assetWallet.address, 0)).wait();

    // Setup Income wallet Address into Master Contract
    console.log("Set income address to main...");
    await (await dao.setIncomeWallet(incomeWallet.address, 0)).wait();

    /*
    // Init Master Contract address for Committee Contract
    console.log("Set main address to committee...");
    await (await committee.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for Token Contract
    console.log("Set main address to token...");
    await (await token.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for ProjectManagement Contract
    console.log("Set main address to project...");
    await (await project.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for TokenLockup Contract
    console.log("Set main address to lockup...");
    await (await tokenlockup.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for TokenDividend Contract
    console.log("Set main address to dividend...");
    await (await tokenDividend.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for Investment Contract
    console.log("Set main address to investment...");
    await (await investment.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for Investment Contract
    console.log("Set main address to marketing...");
    await (await marketing.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for Asset MultiSigWallet Contract
    console.log("Set main address to asset...");
    await (await assetWallet.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for InComeWallet Contract
    console.log("Set main address to income...");
    await (await incomeWallet.setMainContractAddress(dao.address)).wait();
    */
    // Display all the contract addresses
    console.log("depolyed main contract address:", dao.address);
}


// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});