// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./Interface.sol";
import "./SourceDaoUpgradeable.sol";
import "./util.sol";


contract MultiSigWallet is IMultiSigWallet, SourceDaoContractUpgradeable, ReentrancyGuardUpgradeable {
    string public _name;

    address[] public tokenList;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(string memory __name, address mainAddr) public initializer {
        __SourceDaoContractUpgradable_init(mainAddr);
        __ReentrancyGuard_init();
        _name = __name;
    }

    function walletName() external override view returns (string memory)  {
        return _name;
    }

    function isOwner(address owner) private view returns (bool) {
        return getMainContractAddress().committee().isMember(owner);
    }

    function prepareProposalParams(address token, address to, uint256 amount, string memory name) internal pure returns (bytes32[] memory) {
        bytes32[] memory params = new bytes32[](4);
        params[0] = util.AddressToBytes32(token);
        params[1] = util.AddressToBytes32(to);
        params[2] = bytes32(amount);
        params[3] = keccak256(abi.encodePacked(name));
        params[4] = bytes32("walletTransfer");
        
        return params;
    }

    function prepareTransfer(uint duration, address token, address to, uint256 amount) external override nonReentrant returns (uint) {
        require(isOwner(msg.sender), "Caller is not an owner");

        bytes32[] memory params = prepareProposalParams(token, to, amount, _name);

        if(token != address(0)) {
            updateTokenList(token);
        }

        uint proposalId =  getMainContractAddress().committee().propose(duration, params);

        emit TransferRequested(proposalId, duration, token, to, amount);

        return proposalId;
    }

    function executeTransfer(uint proposalId, address token, address to, uint256 amount) external override nonReentrant {
        require(isOwner(msg.sender), "Caller is not an owner");
        
        bytes32[] memory params = prepareProposalParams(token, to, amount, _name);
        require(getMainContractAddress().committee().takeResult(proposalId, params) == ISourceDaoCommittee.ProposalResult.Accept, "Proposal must be passed");

        getMainContractAddress().committee().setProposalExecuted(proposalId);

        if (token == address(0)) {
            (bool sent, ) = to.call{value: amount}("");
            require(sent, "Failed to send Ether");
        } else {
            IERC20(token).transfer(to, amount);
        }

        emit TransferExecuted(proposalId, token, to, amount);
    }

    function getTokenBalance(address token) external override view returns(uint256) {
        if (token == address(0)) {
            // If the token address is 0, return the ETH balance of the contract
            return address(this).balance;
        } else {
            // If the token address is not 0, return the ERC20 token balance of the contract
            return IERC20(token).balanceOf(address(this));
        }
    }

    function updateTokenList(address token) public override {
        require(token != address(0), "token address can not be 0");

        uint256 balance = IERC20(token).balanceOf(address(this));

        if (balance > 0 && !isTokenInList(token)) {
            tokenList.push(token);
        } else if (balance == 0 && isTokenInList(token)) {
            removeToken(token);
        }
    }

    function getTokenList() public view override returns (address[] memory) {
        return tokenList;
    }

    function isTokenInList(address token) private view returns (bool) {
        for(uint256 i = 0; i < tokenList.length; i++) {
            if(tokenList[i] == token) {
                return true;
            }
        }

        return false;
    }

    function removeToken(address token) private {
        uint256 index = 0;
        bool found = false;

        for(uint256 i = 0; i < tokenList.length; i++) {
            if(tokenList[i] == token) {
                index = i;
                found = true;
                break;
            }
        }

        require(found, "token is not in the list");

        uint256 lastTokenIndex = tokenList.length - 1;

        // Move the last token to the slot of the to-delete token
        address lastToken = tokenList[lastTokenIndex];
        tokenList[index] = lastToken;

        // Delete the slot of the to-delete token
        tokenList.pop();
    }

    receive() external payable {}
}