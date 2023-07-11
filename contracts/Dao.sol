// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./SourceDaoUpgradeable.sol";
import "./Interface.sol";

contract SourceDao is ISourceDao, SourceDaoContractUpgradeable {
    address tokenAddress;
    address tokenLockup;
    address committeeAddress;
    address devAddress;
    address investmentAddress;
    address committeeWalletAddress;
    address assetWalletAddress;
    address incomeWalletAddress;

    function initialize() public initializer {
        __SourceDaoContractUpgradable_init();
    }

    function setTokenAddress(
        address newAddress
    ) external onlySetOnce(tokenAddress) {
        tokenAddress = newAddress;
    }

    function setCommitteeAddress(
        address newAddress
    ) external onlySetOnce(committeeAddress) {
        committeeAddress = newAddress;
    }

    function setDevAddress(
        address newAddress
    ) external onlySetOnce(devAddress) {
        devAddress = newAddress;
    }

    function setTokenLockupAddress(
        address newAddress
    ) external onlySetOnce(tokenLockup) {
        tokenLockup = newAddress;
    }

    function setInvestmentAddress(
        address newAddress
    ) external onlySetOnce(investmentAddress) {
        investmentAddress = newAddress;
    }

    function token() external view override returns (ISourceDAOToken) {
        return ISourceDAOToken(tokenAddress);
    }

    function committee() external view override returns (ISourceDaoCommittee) {
        return ISourceDaoCommittee(committeeAddress);
    }

    function devGroup() external view override returns (ISourceDevGroup) {
        return ISourceDevGroup(devAddress);
    }

    function lockup() external view override returns (ISourceTokenLockup) {
        return ISourceTokenLockup(tokenLockup);
    }

    function investment() external view override returns (IInvestment) {
        return IInvestment(investmentAddress);
    }

    function isAuthorizedAddress(
        address addr
    ) external view override returns (bool) {
        return
            addr == tokenAddress ||
            addr == tokenLockup ||
            addr == devAddress ||
            addr == committeeAddress ||
            addr == investmentAddress;
    }

    function committeeWallet() external view override returns (address) {
        return committeeWalletAddress;
    }

    function assetWallet() external view override returns (IMultiSigWallet) {
        return IMultiSigWallet(assetWalletAddress);
    }

    function incomeWallet() external view override returns (IMultiSigWallet) {
        return IMultiSigWallet(incomeWalletAddress);
    }

    function _makeSetAddressParams(address addr, bytes32 name) internal pure returns (bytes32[] memory) {
        bytes32[] memory params = new bytes32[](2);
        params[0] = bytes32(bytes20(addr));
        params[1] = name;

        return params;
    }

    function perpareSetCommitteeWallet(address walletAddress) external {
        require(ISourceDaoCommittee(committeeAddress).isMember(msg.sender), "only member can set wallet");
        bytes32[] memory params = _makeSetAddressParams(walletAddress, "committee");
        ISourceDaoCommittee(committeeAddress).propose(7 days, params);
    }

    function setCommitteeWallet(
        address walletAddress,
        uint proposalId
    ) external override {
        if (committeeWalletAddress == address(0)) {
            committeeWalletAddress = walletAddress;
        } else {
            bytes32[] memory params = _makeSetAddressParams(walletAddress, "committee");
            require(ISourceDaoCommittee(committeeAddress).takeResult(proposalId, params) == ISourceDaoCommittee.ProposalResult.Accept, "not accept");
            committeeWalletAddress = walletAddress;
            ISourceDaoCommittee(committeeAddress).setProposalExecuted(proposalId);
        }
    }

    function perpareSetAssetWallet(address walletAddress) external {
        require(ISourceDaoCommittee(committeeAddress).isMember(msg.sender), "only member can set wallet");
        bytes32[] memory params = _makeSetAddressParams(walletAddress, "asset");
        ISourceDaoCommittee(committeeAddress).propose(7 days, params);
    }

    function setAssetWallet(
        address walletAddress,
        uint proposalId
    ) external override {
        if (assetWalletAddress == address(0)) {
            assetWalletAddress = walletAddress;
        } else {
            bytes32[] memory params = _makeSetAddressParams(walletAddress, "asset");
            require(ISourceDaoCommittee(committeeAddress).takeResult(proposalId, params) == ISourceDaoCommittee.ProposalResult.Accept, "not accept");
            assetWalletAddress = walletAddress;
            ISourceDaoCommittee(committeeAddress).setProposalExecuted(proposalId);
        }
    }

    function perpareSetIncomeWallet(address walletAddress) external {
        require(ISourceDaoCommittee(committeeAddress).isMember(msg.sender), "only member can set wallet");
        bytes32[] memory params = _makeSetAddressParams(walletAddress, "income");
        ISourceDaoCommittee(committeeAddress).propose(7 days, params);
    }

    function setIncomeWallet(
        address walletAddress,
        uint proposalId
    ) external override {
        if (incomeWalletAddress == address(0)) {
            incomeWalletAddress = walletAddress;
        } else {
            bytes32[] memory params = _makeSetAddressParams(walletAddress, "income");
            require(ISourceDaoCommittee(committeeAddress).takeResult(proposalId, params) == ISourceDaoCommittee.ProposalResult.Accept, "not accept");
            incomeWalletAddress = walletAddress;
            ISourceDaoCommittee(committeeAddress).setProposalExecuted(proposalId);
        }
    }
} 