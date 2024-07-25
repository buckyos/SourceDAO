// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

library util {
    function AddressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    function isExist(address[] memory arr, address addr) internal pure returns (bool) {
        for (uint i = 0; i < arr.length; i++) {
            if (arr[i] == addr) {
                return true;
            }
        }
        return false;
    }
}