// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "./Interface.sol";
import "./SourceDaoUpgradeable.sol";


contract SourceTokenLockup is ISourceTokenLockup, SourceDaoContractUpgradeable, ReentrancyGuardUpgradeable {
    struct UnlockInfo {
        uint256 totalAssigned;
        uint256 totalUnlocked;
    }

    uint256 public _totalAssigned;
    uint256 public _totalUnlocked;

    // Mapping from owner to UnlockInfo
    mapping (address => UnlockInfo) private _unlockInfo;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address mainAddr) public initializer {
        __SourceDaoContractUpgradable_init(mainAddr);
        __ReentrancyGuard_init();
    }

    function prepareProposalParams(address[] memory owners, uint256[] memory amounts, bytes32 proposalType) internal pure returns (bytes32[] memory) {
        require(owners.length == amounts.length, "Input arrays must be of same length");

        bytes32[] memory params = new bytes32[](owners.length+1);
        for (uint i = 0; i < owners.length; i++) {
            params[i] = keccak256(abi.encodePacked(owners[i], amounts[i]));
        }
        params[owners.length] = proposalType;

        return params;
    }

    function prepareDepositTokens(uint duration, address[] memory owners, uint256[] memory amounts) external override nonReentrant returns (uint) {
        ISourceDaoCommittee committee = getMainContractAddress().committee();
        require(committee.isMember(msg.sender), "Only committee members can call this");

        bytes32[] memory params = prepareProposalParams(owners, amounts, "depositTokens");

        uint proposalId = committee.propose(duration, params);

        emit TokensPrepareDeposit(proposalId, duration, owners, amounts);

        return proposalId;
    }

    function depositTokens(uint proposalId, address[] memory owners, uint256[] memory amounts) external override nonReentrant {
        ISourceDaoCommittee committee = getMainContractAddress().committee();
        require(committee.isMember(msg.sender), "Only committee members can call this");

        bytes32[] memory params = prepareProposalParams(owners, amounts, "depositTokens");

        require(committee.takeResult(proposalId, params) == ISourceDaoCommittee.ProposalResult.Accept, "Proposal must be passed");

        uint256 totalAmount = 0;
        for (uint i = 0; i < owners.length; i++) {
            _unlockInfo[owners[i]].totalAssigned += amounts[i];
            totalAmount += amounts[i];
        }

        _totalAssigned += totalAmount;

        ISourceDAOToken token = getMainContractAddress().token();
        token.releaseTokensToSelf(totalAmount);

        committee.setProposalExecuted(proposalId);

        emit TokensDeposited(proposalId, totalAmount, owners, amounts);
    }
    
    function prepareUnlockTokens(uint duration, address[] memory owners, uint256[] memory amounts) external override nonReentrant returns (uint) {
        ISourceDaoCommittee committee = getMainContractAddress().committee();
        require(committee.isMember(msg.sender), "Only committee members can call this");

        // check params
        for (uint i = 0; i < owners.length; i++) {
            UnlockInfo storage info = _unlockInfo[owners[i]];
            require(info.totalAssigned >= info.totalUnlocked + amounts[i], "Insufficient locked tokens");
        }

        bytes32[] memory params = prepareProposalParams(owners, amounts, "unlockTokens");

        uint256 proposalId = committee.propose(duration, params);

        emit TokensPrepareUnlock(proposalId, duration, owners, amounts);

        return proposalId;
    }

    function unlockTokens(uint proposalId, address[] memory owners, uint256[] memory amounts) external override nonReentrant {
        ISourceDaoCommittee committee = getMainContractAddress().committee();
        require(committee.isMember(msg.sender), "Only committee members can call this");

        bytes32[] memory params = prepareProposalParams(owners, amounts, "unlockTokens");

        require(committee.takeResult(proposalId, params) == ISourceDaoCommittee.ProposalResult.Accept, "Proposal must be passed");

        uint256 totalAmount = 0;
        for (uint i = 0; i < owners.length; i++) {
            UnlockInfo storage info = _unlockInfo[owners[i]];

            require(info.totalAssigned >= info.totalUnlocked + amounts[i], "Insufficient locked tokens");

            info.totalUnlocked += amounts[i];
            totalAmount +=  amounts[i];
        }

        _totalUnlocked += totalAmount;

        committee.setProposalExecuted(proposalId);

        emit TokensUnlocked(proposalId, totalAmount, owners, amounts);
    }

    function claimTokens(uint256 amount) external override nonReentrant {
        UnlockInfo storage info = _unlockInfo[msg.sender];

        require(amount > 0, "Invalid claim amount");
        require(info.totalUnlocked >= amount, "Insufficient unlocked tokens");

        info.totalUnlocked -= amount;
        info.totalAssigned -= amount;

        ISourceDAOToken token = getMainContractAddress().token();
        token.transfer(msg.sender, amount);

        emit TokensClaimed(msg.sender, amount);
    }

    function totalAssigned(address owner) external view override returns (uint256) {
        if (owner == address(0)) {
            return _totalAssigned;
        } else {
            return _unlockInfo[owner].totalAssigned;
        }
    }

    function totalUnlocked(address owner) external view override returns (uint256) {
        if (owner == address(0)) {
            return _totalUnlocked;
        } else {
            return _unlockInfo[owner].totalUnlocked;
        }
    }

    function totalLocked(address owner) external view override returns (uint256) {
        if (owner == address(0)) {
            return _totalAssigned - _totalUnlocked;
        } else {
            return _unlockInfo[owner].totalAssigned - _unlockInfo[owner].totalUnlocked;
        }
    }
}
