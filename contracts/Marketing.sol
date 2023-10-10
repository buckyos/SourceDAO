// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./Token.sol";
import "./Interface.sol";
import "./SourceDaoUpgradeable.sol";

contract MarketingContract is
    IMarketingGroup,
    Initializable,
    ReentrancyGuardUpgradeable,
    SourceDaoContractUpgradeable {

    struct ContributionInfo {
        uint64 value;
        bool hasWithdraw;
    }

    struct Contributions {
        uint64 total;
        mapping (address => ContributionInfo) list;
    }

    // activities <activity-id, Activity>
    mapping (uint => Activity) private activities;

    mapping (uint => Contributions) private contributions;

    event WithdrawContributionToken(address owner, uint amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address mainAddr) initializer public {
        __SourceDaoContractUpgradable_init(mainAddr);
    }

    function _makeProposalParams(Activity memory activity, bytes32 proposalType) pure internal returns (bytes32[] memory) {
        bytes32[] memory params = new bytes32[](6);
        params[0] = bytes32(activity.budget);
        params[1] = bytes32(activity.reward);
        params[2] = bytes32(uint256(activity.startDate));
        params[3] = bytes32(uint256(activity.endDate));
        params[4] = activity.description;
        params[5] = proposalType;

        return params;
    }

    /**
     * @dev create a new activity; and return a new `activityId`
    */
    function createActivity(uint budget, uint reward, uint64 startDate, uint64 endDate, bytes32 description) external returns (uint ActivityId) {
        ISourceDaoCommittee committee = getMainContractAddress().committee();

        Activity memory activity = Activity(
            ActivityState.WaitPay,
            budget,
            reward,
            0,
            startDate,
            endDate,
            msg.sender,
            description,
            0
        );

        bytes32[] memory params = _makeProposalParams(activity, "createActivity");

        // use proposal id for activity id;
        uint activityId = committee.propose(14 days, params);
        activities[activityId] = activity;
        emit ActivityCreate(activityId);

        return activityId;
    }

    /**
     * @dev transfer `budget` to the `principal`.
     * If the `budget` is 0, it's necessary to call `pay` to confirm the votes from committee.
     * This interface is called by the `principal` after it's accepted by committee.
     * */
    function pay(uint activityId) external nonReentrant {
        Activity storage activity = activities[activityId];

        require(activity.state == ActivityState.WaitPay, "Activity has paid");
        require(activity.principal == msg.sender, "Should call by principal");

        ISourceDao sourceDao = getMainContractAddress();
        ISourceDaoCommittee committee = sourceDao.committee();

        bytes32[] memory params = _makeProposalParams(activity, bytes32("createActivity"));

        ISourceDaoCommittee.ProposalResult proposalResult = committee.takeResult(activityId, params);
        require(proposalResult == ISourceDaoCommittee.ProposalResult.Accept, "Proposal not accepted");
        
        activity.state = ActivityState.Paid;
        
        if (activity.budget > 0) {
            ISourceDAOToken token = sourceDao.token();
            token.releaseTokensToSelf(activity.budget);

            if (!IERC20(address(token)).transfer(activity.principal, activity.budget)) {
                revert("Token transfer failed");
            }
        }

        committee.setProposalExecuted(activityId);

        emit ActivityStateChange(activityId, ActivityState.WaitPay, ActivityState.Paid);
    }

    /**
     * @dev update the contributes for every contributors, and the contributors can withdraw the `reward` with contribute.
     * This interface is called by the `principal` when the `budget` is paid,
     * And before the activity is evaluated.
     * It can be called multiple times(>=0).
    */
    function updateContribute(uint activityId, Contribution[] calldata _contributions) external {
        Activity storage activity = activities[activityId];

        require(activity.principal == msg.sender, "Should call by principal");
        require(activity.state == ActivityState.Paid, "Activity hasn't paid");
        
        Contributions storage _contributionsOfActivity = contributions[activityId];
        for (uint i = 0; i < _contributions.length; i++) {
            Contribution calldata contribution = _contributions[i];
            ContributionInfo storage info = _contributionsOfActivity.list[contribution.contributor];
            _contributionsOfActivity.total += contribution.value;
            _contributionsOfActivity.total -= info.value;
            info.value = contribution.value;
        }
    }

    /**
     * @dev evaluate the result of the activity, will pay `reward * evaluatePercent / 100` to the contributors.
     * This interface should be called by the `principal` after the contribution is updated if there are any contributions.
     * And a proposal will be post to the committee,
     *      if the committee accept it, the `principal` can take the `reward` with the `takeReward` method and then the contributors can withdraw it with contribution.
     *      otherwise the `principal` can update the proposal by recall this interface.
     * Note: evaluatePercent <= 100
     */
    function evaluate(uint activityId, uint evaluatePercent) external {
        Activity storage activity = activities[activityId];

        require(activity.principal == msg.sender, "Should call by principal");
        // require(activity.reward > 0, "Reward is 0, ignore");

        require(evaluatePercent <= 100, "max percentage is 100");

        require(
            activity.state == ActivityState.Paid
            || activity.state == ActivityState.Evaluating,
            "Activity hasn't paid"
        );

        ISourceDao sourceDao = getMainContractAddress();
        ISourceDaoCommittee committee = sourceDao.committee();

        bytes32[] memory params = _makeProposalParams(activity, "evaluateActivity");
        
        activity.proposalId = committee.propose(14 days, params);
        activity.evaluatePercent = evaluatePercent;

        ActivityState oldState = activity.state;
        activity.state = ActivityState.Evaluating;

        emit ActivityStateChange(activityId, oldState, ActivityState.Evaluating);
    }

    /**
     * @dev the committee has evaluated the activity, the `principal` take the reward in this contract.
    */
    function takeReward(uint activityId) external {
        Activity storage activity = activities[activityId];
        
        require(activity.principal == msg.sender, "Should call by principal");

        require(activity.state == ActivityState.Evaluating, "Should call `evaluate` first");
        
        ISourceDao sourceDao = getMainContractAddress();
        ISourceDaoCommittee committee = sourceDao.committee();

        bytes32[] memory params = _makeProposalParams(activity, "evaluateActivity");

        ISourceDaoCommittee.ProposalResult proposalResult = committee.takeResult(activity.proposalId, params);
        require(proposalResult == ISourceDaoCommittee.ProposalResult.Accept, "Proposal not accepted");

        sourceDao.token().releaseTokensToSelf(activity.reward * activity.evaluatePercent / 100);
        committee.setProposalExecuted(activity.proposalId);
        activity.state = ActivityState.End;

        emit ActivityStateChange(activityId, ActivityState.Evaluating, ActivityState.End);
    }

    /**
    * @dev withdraw tokens which caller's earned from contribution from ended activities.
    */
    function withdrawReward(uint[] calldata activityIds) external nonReentrant returns(uint) {
        uint claimAmount = 0;
        for (uint j = 0; j < activityIds.length; j++) {
            uint activityId = activityIds[j];
            Activity memory activity = activities[activityId];

            if (activity.state == ActivityState.End) {
                Contributions storage contributionsOfActivity = contributions[activityId];
                ContributionInfo storage info = contributionsOfActivity.list[msg.sender];
                if (!info.hasWithdraw) {
                    uint reward = (activity.reward * activity.evaluatePercent) / 100;
                    claimAmount += reward * info.value / contributionsOfActivity.total;
                    info.hasWithdraw = true;
                }
            }
        }

        if (claimAmount > 0) {
            IERC20(address(getMainContractAddress().token())).transfer(msg.sender, claimAmount);
        }
    
        emit WithdrawContributionToken(msg.sender, claimAmount);
        
        return claimAmount;
    }

    function activityOf(uint activityId) external view returns(Activity memory) {
        return activities[activityId];
    }

    /**
    * @dev query some one's contribution percent on a project
    */
    function contributionOf(uint activityId, address who) external view returns(uint) {
        return contributions[activityId].list[who].value;
    }
}