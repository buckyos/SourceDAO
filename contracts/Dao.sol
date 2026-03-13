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
    bool public bootstrapFinalized;

    function initialize() public initializer {
        __SourceDaoContractUpgradable_init(address(this));
        bootstrapAdmin = msg.sender;
        bootstrapFinalized = false;
    }

    modifier onlyBootstrapAdmin() {
        require(msg.sender == bootstrapAdmin, "only bootstrap admin");
        _;
    }

    modifier onlyBeforeBootstrapFinalized() {
        require(!bootstrapFinalized, "bootstrap finalized");
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

    function finalizeInitialization() external onlyBeforeBootstrapFinalized onlyBootstrapAdmin {
        require(_allModulesConfigured(), "modules not configured");
        bootstrapFinalized = true;
    }

    function setDevTokenAddress(
        address newAddress
    ) external onlyBeforeBootstrapFinalized onlyBootstrapAdmin {
        _requireValidAddress(newAddress);
        _devToken = newAddress;
    }

    function setNormalTokenAddress(
        address newAddress
    ) external onlyBeforeBootstrapFinalized onlyBootstrapAdmin {
        _requireValidAddress(newAddress);
        _normalToken = newAddress;
    }

    function setCommitteeAddress(
        address newAddress
    ) external onlyBeforeBootstrapFinalized onlyBootstrapAdmin {
        _requireValidAddress(newAddress);
        _committee = newAddress;
    }

    function setProjectAddress(
        address newAddress
    ) external onlyBeforeBootstrapFinalized onlyBootstrapAdmin {
        _requireValidAddress(newAddress);
        _project = newAddress;
    }

    function setTokenLockupAddress(
        address newAddress
    ) external onlyBeforeBootstrapFinalized onlyBootstrapAdmin {
        _requireValidAddress(newAddress);
        _tokenLockup = newAddress;
    }

    function setTokenDividendAddress(
        address newAddress
    ) external onlyBeforeBootstrapFinalized onlyBootstrapAdmin {
        _requireValidAddress(newAddress);
        _tokenDividend = newAddress;
    }

    function setAcquiredAddress(
        address newAddress
    ) external onlyBeforeBootstrapFinalized onlyBootstrapAdmin {
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
