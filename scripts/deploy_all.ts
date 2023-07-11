import { ethers, upgrades } from "hardhat";
import { SourceDao, SourceDaoCommittee, SourceDaoToken, Investment, MultiSigWallet, ProjectManagement } from "../typechain-types";

async function main() {
    // 部署主合约
    const daoFactory = await ethers.getContractFactory('SourceDao')

    const dao = await (await upgrades.deployProxy(daoFactory, undefined, {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDao;

    // 部署委员会合约
    const committeeFactory = await ethers.getContractFactory('SourceDaoCommittee')
    // 准备初始委员
    const committees = ["0xF481382d745581F0129979CD6766C834c5530594", "0x6F07f9bCEcaB1AA2EDBAD8308f5Df5E8468fC852", "0xF21DF293B951207dDb773Fb0774e001fBDdB40Db"];
    const committee = await (await upgrades.deployProxy(committeeFactory, [committees], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDaoCommittee;

    // 部署Token合约
    const tokenFactory = await ethers.getContractFactory('SourceDaoToken')
    const token = await (await upgrades.deployProxy(tokenFactory, ["2100000000"], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDaoToken;

    // 部署TokenLock合约
    const tokenlockupFactory = await ethers.getContractFactory('SourceTokenLockup')
    const tokenlockup = await (await upgrades.deployProxy(tokenlockupFactory, undefined, {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as SourceDaoToken;

    // 部署项目合约
    const projectFactory = await ethers.getContractFactory('ProjectManagement')
    const project = await (await upgrades.deployProxy(projectFactory, undefined, {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as ProjectManagement;

    // 部署投资合约
    const investmentFactory = await ethers.getContractFactory('Investment')
    const investment = await (await upgrades.deployProxy(investmentFactory, undefined, {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as Investment;

    // 部署资产钱包合约
    const multiWalletFactory = await ethers.getContractFactory('MultiSigWallet')
    const assetWallet = await (await upgrades.deployProxy(multiWalletFactory, ["asset"], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as MultiSigWallet;

    // 部署收入钱包合约
    const incomeWallet = await (await upgrades.deployProxy(multiWalletFactory, ["income"], {
        initializer: 'initialize',
        kind: "uups"
    })).deployed() as MultiSigWallet;

    // 所有合约都部署完成后，执行下列步骤：

    // 主合约设置委员会合约地址
    await (await dao.setCommitteeAddress(committee.address)).wait();

    // 主合约设置Token合约地址
    await (await dao.setTokenAddress(token.address)).wait();

    // 主合约设置项目合约地址
    await (await dao.setDevAddress(project.address)).wait();

    // 主合约设置TokenLockup合约地址
    await (await dao.setTokenLockupAddress(tokenlockup.address)).wait();

    // 主合约设置投资合约地址
    await (await dao.setInvestmentAddress(investment.address)).wait();

    // 主合约设置资产钱包地址
    await (await dao.setAssetWallet(assetWallet.address, 0)).wait();

    // 主合约设置收入钱包地址
    await (await dao.setIncomeWallet(incomeWallet.address, 0)).wait();

    // 委员会合约设置主合约地址
    await (await committee.setMainContractAddress(dao.address)).wait();
    // token合约设置主合约地址
    await (await token.setMainContractAddress(dao.address)).wait();
    // 项目合约设置主合约地址
    await (await project.setMainContractAddress(dao.address)).wait();
    // TokenLockup合约设置主合约地址
    await (await tokenlockup.setMainContractAddress(dao.address)).wait();
    // 投资合约设置主合约地址
    await (await investment.setMainContractAddress(dao.address)).wait();
    // 资产钱包设置主合约地址
    await (await assetWallet.setMainContractAddress(dao.address)).wait();
    // 收入钱包设置主合约地址
    await (await incomeWallet.setMainContractAddress(dao.address)).wait();

    // 打印各个合约的地址
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