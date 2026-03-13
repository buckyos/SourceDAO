// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../SourceDaoUpgradeable.sol";

contract SourceDaoUpgradeableMock is SourceDaoContractUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address mainAddr) public initializer {
        __SourceDaoContractUpgradable_init(mainAddr);
    }

    function mainAddress() external view returns (address) {
        return address(getMainContractAddress());
    }

    function version() external pure override returns (string memory) {
        return "2.0.0";
    }
}