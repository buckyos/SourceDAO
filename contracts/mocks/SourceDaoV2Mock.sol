// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../Dao.sol";

contract SourceDaoV2Mock is SourceDao {
    function version() external pure override returns (string memory) {
        return "2.1.0";
    }
}