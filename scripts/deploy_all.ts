import { ethers, upgrades } from "hardhat";
import { SourceDao, SourceDaoCommittee, SourceDaoToken, Investment, MultiSigWallet, ProjectManagement } from "../typechain-types";

async function main() {
    // Deploying the master contract
    const daoFactory = await ethers.getContractFactory('SourceDao')

    const dao = await (await upgrades.deployProxy(daoFactory, undefined, {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDao;

    // Deploying committee contract
    const committeeFactory = await ethers.getContractFactory('SourceDaoCommittee');

    // Preparation of initial committee members
    const committees = ["0xF481382d745581F0129979CD6766C834c5530594", "0x6F07f9bCEcaB1AA2EDBAD8308f5Df5E8468fC852", "0xF21DF293B951207dDb773Fb0774e001fBDdB40Db"];
    const committee = await (await upgrades.deployProxy(committeeFactory, [committees], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDaoCommittee;

    // Deploying the Token contract
    const tokenFactory = await ethers.getContractFactory('SourceDaoToken')
    const token = await (await upgrades.deployProxy(tokenFactory, ["2100000000"], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDaoToken;

    // Deploying the TokenLockup contract
    const tokenlockupFactory = await ethers.getContractFactory('SourceTokenLockup')
    const tokenlockup = await (await upgrades.deployProxy(tokenlockupFactory, undefined, {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDaoToken;

    // Deploying the ProjectManagement contract
    const projectFactory = await ethers.getContractFactory('ProjectManagement')
    const project = await (await upgrades.deployProxy(projectFactory, undefined, {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as ProjectManagement;

    // Deploying the Investment contract
    const investmentFactory = await ethers.getContractFactory('Investment')
    const investment = await (await upgrades.deployProxy(investmentFactory, undefined, {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as Investment;

    // Deploying the MultiSigWallet contract
    const multiWalletFactory = await ethers.getContractFactory('MultiSigWallet')
    const assetWallet = await (await upgrades.deployProxy(multiWalletFactory, ["asset"], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as MultiSigWallet;

    // Deploying the Income contract
    const incomeWallet = await (await upgrades.deployProxy(multiWalletFactory, ["income"], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as MultiSigWallet;

    // After all contracts are deployed, perform the following steps:

    // Setup Committee Contract Address into Master Contract
    await (await dao.setCommitteeAddress(committee.address)).wait();

    // Setup Token Contract Address into Master Contract
    await (await dao.setTokenAddress(token.address)).wait();

    // Setup ProjectManagement(Dev) Contract Address into Master Contract
    await (await dao.setDevAddress(project.address)).wait();

    // Setup TokenLockup Contract Address into Master Contract
    await (await dao.setTokenLockupAddress(tokenlockup.address)).wait();

    // Setup Investment Contract Address into Master Contract
    await (await dao.setInvestmentAddress(investment.address)).wait();

    // Setup Asset Wallet Address into Master Contract
    await (await dao.setAssetWallet(assetWallet.address, 0)).wait();

    // Setup Income wallet Address into Master Contract
    await (await dao.setIncomeWallet(incomeWallet.address, 0)).wait();

    // Init Master Contract address for Committee Contract
    await (await committee.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for Token Contract
    await (await token.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for ProjectManagement Contract
    await (await project.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for TokenLockup Contract
    await (await tokenlockup.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for Investment Contract
    await (await investment.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for Asset MultiSigWallet Contract
    await (await assetWallet.setMainContractAddress(dao.address)).wait();

    // Init Master Contract address for InComeWallet Contract
    await (await incomeWallet.setMainContractAddress(dao.address)).wait();

    // Display all the contract addresses
    console.log("depolyed main contract address:", dao.address);
    console.log("depolyed committee contract address:", committee.address);
    console.log("depolyed token contract address:", token.address);
    console.log("depolyed project contract address:", project.address);
    console.log("depolyed tokenlockup contract address:", tokenlockup.address);
    console.log("depolyed investment contract address:", investment.address);
}


// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});