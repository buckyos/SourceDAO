// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./SourceDaoUpgradeable.sol";
import "./Interface.sol";
import "./util.sol";

contract SourceDao is ISourceDao, SourceDaoContractUpgradeable {
    address _devToken;
    address _normalToken;
    address _tokenLockup;
    address _committee;
    address _project;
    address _tokenDividend;
    address _acquired;

    function initialize() public initializer {
        __SourceDaoContractUpgradable_init(address(0));
    }

    function version() external pure override returns (string memory) {
        return "2.0.0";
    }

    function setDevTokenAddress(
        address newAddress
    ) external onlySetOnce(_devToken) {
        _devToken = newAddress;
    }

    function setNormalTokenAddress(
        address newAddress
    ) external onlySetOnce(_normalToken) {
        _normalToken = newAddress;
    }

    function setCommitteeAddress(
        address newAddress
    ) external onlySetOnce(_committee) {
        _committee = newAddress;
    }

    function setProjectAddress(
        address newAddress
    ) external onlySetOnce(_project) {
        _project = newAddress;
    }

    function setTokenLockupAddress(
        address newAddress
    ) external onlySetOnce(_tokenLockup) {
        _tokenLockup = newAddress;
    }

    function setTokenDividendAddress(
        address newAddress
    ) external onlySetOnce(_tokenDividend) {
        _tokenDividend = newAddress;
    }

    function setAcquiredAddress(
        address newAddress
    ) external onlySetOnce(_acquired) {
        _acquired = newAddress;
    }

    function devToken() external view override returns (ISourceDAODevToken) {
        return ISourceDAODevToken(_devToken);
    }

    function normalToken() external view override returns (ISourceDAONormalToken) {
        return ISourceDAONormalToken(_normalToken);
    }

    function committee() external view override returns (ISourceDaoCommittee) {
        return ISourceDaoCommittee(_committee);
    }

    function project() external view override returns (ISourceProject) {
        return ISourceProject(_project);
    }

    function lockup() external view override returns (ISourceTokenLockup) {
        return ISourceTokenLockup(_tokenLockup);
    }

    function dividend() external view returns (ISourceDAODividend) {
        return ISourceDAODividend(payable(_tokenDividend));
    }

    function acquired() external view returns (IAcquired) {
        return IAcquired(_acquired);
    }
} 