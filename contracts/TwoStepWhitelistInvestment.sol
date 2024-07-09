// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./SourceDaoUpgradeable.sol";
import "./Interface.sol";

import "hardhat/console.sol";

contract TwoStepWhitelistInvestment is ITwoStepWhitelistInvestment, ReentrancyGuardUpgradeable, SourceDaoContractUpgradeable {
    struct Investment {
        bool canEndEarly;
        bool end;
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

    mapping (uint256 => Investment) investments;

    uint256 investmentCount;

    event InvestmentStart(uint256 indexed investmentId, address indexed investor, address[] whitelist, uint8[] amounts);
    event InvestmentEnd(uint256 indexed investmentId, address indexed investor);
    event Invest(uint256 indexed investmentId, address indexed people, uint256 daoAmount, uint256 tokenAmount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _mainContractAddress) public initializer {
        __SourceDaoContractUpgradable_init(_mainContractAddress);
        __ReentrancyGuard_init();

        investmentCount = 1;
    }

    function startInvestment(startInvestmentParam calldata param) external payable nonReentrant {
        require(param.whitelist.length == param.firstPercent.length, "whitelist and firstPercent length not equal");
        require(param.tokenAddress != address(getMainContractAddress().token()), "cannot invest dao token");
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
        investments[investmentCount].canEndEarly = param.canEndEarly;
        for (uint i = 0; i < param.whitelist.length; i++) {
            investments[investmentCount].firstPercents[param.whitelist[i]] = param.firstPercent[i];
        }

        emit InvestmentStart(investmentCount, msg.sender, param.whitelist, param.firstPercent);
        investmentCount++;
    }

    function endInventment(uint256 investmentId) external nonReentrant {
        Investment storage investment = investments[investmentId];

        require(msg.sender == investment.investor, "only investor can end investment");
        if (!investment.canEndEarly && block.timestamp < investment.step2EndTime) {
            // if all token sold out but not pass step2EndTime, end investment
            require(investment.investedAmount == 0 || investment.totalAmount == investment.investedAmount, "not all token sold out");
        }

        getMainContractAddress().token().transfer(investment.investor, investment.daoTokenAmount);
        uint256 remainAmount = investment.totalAmount - investment.investedAmount;
        if (remainAmount > 0) {
            if (investment.tokenAddress == address(0)) {
                payable(investment.investor).transfer(remainAmount);
            } else {
                IERC20(investment.tokenAddress).transfer(investment.investor, remainAmount);
            }
        }

        //delete investments[investmentId];
        investment.end = true;

        emit InvestmentEnd(investmentId, msg.sender);
    }

    function invest(uint256 investmentId, uint256 amount) external nonReentrant {
        Investment storage investment = investments[investmentId];
        require(investment.investor != address(0), "investment not exist");
        require(investment.firstPercents[msg.sender] > 0, "not in whitelist");
        require(investment.end == false, "investment end");
        require(block.timestamp <= investment.step2EndTime, "investment end");

        uint256 tokenAmount = amount * investment.tokenRatio.tokenAmount / investment.tokenRatio.daoTokenAmount;
        require(tokenAmount > 0, "invalid amount");
        require(investment.totalAmount - investment.investedAmount >= tokenAmount, "not enough token");

        if (block.timestamp < investment.step1EndTime) {
            // still in step 1, check limit first.
            uint256 limit = investment.totalAmount * investment.firstPercents[msg.sender] / 100;
            require(limit - investment.investedAmounts[msg.sender] >= tokenAmount, "over limit");
        }
        // in step 2, only need to check enough token

        getMainContractAddress().token().transferFrom(msg.sender, address(this), amount);

        investment.investedAmounts[msg.sender] += tokenAmount;
        investment.investedAmount += tokenAmount;
        investment.daoTokenAmount += amount;

        if (investment.tokenAddress == address(0)) {
            payable(msg.sender).transfer(tokenAmount);
        } else {
            IERC20(investment.tokenAddress).transfer(msg.sender, tokenAmount);
        }

        emit Invest(investmentId, msg.sender, amount, tokenAmount);
    }

    function getInvestmentInfo(uint256 investmentId) external view returns (InvestmentInfo memory) {
        Investment storage investment = investments[investmentId];
        return InvestmentInfo(
            investment.investor,
            investment.tokenAddress,
            investment.tokenRatio,
            investment.totalAmount,
            investment.investedAmount,
            investment.daoTokenAmount,
            investment.step1EndTime,
            investment.step2EndTime,
            investment.canEndEarly
        );
    }

    function isInWhiteList(uint256 investmentId, address addr) external view returns (bool) {
        return investments[investmentId].firstPercents[addr] > 0;
    }

    function getAddressPercent(uint256 investmentId, address addr) external view returns (uint256) {
        return investments[investmentId].firstPercents[addr];
    }

    function getAddressInvestedAmount(uint256 investmentId, address addr) external view returns (uint256) {
        return investments[investmentId].investedAmounts[addr];
    }

    // if investment not exists or not in step1, return 0
    function getAddressLeftAmount(uint256 investmentId, address addr) external view returns (uint256) {
        Investment storage investment = investments[investmentId];
        if (block.timestamp > investment.step1EndTime) {
            return 0;
        }
        uint256 selfTotalAmount = investment.totalAmount * investment.firstPercents[addr] / 100;
        return selfTotalAmount - investment.investedAmounts[addr];
    }
}