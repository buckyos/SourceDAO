// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../Interface.sol";

contract ReentrantNativeReceiverMock {
    uint256 public receiveCount;
    uint256 public totalReceived;
    uint256 public reentryAttempts;
    uint256 public successfulReentries;
    bool public rejectReceive;

    address public reentryTarget;
    bytes public reentryData;
    bool private _entered;

    receive() external payable {
        require(!rejectReceive, "receive rejected");

        receiveCount += 1;
        totalReceived += msg.value;

        if (!_entered && reentryTarget != address(0) && reentryData.length > 0) {
            _entered = true;
            reentryAttempts += 1;

            (bool success, ) = reentryTarget.call(reentryData);
            if (success) {
                successfulReentries += 1;
            }

            _entered = false;
        }
    }

    function setRejectReceive(bool shouldReject) external {
        rejectReceive = shouldReject;
    }

    function configureReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryData = data;
    }

    function clearReentry() external {
        reentryTarget = address(0);
        delete reentryData;
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
