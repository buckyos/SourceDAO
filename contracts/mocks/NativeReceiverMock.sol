// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../Interface.sol";

contract NativeReceiverMock {
    uint256 public receiveCount;
    uint256 public totalReceived;

    receive() external payable {
        receiveCount += 1;
        totalReceived += msg.value;
    }

    function approveToken(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }

    function startNativeInvestment(address acquired, IAcquired.startInvestmentParam calldata param) external payable {
        IAcquired(acquired).startInvestment{value: msg.value}(param);
    }

    function endInvestment(address acquired, uint256 investmentId) external {
        IAcquired(acquired).endInvestment(investmentId);
    }

    function invest(address acquired, uint256 investmentId, uint256 amount) external {
        IAcquired(acquired).invest(investmentId, amount);
    }

    function stakeNormal(address dividend, uint256 amount) external {
        ISourceDAODividend(payable(dividend)).stakeNormal(amount);
    }

    function withdrawDividends(address dividend, uint256[] calldata cycleIndexs, address[] calldata tokens) external {
        ISourceDAODividend(payable(dividend)).withdrawDividends(cycleIndexs, tokens);
    }
}