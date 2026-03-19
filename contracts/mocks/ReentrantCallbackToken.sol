// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ReentrantCallbackToken is ERC20 {
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackOnTransfer;
    bool public callbackOnTransferFrom;
    uint256 public callbackAttempts;
    uint256 public callbackSuccesses;

    bool private _inCallback;

    constructor(uint256 initialSupply, address initialHolder) ERC20("ReentrantCallbackToken", "RCT") {
        _mint(initialHolder, initialSupply);
    }

    function configureCallback(
        address target,
        bytes calldata data,
        bool onTransfer,
        bool onTransferFrom
    ) external {
        callbackTarget = target;
        callbackData = data;
        callbackOnTransfer = onTransfer;
        callbackOnTransferFrom = onTransferFrom;
    }

    function clearCallback() external {
        callbackTarget = address(0);
        delete callbackData;
        callbackOnTransfer = false;
        callbackOnTransferFrom = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool success = super.transfer(to, amount);
        _attemptCallback(callbackOnTransfer);
        return success;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool success = super.transferFrom(from, to, amount);
        _attemptCallback(callbackOnTransferFrom);
        return success;
    }

    function _attemptCallback(bool enabled) internal {
        if (!enabled || _inCallback || callbackTarget == address(0) || callbackData.length == 0) {
            return;
        }

        _inCallback = true;
        callbackAttempts += 1;

        (bool success, ) = callbackTarget.call(callbackData);
        if (success) {
            callbackSuccesses += 1;
        }

        _inCallback = false;
    }
}
