// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ConfigurableReturnToken is ERC20 {
    bool public failTransfer;
    bool public failTransferFrom;

    constructor(uint256 initialSupply, address initialHolder) ERC20("ConfigurableReturnToken", "CRT") {
        _mint(initialHolder, initialSupply);
    }

    function setFailTransfer(bool value) external {
        failTransfer = value;
    }

    function setFailTransferFrom(bool value) external {
        failTransferFrom = value;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failTransfer) {
            return false;
        }
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (failTransferFrom) {
            return false;
        }
        return super.transferFrom(from, to, amount);
    }
}