// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FalseReturnToken is ERC20 {
    constructor(uint256 initialSupply, address initialHolder) ERC20("FalseReturnToken", "FRT") {
        _mint(initialHolder, initialSupply);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}