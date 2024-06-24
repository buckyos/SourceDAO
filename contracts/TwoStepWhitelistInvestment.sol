// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "./SourceDaoUpgradeable.sol";
import "./Interface.sol";

import "hardhat/console.sol";

contract TwoStepWhitelistInvestment is ReentrancyGuardUpgradeable, SourceDaoContractUpgradeable {
    struct startInvestmentParam {
        address[] whitelist;
        uint256[] firstPercent;
        address tokenAddress;
        uint256 tokenAmount;
        TokenRatio tokenRatio;
        uint256 step1Duration;
        uint256 step2Duration;
    }

    struct Investment {
        address investor;
        mapping(address => uint256) firstPercents;
        mapping(address => uint256) investedAmounts;
        address tokenAddress;
        TokenRatio tokenRatio;
        uint256 totalAmount;
        uint256 investedAmount;
        uint256 daoTokenAmount;
        uint256 step1EndTime;
        uint256 step2EndTime;
    }

    struct TokenRatio {
        uint256 tokenAmount;
        uint256 daoTokenAmount;
    }

    mapping (uint256 => Investment) investments;

    uint256 investmentCount;

    event InvestmentStart(uint256 indexed investmentId, address indexed investor, address tokenAddress, uint256 tokenAmount, TokenRatio tokenRatio, uint256 step1EndTime, uint256 step2EndTime);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _mainContractAddress) public initializer {
        __SourceDaoContractUpgradable_init(_mainContractAddress);
        __ReentrancyGuard_init();

        investmentCount = 1;
    }

    function startInvestment(startInvestmentParam calldata param) public payable nonReentrant {
        require(param.whitelist.length == param.firstPercent.length, "whitelist and firstPercent length not equal");
        uint256 totalPercents = 0;
        for (uint i = 0; i < param.firstPercent.length; i++) {
            totalPercents += param.firstPercent[i];
        }
        require(totalPercents <= 100, "total percents over 100");
        require(param.tokenAmount > 0, "invalid tokenAmount");
        require(param.tokenRatio.tokenAmount > 0 && param.tokenRatio.daoTokenAmount > 0, "invalid tokenRatio");

        if (param.tokenAddress == address(0)) {
            require(param.tokenAmount == msg.value, "main token not enough");
        } else {
            IERC20(param.tokenAddress).transferFrom(msg.sender, address(this), param.tokenAmount);
        }
        
        investments[investmentCount].investor = msg.sender;
        investments[investmentCount].tokenAddress = param.tokenAddress;
        investments[investmentCount].tokenRatio = param.tokenRatio;
        investments[investmentCount].totalAmount = param.tokenAmount;
        investments[investmentCount].step1EndTime = block.timestamp + param.step1Duration;
        investments[investmentCount].step2EndTime = block.timestamp + param.step1Duration + param.step2Duration;
        for (uint i = 0; i < param.whitelist.length; i++) {
            investments[investmentCount].firstPercents[param.whitelist[i]] = param.firstPercent[i];
        }

        emit InvestmentStart(investmentCount, msg.sender, param.tokenAddress, param.tokenAmount, param.tokenRatio, investments[investmentCount].step1EndTime, investments[investmentCount].step2EndTime);
        investmentCount++;
    }
    function endInventment(uint256 investmentId) public nonReentrant {
        Investment storage investment = investments[investmentId];

        require(msg.sender == investment.investor, "only investor can end investment");
        require(investment.step2EndTime < block.timestamp, "investment not end");

        getMainContractAddress().token().transfer(investment.investor, investment.daoTokenAmount);
        uint256 remainAmount = investment.totalAmount - investment.investedAmount;
        if (remainAmount > 0) {
            if (investment.tokenAddress == address(0)) {
                payable(investment.investor).transfer(remainAmount);
            } else {
                IERC20(investment.tokenAddress).transfer(investment.investor, remainAmount);
            }
        }

        delete investments[investmentId];
    }

    function invest(uint256 investmentId, uint256 amount) public nonReentrant {
        Investment storage investment = investments[investmentId];
        require(investment.investor != address(0), "investment not exist");
        require(investment.firstPercents[msg.sender] > 0, "not in whitelist");

        uint256 tokenAmount = amount * investment.tokenRatio.tokenAmount / investment.tokenRatio.daoTokenAmount;
        require(tokenAmount > 0, "invalid amount");
        require(investment.totalAmount - investment.investedAmount >= tokenAmount, "not enough token");

        if (block.timestamp > investment.step2EndTime) {
            revert("investment end");
        }

        if (block.timestamp < investment.step1EndTime) {
            uint256 limit = investment.totalAmount * investment.firstPercents[msg.sender] / 100;
            require(limit - investment.investedAmounts[msg.sender] >= tokenAmount, "over limit");
        }

        getMainContractAddress().token().transferFrom(msg.sender, address(this), amount);

        investment.investedAmounts[msg.sender] += tokenAmount;
        investment.investedAmount += tokenAmount;
        investment.daoTokenAmount += amount;

        if (investment.tokenAddress == address(0)) {
            payable(msg.sender).transfer(tokenAmount);
        } else {
            IERC20(investment.tokenAddress).transfer(msg.sender, tokenAmount);
        }

        
    }
}