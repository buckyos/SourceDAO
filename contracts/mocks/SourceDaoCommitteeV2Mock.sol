// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../Committee.sol";

contract SourceDaoCommitteeV2Mock is SourceDaoCommittee {
    function version() external pure override returns (string memory) {
        return "2.1.0";
    }
}