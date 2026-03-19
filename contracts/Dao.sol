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

    address public bootstrapAdmin;

    function initialize() public initializer {
        __SourceDaoContractUpgradable_init(address(this));
        bootstrapAdmin = msg.sender;
    }

    modifier onlyBootstrapAdmin() {
        require(msg.sender == bootstrapAdmin, "only bootstrap admin");
        _;
    }

    function _requireValidAddress(address newAddress) internal view {
        require(newAddress != address(0) && newAddress.code.length > 0, "invalid address");
    }

    function _allModulesConfigured() internal view returns (bool) {
        return
            _devToken != address(0) &&
            _normalToken != address(0) &&
            _committee != address(0) &&
            _project != address(0) &&
            _tokenLockup != address(0) &&
            _tokenDividend != address(0) &&
            _acquired != address(0);
    }

    function version() external pure virtual override returns (string memory) {
        return "2.0.0";
    }

    function transferBootstrapAdmin(address newBootstrapAdmin) external onlyBootstrapAdmin {
        require(newBootstrapAdmin != address(0), "invalid bootstrap admin");
        bootstrapAdmin = newBootstrapAdmin;
    }

    /// @notice Initializes bootstrap admin for proxies upgraded from the published pre-bootstrap implementation.
    function migrateBootstrapAdmin(address newBootstrapAdmin) external reinitializer(2) {
        require(bootstrapAdmin == address(0), "bootstrap admin initialized");
        require(newBootstrapAdmin != address(0), "invalid bootstrap admin");
        bootstrapAdmin = newBootstrapAdmin;
    }

    function setDevTokenAddress(
        address newAddress
    ) external onlyBootstrapAdmin onlySetOnce(_devToken) {
        _requireValidAddress(newAddress);
        _devToken = newAddress;
    }

    function setNormalTokenAddress(
        address newAddress
    ) external onlyBootstrapAdmin onlySetOnce(_normalToken) {
        _requireValidAddress(newAddress);
        _normalToken = newAddress;
    }

    function setCommitteeAddress(
        address newAddress
    ) external onlyBootstrapAdmin onlySetOnce(_committee) {
        _requireValidAddress(newAddress);
        _committee = newAddress;
    }

    function setProjectAddress(
        address newAddress
    ) external onlyBootstrapAdmin onlySetOnce(_project) {
        _requireValidAddress(newAddress);
        _project = newAddress;
    }

    function setTokenLockupAddress(
        address newAddress
    ) external onlyBootstrapAdmin onlySetOnce(_tokenLockup) {
        _requireValidAddress(newAddress);
        _tokenLockup = newAddress;
    }

    function setTokenDividendAddress(
        address newAddress
    ) external onlyBootstrapAdmin onlySetOnce(_tokenDividend) {
        _requireValidAddress(newAddress);
        _tokenDividend = newAddress;
    }

    function setAcquiredAddress(
        address newAddress
    ) external onlyBootstrapAdmin onlySetOnce(_acquired) {
        _requireValidAddress(newAddress);
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

    function isDAOContract(address addr) external view returns (bool) {
        return
            addr == _devToken ||
            addr == _normalToken ||
            addr == _committee ||
            addr == _project ||
            addr == _tokenLockup ||
            addr == _tokenDividend ||
            addr == _acquired ||
            addr == address(this);
    }
} 
