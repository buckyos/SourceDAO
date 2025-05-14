// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./Interface.sol";
import "./SourceDaoUpgradeable.sol";

// 锁定合约，这里做简单些，符合当前需求：
// 1. 某人A转账normalToken给另一人B，并锁定
// 2. 当A，B为同一人时，即锁定给自己
// 3. 通过提案解锁，解锁所有金额
// 4. 解锁的金额不能立即提取，分6个月线性释放
// 锁定并不是一个高频操作，只是一些资本运作的需要。因此不需要分批锁定

contract SourceTokenLockup is ISourceTokenLockup, SourceDaoContractUpgradeable, ReentrancyGuardUpgradeable {
    struct UnlockInfo {
        uint256 totalAssigned;  // 还有多少在锁定中
        uint256 totalUnlocked;  // 还有多少未提取
        uint256 unlockTime;     // 解锁时间。0表示未解锁
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


    // transfer normal token to someone and lock it
    function transferAndLock(address[] calldata to, uint256[] calldata amount) external override nonReentrant {
        require(to.length == amount.length, "Input arrays must be of same length");

        ISourceDAONormalToken token = getMainContractAddress().normalToken();

        uint totalAmount = 0;
        for (uint i = 0; i < to.length; i++) {
            totalAmount += amount[i];
        }

        token.transferFrom(msg.sender, address(this), totalAmount);

        for (uint i = 0; i < to.length; i++) {
            UnlockInfo storage info = _unlockInfo[to[i]];
            info.totalAssigned = info.totalUnlocked + amount[i];    // 如果有未提取的部分，也一并锁定回去
            info.unlockTime = 0;

            _totalAssigned += amount[i];
        }
    }

    // convert dev token to normal token and lock it
    function convertAndLock(address[] calldata to, uint256[] calldata amount) external override nonReentrant {
        require(to.length == amount.length, "Input arrays must be of same length");

        ISourceDAODevToken devToken = getMainContractAddress().devToken();

        uint totalAmount = 0;
        for (uint i = 0; i < to.length; i++) {
            totalAmount += amount[i];
        }
        devToken.transferFrom(msg.sender, address(this), totalAmount);
        devToken.dev2normal(totalAmount);

        for (uint i = 0; i < to.length; i++) {
            UnlockInfo storage info = _unlockInfo[to[i]];
            info.totalAssigned = info.totalUnlocked + amount[i];    // 如果有未提取的部分，也一并锁定回去
            info.unlockTime = 0;

            _totalAssigned += amount[i];
        }
    }

    function prepareProposalParams(address[] memory owners, bytes32 proposalType) internal pure returns (bytes32[] memory) {
        bytes32[] memory params = new bytes32[](owners.length+1);
        for (uint i = 0; i < owners.length; i++) {
            params[i] = keccak256(abi.encodePacked(owners[i]));
        }
        params[owners.length] = proposalType;

        return params;
    }
    
    function prepareUnlockTokens(uint duration, address[] memory owners) external override nonReentrant returns (uint) {
        ISourceDaoCommittee committee = getMainContractAddress().committee();
        require(committee.isMember(msg.sender), "Only committee members can call this");

        bytes32[] memory params = prepareProposalParams(owners, "unlockTokens");

        uint256 proposalId = committee.propose(duration, params);

        emit TokensPrepareUnlock(proposalId, duration, owners);

        return proposalId;
    }

    function unlockTokens(uint proposalId, address[] memory owners) external override nonReentrant {
        ISourceDaoCommittee committee = getMainContractAddress().committee();
        require(committee.isMember(msg.sender), "Only committee members can call this");

        bytes32[] memory params = prepareProposalParams(owners, "unlockTokens");

        require(committee.takeResult(proposalId, params) == ISourceDaoCommittee.ProposalResult.Accept, "Proposal must be passed");

        uint256 totalAmount = 0;
        for (uint i = 0; i < owners.length; i++) {
            UnlockInfo storage info = _unlockInfo[owners[i]];
            info.unlockTime = block.timestamp;

            info.totalUnlocked = info.totalAssigned;
            totalAmount += info.totalAssigned;
        }

        _totalUnlocked += totalAmount;

        committee.setProposalExecuted(proposalId);

        emit TokensUnlocked(proposalId, totalAmount, owners);
    }

    function claimTokens(uint256 amount) external override nonReentrant {
        UnlockInfo storage info = _unlockInfo[msg.sender];

        uint256 unlockPassed = (block.timestamp - info.unlockTime);
        uint256 maxClaimTokens = (unlockPassed * info.totalAssigned) / 180 days; // 6 months

        require(info.totalUnlocked >= amount, "Insufficient unlocked tokens");
        require(maxClaimTokens - (info.totalAssigned - info.totalUnlocked) >= amount, "Claim amount exceeds unlocked tokens");

        info.totalUnlocked -= amount;

        getMainContractAddress().normalToken().transfer(msg.sender, amount);

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
