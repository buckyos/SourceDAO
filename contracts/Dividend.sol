// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "hardhat/console.sol";

import "./Interface.sol";
import "./SourceDaoUpgradeable.sol";

contract DividendContract is ISourceDAODividend, SourceDaoContractUpgradeable, ReentrancyGuardUpgradeable {
    // 支持DevToken和NormalToken的质押, 就不在初始化时传入了

    // the max length of the cycle in seconds
    uint256 public cycleMinLength;
    
    // current cycle index, start at 0
    uint256 public currentCycleIndex;

    // The total staked amount of the contract of all users
    uint256 public totalStaked;

    // The cycle info of the contract, use the cycle index start at 0 as the key
    mapping(uint256 => CycleInfo) public cycles;

    // The staking record of the user
    struct StakeRecord {
        uint256 cycleIndex;
        uint256 normalAmount;
        uint256 devAmount;
    }
    mapping(address => StakeRecord[]) UserStakeRecords;

    // The dividend state of the user, use the keccak256(user, cycleIndex, token) as the key
    mapping(bytes32 => bool) public withdrawDividendState;

    // All the deposit token balance of the contract
    mapping(address => uint256) public tokenBalances;

    

    function initialize(uint256 _cycleMinLength, address mainAddr) public initializer {
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __SourceDaoContractUpgradable_init(mainAddr);
        __DividendContractUpgradable_init(_cycleMinLength);
    }

    function __DividendContractUpgradable_init(uint256 _cycleMinLength) public onlyInitializing {
        cycleMinLength = _cycleMinLength;

        cycles[0].startBlocktime = block.timestamp;
    }

    /**
     * @return the current cycle index, start at 0
     */

    function getCurrentCycleIndex() external view override returns (uint256) {
        return currentCycleIndex;
    }

    /**
     * @return the current cycle info
     * CycleInfo: {
     * startBlocktime: uint256, // The start block of the cycle
     * totalStaked: uint256, // the total stake amount of the curent cycle
     * rewards: RewardInfo[] // the reward info of the cycle
     * }
     * 
     * RewardInfo: {
     * token: address, // the token address of the reward
     * amount: uint256 // the reward amount of the token
     * }
     */
    function getCurrentCycle() external view returns (CycleInfo memory) {
        return cycles[currentCycleIndex];
    }

    /**
     * @return the cycle info list in the range of [startCycle, endCycle]
     */
    function getCycleInfos(uint256 startCycle, uint256 endCycle) external view returns (CycleInfo[] memory) {
        require(startCycle <= endCycle, "Invalid cycle range");
        require(endCycle <= currentCycleIndex, "Invalid cycle range");

        CycleInfo[] memory cycleInfos = new CycleInfo[](endCycle - startCycle + 1);
        for (uint i = startCycle; i <= endCycle; i++) {
            cycleInfos[i - startCycle] = cycles[i];
        }

        return cycleInfos;
    }

    /**
     * Get the total staked amount of the specified cycle
     * @param cycleIndex the cycle index, shoule be less than or equal to the current cycle index
     * @return the total staked amount of the specified cycle
     */
    function getTotalStaked(uint256 cycleIndex) external view returns (uint256) {
        if (cycleIndex == currentCycleIndex) {
            return totalStaked;
        } else if (cycleIndex < currentCycleIndex) {
            return cycles[cycleIndex].totalStaked;
        } else {
            return 0;
        }
    }

    /**
     * Get the reward info for the specified token
     * @param token the reward token address
     * @return the reward token amount in total
     */
    function getDepositTokenBalance(address token) external view returns (uint256) {
        return tokenBalances[token];
    }

    // Deposit token as rewards to the current cycle
    function _depositToken(address token, uint256 amount) internal {
        require(amount > 0, "Cannot deposit 0");

        // first update the token balance
        // console.log("token balance growed: %s %d ===> %d", token, tokenBalances[token], tokenBalances[token] + amount);
        tokenBalances[token] += amount;

        // then update the current cycle reward
        RewardInfo[] storage rewards = cycles[currentCycleIndex].rewards;
        for (uint256 i = 0; i < rewards.length; i++) {
            if (rewards[i].token == token) {
                rewards[i].amount += amount;
                return;
            }
        }

        rewards.push(RewardInfo(token, amount));

        // Emit the deposit event
        emit Deposit(amount, token);
    }

    /**
     * Deposit main token of the chain as reward to the contract
     */
    receive() external payable {
        _tryNewCycle();

        _depositToken(address(0), msg.value);
    }

    /**
     * Deposit token to the contract as reward, must be approved first
     * @param amount the amount of the token to deposit
     * @param token the token address to deposit, should not be the staking token or 0 address(main token)
     */
    function deposit(uint256 amount, address token) external nonReentrant {
        _tryNewCycle();

        require(token != address(getMainContractAddress().normalToken()), "Cannot deposit dao normal token");
        require(token != address(getMainContractAddress().devToken()), "Cannot deposit dao dev token");
        require(token != address(0), "Use native transfer to deposit default token");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        _depositToken(token, amount);
    }

    /**
     * Update the token balance of the contract if needed, for some case deposit token to the contract directly(not use the deposit function we provided) 
     * @param token the token address to update the balance
     */
    function updateTokenBalance(address token) external nonReentrant {
        uint256 balance;
        if (token == address(0)) {
            // If the token address is 0, return the ETH balance of the contract
            balance = address(this).balance;
        } else {
            // If the token address is not 0, return the ERC20 token balance of the contract
            balance = IERC20(token).balanceOf(address(this));
        }

        require(balance >= tokenBalances[token], "Invalid balance state");
        if (balance > tokenBalances[token]) {
            _tryNewCycle();
            
            uint256 diff = balance - tokenBalances[token];
            _depositToken(token, diff);
        }
    }

    /**
     * Get the stake token amount of the user in the specified cycle
     * @param cycleIndex the cycle index, should be less than or equal to the current cycle index
     * @return the stake amount of the user in the specified cycle
     */
    function getStakeAmount(uint256 cycleIndex) external view returns (uint256) {
        require(cycleIndex <= currentCycleIndex, "Invalid cycle index");

        return _getStakeAmount(msg.sender, cycleIndex);
    }

    function _getStakeAmount(address user, uint256 cycleIndex) internal view returns (uint256) {
        StakeRecord[] memory stakeRecords = UserStakeRecords[user];
        if (stakeRecords.length == 0) {
            return 0;
        }

        // Print the stake records
        /*
        console.log("will print stake records for user %s", user);
        for (uint i = 0; i < stakeRecords.length; i++) {
            console.log("StakeRecords: cycleIndex %d, stake mount %d", stakeRecords[i].cycleIndex, stakeRecords[i].amount);
        }
        */

        for (uint i = stakeRecords.length - 1; ; i--) {
            if (stakeRecords[i].cycleIndex <= cycleIndex) {
                return stakeRecords[i].normalAmount + stakeRecords[i].devAmount;
            }

            if (i == 0) {
                break;
            }
        }

        return 0;
    }

    /**
     * Stake the token to the contract, the staked token will be used to calculate the rewards in next cycle
     * @param amount the amount of the token to stake, should be greater than 0
     */
    function stakeNormal(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0 Token");
        require(getMainContractAddress().normalToken().transferFrom(msg.sender, address(this), amount), "Stake failed");

        // console.log("user stake ===> amount %d, cycle %d, user %s", amount, currentCycleIndex, msg.sender);

        // The last stake record of the user is always the newest stake amount of the user in the contract
        StakeRecord[] storage stakeRecords = UserStakeRecords[msg.sender];
        if (stakeRecords.length == 0) {
            stakeRecords.push(StakeRecord(currentCycleIndex, amount, 0));
        } else {
            StakeRecord storage lastStakeRecord = stakeRecords[stakeRecords.length - 1];
            if (lastStakeRecord.cycleIndex == currentCycleIndex) {
                lastStakeRecord.normalAmount += amount;
            } else {
                stakeRecords.push(StakeRecord(currentCycleIndex, lastStakeRecord.normalAmount + amount, 0));
            }
        }

        // Update the total staked amount of the contract
        totalStaked += amount;

        // Emit the stake event
        emit Stake(msg.sender, amount);
    }

    /**
     * Stake the token to the contract, the staked token will be used to calculate the rewards in next cycle
     * @param amount the amount of the token to stake, should be greater than 0
     */
    function stakeDev(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0 Token");
        require(getMainContractAddress().devToken().transferFrom(msg.sender, address(this), amount), "Stake failed");

        // console.log("user stake ===> amount %d, cycle %d, user %s", amount, currentCycleIndex, msg.sender);

        // The last stake record of the user is always the newest stake amount of the user in the contract
        StakeRecord[] storage stakeRecords = UserStakeRecords[msg.sender];
        if (stakeRecords.length == 0) {
            stakeRecords.push(StakeRecord(currentCycleIndex, 0, amount));
        } else {
            StakeRecord storage lastStakeRecord = stakeRecords[stakeRecords.length - 1];
            if (lastStakeRecord.cycleIndex == currentCycleIndex) {
                lastStakeRecord.devAmount += amount;
            } else {
                stakeRecords.push(StakeRecord(currentCycleIndex, 0, lastStakeRecord.devAmount + amount));
            }
        }

        // Update the total staked amount of the contract
        totalStaked += amount;

        // Emit the stake event
        emit Stake(msg.sender, amount);
    }


    /**
     * Unstake the token from the contract, the unstaked token will be transfered back to the user
     * Unstake will first unstake the current cycle's lastest staked amount, if the amount is not enough, then will unstake the previous cycle's staked amount
     * 
     * @param amount the amount of the token to unstake, should be greater than 0 and less than or equal to the staked amount of the user
     */
    function unstakeNormal(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot unstake 0");
        StakeRecord[] storage stakeRecords = UserStakeRecords[msg.sender];
        require(stakeRecords.length > 0, "No stake record found");
        
        // console.log("user unstake <=== amount %d, cycle %d, user %s", amount, currentCycleIndex, msg.sender);

        // Get the last stake record of the user
        StakeRecord storage lastStakeRecord = stakeRecords[stakeRecords.length - 1];
        require(lastStakeRecord.normalAmount >= amount, "Insufficient stake amount");

        // If there is a stake operation in the current cycle, this stake operation can be directly revoked without affecting the cycle data (the current stake will enter the cycleInfo in the next cycle).
        // If it is not a stake operation in the current cycle, or the stake amount in the current cycle is insufficient, then this stake operation needs to be subtracted from the cycleInfo data associated with the previous cycle.
        
        // console.log("unstaking amount %d", amount);
        // console.log("currentCycleIndex %d, lastStakeRecord.cycleIndex %d, amount %d", currentCycleIndex, lastStakeRecord.cycleIndex, lastStakeRecord.amount);
        // console.log("lastStakeRecord.cycleIndex %d", lastStakeRecord.cycleIndex);
        if (lastStakeRecord.cycleIndex == currentCycleIndex) {

            uint256 newAmount = 0;
            if (stakeRecords.length > 1) {
                StakeRecord memory prevStakeRecord = stakeRecords[stakeRecords.length - 2];
                if (prevStakeRecord.normalAmount < lastStakeRecord.normalAmount) {
                    newAmount = lastStakeRecord.normalAmount - prevStakeRecord.normalAmount;
                }
            } else {
                newAmount = lastStakeRecord.normalAmount;
            }

            if (newAmount >= amount) {
                lastStakeRecord.normalAmount -= amount;
            } else {
                uint256 diff = amount - newAmount;

                StakeRecord storage prevStakeRecord = stakeRecords[stakeRecords.length - 2];
                // console.log("prevStakeRecord.amount %d", prevStakeRecord.amount);
                // console.log("prevStakeRecord.cycleIndex %d", prevStakeRecord.cycleIndex);
                // console.log("prevStakeRecord.totalStaked %d", cycles[prevStakeRecord.cycleIndex].totalStaked);
                
                // The last record is unstaked all and is empty, delete it
                stakeRecords.pop();

                // The prev record all unstaked with the diff amount
                prevStakeRecord.normalAmount -= diff;

                // Unstake only effect the current cycle's total staked amount
                cycles[currentCycleIndex].totalStaked -= diff;
            }
        } else {
            lastStakeRecord.normalAmount -= amount;

            cycles[lastStakeRecord.cycleIndex + 1].totalStaked -= amount;
        }
        
        totalStaked -= amount;

        // console.log("will unstake transfer %s ===> %d", msg.sender, amount);
        require(getMainContractAddress().normalToken().transfer(msg.sender, amount), "Unstake failed");

        emit Unstake(msg.sender, amount);
    }

    /**
     * Unstake the token from the contract, the unstaked token will be transfered back to the user
     * Unstake will first unstake the current cycle's lastest staked amount, if the amount is not enough, then will unstake the previous cycle's staked amount
     * 
     * @param amount the amount of the token to unstake, should be greater than 0 and less than or equal to the staked amount of the user
     */
    function unstakeDev(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot unstake 0");
        StakeRecord[] storage stakeRecords = UserStakeRecords[msg.sender];
        require(stakeRecords.length > 0, "No stake record found");
        
        // console.log("user unstake <=== amount %d, cycle %d, user %s", amount, currentCycleIndex, msg.sender);

        // Get the last stake record of the user
        StakeRecord storage lastStakeRecord = stakeRecords[stakeRecords.length - 1];
        require(lastStakeRecord.devAmount >= amount, "Insufficient stake amount");

        // If there is a stake operation in the current cycle, this stake operation can be directly revoked without affecting the cycle data (the current stake will enter the cycleInfo in the next cycle).
        // If it is not a stake operation in the current cycle, or the stake amount in the current cycle is insufficient, then this stake operation needs to be subtracted from the cycleInfo data associated with the previous cycle.
        
        // console.log("unstaking amount %d", amount);
        // console.log("currentCycleIndex %d, lastStakeRecord.cycleIndex %d, amount %d", currentCycleIndex, lastStakeRecord.cycleIndex, lastStakeRecord.amount);
        // console.log("lastStakeRecord.cycleIndex %d", lastStakeRecord.cycleIndex);
        if (lastStakeRecord.cycleIndex == currentCycleIndex) {

            uint256 newAmount = 0;
            if (stakeRecords.length > 1) {
                StakeRecord memory prevStakeRecord = stakeRecords[stakeRecords.length - 2];
                if (prevStakeRecord.devAmount < lastStakeRecord.devAmount) {
                    newAmount = lastStakeRecord.devAmount - prevStakeRecord.devAmount;
                }
            } else {
                newAmount = lastStakeRecord.devAmount;
            }

            if (newAmount >= amount) {
                lastStakeRecord.devAmount -= amount;
            } else {
                uint256 diff = amount - newAmount;

                StakeRecord storage prevStakeRecord = stakeRecords[stakeRecords.length - 2];
                // console.log("prevStakeRecord.amount %d", prevStakeRecord.amount);
                // console.log("prevStakeRecord.cycleIndex %d", prevStakeRecord.cycleIndex);
                // console.log("prevStakeRecord.totalStaked %d", cycles[prevStakeRecord.cycleIndex].totalStaked);
                
                // The last record is unstaked all and is empty, delete it
                stakeRecords.pop();

                // The prev record all unstaked with the diff amount
                prevStakeRecord.devAmount -= diff;

                // Unstake only effect the current cycle's total staked amount
                cycles[currentCycleIndex].totalStaked -= diff;
            }
        } else {
            lastStakeRecord.devAmount -= amount;

            cycles[lastStakeRecord.cycleIndex + 1].totalStaked -= amount;
        }
        
        totalStaked -= amount;

        // console.log("will unstake transfer %s ===> %d", msg.sender, amount);
        require(getMainContractAddress().devToken().transfer(msg.sender, amount), "Unstake failed");

        emit Unstake(msg.sender, amount);
    }

    /**
     * Check if the new cycle should be started on check point
     * If the current cycle is over the max length, then start a new cycle
     */
    function _tryNewCycle() internal {
        uint256 currentBlocktime = block.timestamp;
        
        CycleInfo storage currentCycle = cycles[currentCycleIndex];
        if (currentBlocktime - currentCycle.startBlocktime >= cycleMinLength) {
            currentCycleIndex = currentCycleIndex + 1;
            console.log("enter new cycle %d, totalStaked %d", currentCycleIndex, totalStaked);
            CycleInfo storage newCycle = cycles[currentCycleIndex];
            newCycle.startBlocktime = currentBlocktime;
            newCycle.totalStaked = totalStaked;
            
            if (currentCycle.totalStaked == 0) {
                newCycle.rewards = currentCycle.rewards;
            }

            emit NewCycle(currentCycleIndex, currentBlocktime);
        }
    }

    function tryNewCycle() external nonReentrant {
        _tryNewCycle();
    }

    /**
     * Check if the user has settled the rewards for the specified cycle
     * User can withdraw the rewards for the cycle after the cycle is over and only once
     * @param cycleIndex the cycle index to check
     * @param token the token address to check
     * @return true if the user has settled the rewards for the cycle, otherwise false
     */
    function isDividendWithdrawed(uint256 cycleIndex, address token) external view returns (bool) {
        bytes32 key = keccak256(abi.encodePacked(msg.sender, cycleIndex, token));
        return withdrawDividendState[key];
    }

    /**
     * Estimate the rewards for the user in the specified cycles
     * @param cycleIndexs the cycle indexs to estimate
     * @param tokens the token addresses to estimate
     * @return the reward withdraw info list
     * RewardWithdrawInfo: {
     * token: address, // the token address of the reward
     * amount: uint256, // the reward amount of the token
     * withdrawed: bool // the withdraw state of the reward
     * }
     */
    function estimateDividends(uint256[] calldata cycleIndexs, address[] calldata tokens) external view returns (RewardWithdrawInfo[] memory) {
        require(cycleIndexs.length > 0, "No cycle index");
        require(tokens.length > 0, "No token");

        RewardWithdrawInfo[] memory rewards = new RewardWithdrawInfo[](cycleIndexs.length * tokens.length);
        uint256 realRewardLength = 0;

        for (uint i = 0; i < cycleIndexs.length; i++) {
            uint256 cycleIndex = cycleIndexs[i];
            require(cycleIndex < currentCycleIndex, "Cannot claim current or future cycle");

            // Cycle 0 is the first cycle and has no full cycle stake tokens, so no rewards
            if (cycleIndex == 0) {
                continue;
            }

            // Withdraw every token in tokens list
            for (uint j = 0; j < tokens.length; j++) {
                address token = tokens[j];
                bytes32 key = keccak256(abi.encodePacked(msg.sender, cycleIndex, token));
                bool withdrawed = withdrawDividendState[key];

                CycleInfo storage cycle = cycles[cycleIndex];

                if (cycle.totalStaked == 0) {
                    continue;
                }


                // The stake data in stakeRecords for the corresponding cycle results from stake and unstake operations initiated in that cycle.
                // Therefore, it needs to enter the next cycle to take effect, so we use the data from the previous cycle here.
                uint256 userStaked = _getStakeAmount(msg.sender, cycleIndex - 1);
                // console.log("userStaked %d, cycle %d", userStaked, cycleIndex);
                if (userStaked == 0) {
                    continue;
                }

                // Find the token reward of the cycle
                uint256 rewardAmount = 0;
                for (uint k = 0; k < cycle.rewards.length; k++) {
                    RewardInfo storage reward = cycle.rewards[k];
                    if (reward.token == token) {
                        // console.log("reward.amount %d, userStaked %d, cycle.totalStaked %d", reward.amount, userStaked, cycle.totalStaked);
                        rewardAmount = reward.amount * userStaked / cycle.totalStaked;
                        break;
                    }
                }

                if (rewardAmount > 0) {
                    rewards[realRewardLength++] = RewardWithdrawInfo(token, rewardAmount, withdrawed);
                }
            }
        }

        // Copy the real rewards to new array and return
        RewardWithdrawInfo[] memory realRewards = new RewardWithdrawInfo[](realRewardLength);
        for (uint i = 0; i < realRewardLength; i++) {
            realRewards[i] = rewards[i];
        }

        return realRewards;
    }

    /**
     * Withdraw the rewards for the user in the specified cycles
     * User can withdraw the specified token reward for the cycle after the cycle is over and only once
     * @param cycleIndexs the cycle indexs to withdraw
     * @param tokens the token addresses to withdraw if there is any reward for that token
     */

    function withdrawDividends(uint256[] calldata cycleIndexs, address[] calldata tokens) external nonReentrant {
        require(cycleIndexs.length > 0, "No cycle index");
        require(tokens.length > 0, "No token");
        
        // require(UserStakeRecords[msg.sender].length > 0, "No stake record");

        // Display the params
        /*
        console.log("will withdraw dividends user %s", msg.sender);
        for (uint i = 0; i < cycleIndexs.length; i++) {
            console.log("cycleIndexs %d", cycleIndexs[i]);
        }
        */

        RewardInfo[] memory rewards = new RewardInfo[](cycleIndexs.length * tokens.length);
        uint256 realRewardLength = 0;

        for (uint i = 0; i < cycleIndexs.length; i++) {
            uint256 cycleIndex = cycleIndexs[i];
            require(cycleIndex < currentCycleIndex, "Cannot claim current or future cycle");

            // Cycle 0 has no full cycle stake tokens and no rewards, so skip
            if (cycleIndex == 0) {
                continue;
            }

            // Withdraw every token in tokens list
            for (uint j = 0; j < tokens.length; j++) {
                address token = tokens[j];
                bytes32 key = keccak256(abi.encodePacked(msg.sender, cycleIndex, token));
                require(!withdrawDividendState[key], "Already claimed");

                CycleInfo storage cycle = cycles[cycleIndex];

                if (cycle.totalStaked == 0) {
                    continue;
                }

                // The stake data in stakeRecords for the corresponding cycle results from stake and unstake operations initiated in that cycle.
                // Therefore, it needs to enter the next cycle to take effect, so we use the data from the previous cycle here.
                uint256 userStaked = _getStakeAmount(msg.sender, cycleIndex - 1);
                // console.log("userStaked %d, cycle %d", userStaked, cycleIndex);
                if (userStaked == 0) {
                    continue;
                }

                // Find the token reward of the cycle
                uint256 rewardAmount = 0;
                for (uint k = 0; k < cycle.rewards.length; k++) {
                    RewardInfo storage reward = cycle.rewards[k];
                    if (reward.token == token) {
                        // console.log("reward.amount %d, userStaked %d, cycle.totalStaked %d", reward.amount, userStaked, cycle.totalStaked);
                        rewardAmount = reward.amount * userStaked / cycle.totalStaked;
                        break;
                    }
                }

                if (rewardAmount > 0) {
                    rewards[realRewardLength++] = RewardInfo(token, rewardAmount);
                }

                // Set the withdraw state of the user and the cycle and the token to prevent duplicate withdraw
                withdrawDividendState[key] = true;
            }
        }

        // Do the transfer for the rewards
        for (uint i = 0; i < realRewardLength; i++) {
            RewardInfo memory reward = rewards[i];
            // console.log("will withdraw transfer %s %s ===> %d", reward.token, msg.sender, reward.amount);
            if (reward.token == address(0)) {
                payable(msg.sender).transfer(reward.amount);
            } else {
                IERC20(reward.token).transfer(msg.sender, reward.amount);
            }

            // Then update the token balance in the contract
            // console.log("token balance reduced: %s %d ===> %d", reward.token, tokenBalances[reward.token], tokenBalances[reward.token] - reward.amount);
            require(tokenBalances[reward.token] >= reward.amount, "Invalid balance state");
           
            tokenBalances[reward.token] -= reward.amount;

            emit Withdraw(msg.sender, reward.token, reward.amount);
        }
    }
}