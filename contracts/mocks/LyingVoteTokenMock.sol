// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../Interface.sol";

contract LyingNormalTokenMock is ISourceDAONormalToken {
    mapping(address => uint256) private _balances;
    uint256 private _totalSupply;

    function setBalance(address account, uint256 amount) external {
        _balances[account] = amount;
    }

    function setTotalSupply(uint256 amount) external {
        _totalSupply = amount;
    }

    function name() external pure returns (string memory) {
        return "LyingNormal";
    }

    function symbol() external pure returns (string memory) {
        return "LNT";
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function allowance(address, address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return true;
    }

    function mintNormalToken(address to, uint256 amount) external {
        _balances[to] += amount;
        _totalSupply += amount;
    }
}

contract LyingDevTokenMock is ISourceDAODevToken {
    mapping(address => uint256) private _balances;
    uint256 private _totalSupply;
    uint256 private _totalReleased;

    function setBalance(address account, uint256 amount) external {
        _balances[account] = amount;
    }

    function setTotalSupply(uint256 amount) external {
        _totalSupply = amount;
    }

    function setTotalReleased(uint256 amount) external {
        _totalReleased = amount;
    }

    function name() external pure returns (string memory) {
        return "LyingDev";
    }

    function symbol() external pure returns (string memory) {
        return "LDT";
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function allowance(address, address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return true;
    }

    function mintDevToken(uint256 amount) external {
        _balances[msg.sender] += amount;
        _totalSupply += amount;
        _totalReleased += amount;
    }

    function totalReleased() external view returns (uint256) {
        return _totalReleased;
    }

    function dev2normal(uint256 amount) external {
        require(_balances[msg.sender] >= amount, "insufficient dev balance");
        _balances[msg.sender] -= amount;
        _totalReleased -= amount;
    }
}
