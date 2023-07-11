// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor(uint256 _totalSupply) ERC20("TestToken", "TT"){
        _mint(msg.sender, _totalSupply);
    }
}
