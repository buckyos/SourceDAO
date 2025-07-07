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
        uint256 totalAssigned;  // 曾锁定的总量
        uint256 totalClaimed;  // 已经提取了多少
    }

    uint256 public _totalAssigned;
    uint256 public _totalClaimed;

    bytes32 public unlockProjectName;
    uint64 public unlockProjectVersion;

    uint256 unlockTime;

    // Mapping from owner to UnlockInfo
    mapping (address => UnlockInfo) private _unlockInfo;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(bytes32 _unlockProjectName, uint64 _unlockVersion, address mainAddr) public initializer {
        __SourceDaoContractUpgradable_init(mainAddr);
        __ReentrancyGuard_init();

        unlockProjectName = _unlockProjectName;
        unlockProjectVersion = _unlockVersion;
        unlockTime = 0;
    }

    // transfer normal token to someone and lock it
    function transferAndLock(address[] calldata to, uint256[] calldata amount) external override nonReentrant {
        require(to.length == amount.length, "Input arrays must be of same length");
        require(unlockTime == 0, "already Unlocked");

        ISourceDAONormalToken token = getMainContractAddress().normalToken();

        uint totalAmount = 0;
        for (uint i = 0; i < to.length; i++) {
            totalAmount += amount[i];
            _unlockInfo[to[i]].totalAssigned += amount[i];
        }

        token.transferFrom(msg.sender, address(this), totalAmount);

        _totalAssigned += totalAmount;
    }

    // convert dev token to normal token and lock it
    function convertAndLock(address[] calldata to, uint256[] calldata amount) external override nonReentrant {
        require(to.length == amount.length, "Input arrays must be of same length");
        require(unlockTime == 0, "already Unlocked");

        ISourceDAODevToken devToken = getMainContractAddress().devToken();

        uint totalAmount = 0;
        for (uint i = 0; i < to.length; i++) {
            totalAmount += amount[i];
            _unlockInfo[to[i]].totalAssigned += amount[i];
        }
        devToken.transferFrom(msg.sender, address(this), totalAmount);
        devToken.dev2normal(totalAmount);

        _totalAssigned += totalAmount;
    }

    function _maxClaimTokens(address owner, uint256 _unlockTime) internal view returns (uint256) {
        UnlockInfo storage info = _unlockInfo[owner];

        uint256 unlockPassed = (block.timestamp - _unlockTime);
        if (unlockPassed > 180 days) {
            unlockPassed = 180 days;
        }

        uint256 maxClaimTokens = (unlockPassed * info.totalAssigned) / 180 days; // 6 months

        require(maxClaimTokens >= info.totalClaimed, "Already claimed more than max claimable tokens");

        return maxClaimTokens - info.totalClaimed;
    }

    function claimTokens(uint256 amount) external override nonReentrant {
        if (unlockTime == 0) {
            // 检查是否已解锁
            uint256 releaseTime = getMainContractAddress().project().versionReleasedTime(unlockProjectName, unlockProjectVersion);
            if (releaseTime > 0) {
                // 从版本发布的时刻开始解锁
                unlockTime = releaseTime;
            } else {
                revert("Tokens are not unlocked yet");
            }
        }
        uint256 maxClaimToken = _maxClaimTokens(msg.sender, unlockTime);
        require(maxClaimToken >= amount, "Claim amount exceeds unlocked tokens");

        _unlockInfo[msg.sender].totalClaimed += amount;

        getMainContractAddress().normalToken().transfer(msg.sender, amount);

        _totalClaimed += amount;

        emit TokensClaimed(msg.sender, amount);
    }

    function getCanClaimTokens() external view override returns (uint256) {
        uint256 _unlockTime = unlockTime;
        if (_unlockTime == 0) {
            // 检查是否已解锁
            uint256 releaseTime = getMainContractAddress().project().versionReleasedTime(unlockProjectName, unlockProjectVersion);
            if (releaseTime > 0) {
                // 从版本发布的时刻开始解锁
                _unlockTime = releaseTime;
            } else {
                return 0;
            }
        }

        return _maxClaimTokens(msg.sender, _unlockTime);
    } 

    function totalAssigned(address owner) external view override returns (uint256) {
        if (owner == address(0)) {
            return _totalAssigned;
        } else {
            return _unlockInfo[owner].totalAssigned;
        }
    }

    function totalClaimed(address owner) external view override returns (uint256) {
        if (owner == address(0)) {
            return _totalClaimed;
        } else {
            return _unlockInfo[owner].totalClaimed;
        }
    }
}
