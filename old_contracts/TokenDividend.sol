// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./Interface.sol";
import "./SourceDaoUpgradeable.sol";


contract DividendContract is ISourceDAOTokenDividend, SourceDaoContractUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    mapping(address => uint256) public tokenBalances;
    address[] public tokens;

    DividendState state;
    uint256 stateEnableBlockNumber;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();

        state = DividendState.Disable;
        stateEnableBlockNumber = 0;
    }

    function initialize(address mainAddr) public initializer {
        __SourceDaoContractUpgradable_init(mainAddr);
        __ReentrancyGuard_init();
    }

    function isTokenInList(address token) private view returns (bool) {
        for(uint256 i = 0; i < tokens.length; i++) {
            if(tokens[i] == token) {
                return true;
            }
        }

        return false;
    }

    receive() external payable {
        if (!isTokenInList(address(0))) {
            tokens.push(address(0));
        }
        tokenBalances[address(0)] += msg.value;
    }

    function deposit(uint256 amount, address token) external override nonReentrant {
        require(token != address(getMainContractAddress().token()), "Cannot deposit Source token");
        require(token != address(0), "Use native transfer to deposit ETH");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        if (!isTokenInList(token)) {
            tokens.push(token);
        }

        tokenBalances[token] += amount;

        emit Deposit(amount, token);
    }

    function updateTokenBalance(address token) external override nonReentrant {
        require(token != address(getMainContractAddress().token()), "Cannot update Source token");
  
        if (!isTokenInList(token)) {
            tokens.push(token);
        }

        uint256 balance;
        if (token == address(0)) {
            // If the token address is 0, return the ETH balance of the contract
            balance = address(this).balance;
        } else {
            // If the token address is not 0, return the ERC20 token balance of the contract
            balance = IERC20(token).balanceOf(address(this));
        }

        tokenBalances[token] = balance;
    }

    function estimate() external view override returns (address[] memory, uint256[] memory) {
        ISourceDAOToken SourceDAOToken = getMainContractAddress().token();
        uint256 totalSupply = SourceDAOToken.totalInCirculation();
        require(totalSupply > 0, "Not enough tokens in circulation");

        uint256 userBalance = SourceDAOToken.balanceOf(msg.sender);

        address[] memory estimateTokens = new address[](tokens.length);
        uint256[] memory estimateAmounts = new uint256[](tokens.length);

        for (uint i = 0; i < tokens.length; i++) {
            estimateTokens[i] = tokens[i];
            estimateAmounts[i] = tokenBalances[tokens[i]] * userBalance / totalSupply;
        }

        return (estimateTokens, estimateAmounts);
    }

    function withdraw(uint256 sourceAmount) external override nonReentrant {
        require(isDividendEnable());

        ISourceDAOToken SourceDAOToken = getMainContractAddress().token();
        uint256 totalSupply = SourceDAOToken.totalInCirculation();
        require(totalSupply > 0, "Not enough tokens in circulation");

        require(SourceDAOToken.balanceOf(msg.sender) >= sourceAmount, "Not enough Source tokens");
        SourceDAOToken.transferFrom(msg.sender, address(this), sourceAmount);

        for (uint i = 0; i < tokens.length; i++) {
            uint256 claimableAmount = tokenBalances[tokens[i]] * sourceAmount / totalSupply;

            if (claimableAmount > 0) {
                require(tokenBalances[tokens[i]] >= claimableAmount, "Not enough tokens in the contract");

                tokenBalances[tokens[i]] -= claimableAmount;

                if (tokens[i] == address(0)) {
                    (bool sent, ) = msg.sender.call{value: claimableAmount}("");
                    require(sent, "Failed to send Ether");
                } else {
                    IERC20(tokens[i]).transfer(msg.sender, claimableAmount);
                }
            }
        }

        SourceDAOToken.burn(sourceAmount);

        emit Withdraw(msg.sender, sourceAmount);
    }

    function isDividendEnable() public view returns (bool) {
        if (state == DividendState.Enable) {
            if (block.number >= stateEnableBlockNumber) {
                return true;
            }
        }

        return false;
    }

    function prepareChangeStateParams(DividendState _state, uint256 blockNumber) internal view returns (bytes32[] memory) {
        require(_state != DividendState.Disable);
        require(state != _state, "State is the same");

        bytes32[] memory params = new bytes32[](3);
        params[0] = bytes32(uint256(_state));
        params[1] = bytes32(blockNumber);
        params[2] = bytes32("dividendChangeState");

        return params;
    }

    function prepareChangeState(uint duration, DividendState _state, uint256 blockNumber) external override nonReentrant returns (uint) {
        ISourceDaoCommittee committee = getMainContractAddress().committee();
        require(committee.isMember(msg.sender), "Only committee members can call this");

        bytes32[] memory params = prepareChangeStateParams(_state, blockNumber);

        uint256 id = committee.propose(duration, params);

        emit DividendStateChangeRequested(id, _state, blockNumber);

        return id;
    }

    function changeState(uint proposalId, DividendState _state, uint256 blockNumber) external override nonReentrant {
        require(_state != DividendState.Disable);
        require(state != _state, "State is the same");

        ISourceDaoCommittee committee = getMainContractAddress().committee();
        require(committee.isMember(msg.sender), "Only committee members can call this");

        bytes32[] memory params = prepareChangeStateParams(_state, blockNumber);

        require(committee.takeResult(proposalId, params) == ISourceDaoCommittee.ProposalResult.Accept, "Proposal must be passed");

        state = _state;
        stateEnableBlockNumber = blockNumber;

        committee.setProposalExecuted(proposalId);

        emit DividendStateChanged(_state, blockNumber);
    }
}
