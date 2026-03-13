// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IDevTokenMint {
    function mintDevToken(uint256 amount) external;
}

contract TokenOperatorMock {
    function mintDevToken(address token, uint256 amount) external {
        IDevTokenMint(token).mintDevToken(amount);
    }

    function transferToken(address token, address to, uint256 amount) external {
        IERC20(token).transfer(to, amount);
    }
}
