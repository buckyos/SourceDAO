// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../Committee.sol";

contract SourceDaoCommitteeV2InitMock is SourceDaoCommittee {
    uint256 public upgradeMarker;

    function initializeMarker(uint256 newMarker) external reinitializer(2) {
        upgradeMarker = newMarker;
    }

    function version() external pure override returns (string memory) {
        return "2.1.1";
    }
}
