# Marketing Promotion Contract

## Application scenarios

Carry out activities for marketing purposes, apply for budgets and incentives. All funds for an event are divided into two parts:

1. Budget: The budget package used for the market activity itself (purchasing equipment, service fees, etc.), will be withdrawn by the activity sponsor after the activity plan passes the resolution of the committee.
2. Bonuses: After the market activity ends, certain rewards will be given to participants based on the activity effect and contribution. The upper limit is set when the activity is launched. After the activity is over, the initiator sets the contribution of each participant and sets a percentage according to the effect of the activity. After the committee decides, the bonus will be released, and then each participant can One-time free withdrawal bonus for contribution.

Both the budget and bonus can be 0; the budget can be set to 0 when there is no need for advance expenses; there can also be only the budget, and the unspent part can be used as the income of the event sponsor; if both are 0, this is a purely public welfare activity.

## Interface (IMarketingGroup)

1. State of activity

```solidity
    enum ActivityState {
        // activity not existing
        None,
        // wait votes to pay by committee
        WaitPay,
        // paid to `principal`
        Paid,
        // evaluating by committee
        Evaluating,
        // activity end.
        End
    }
```

2. Description of activity

```solidity
    struct Activity {
        ActivityState state;
        // `budget` for the activity.
        uint budget;
        // `reward` for `principal` when the activity is end.
        uint reward;
        // `evaluate` for the result of the activity, will pay `reward * evaluatePercent / 100` to `principal`
        uint evaluatePercent;
        // start time
        uint64 startDate;
        // end time
        uint64 endDate;
        // `principal`
        address principal;
        // maybe some characters, or an object in `Github`，or others.
        bytes32 description;
        // waiting a committee proposal
        uint proposalId;
    }
```

3. Contribution of one contributor in one activity

```solidity
    struct Contribution {
        address contributor;
        // contribution
        uint64 value;
    }
```

4. Events

```solidity
   /**
     * @dev an activity created, in `WaitPay` state
     */
    event ActivityCreate(uint indexed activityId);
    /**
     * @dev an activity state changed
     */
    event ActivityStateChange(
        uint indexed activityId,
        ActivityState oldState,
        ActivityState newState
    );
```

5. Create a new activity by the principal.

```solidity
    /**
     * @dev create a new activity; and return a new `activityId`. the `msg.sender` is the principal.
     */
    function createActivity(
        uint budget,
        uint reward,
        uint64 startDate,
        uint64 endDate,
        bytes32 description
    ) external returns (uint ActivityId);

```

6. Pay the budget to the principal.

```solidity
    /**
     * @dev transfer `budget` to the `principal`.
     * If the `budget` is 0, it's necessary to call `pay` to confirm the votes from committee.
     * This interface is called by the `principal` after it's accepted by committee.
     * */
    function pay(uint activityId) external;
```

7. Assign the contributions for contributors by the principal.

```solidity
    /**
     * @dev update the contributes for every contributors, and the contributors can withdraw the `reward` with contribute.
     * This interface is called by the `principal` when the `budget` is paid,
     * And before the activity is evaluated.
     * It can be called multiple times(>=0).
     */
    function updateContribute(
        uint activityId,
        Contribution[] calldata contributions
    ) external;
```

8. Evaluate the result of the activity.

```solidity
    /**
     * @dev evaluate the result of the activity, will pay `reward * evaluatePercent / 100` to the contributors.
     * This interface should be called by the `principal` after the contribution is updated if there are any contributions.
     * And a proposal will be post to the committee,
     *      if the committee accept it, the `principal` can take the `reward` with the `takeReward` method and then the contributors can withdraw it with contribution.
     *      otherwise the `principal` can update the proposal by recall this interface.
     * Note: evaluatePercent <= 100
     */
    function evaluate(uint activityId, uint evaluatePercent) external;
```

9. Take reward to this contract address.

```solidity
    /**
     * @dev the committee has evaluated the activity, the `principal` take the reward in this contract.
     */
    function takeReward(uint activityId) external;
```

10. Withdraw tokens which caller's earned from contribution from ended activities.

```solidity
    /**
     * @dev withdraw tokens which caller's earned from contribution from ended activities.
     */
    function withdrawReward(
        uint[] calldata activityIds
    ) external returns (uint);
```

11. Query some one's contribution percent on an activity.

```solidity
    /**
     * @dev query some one's contribution percent on an activity
     */
    function contributionOf(
    uint activityId,
    address who
    ) external view returns (uint);
```

12. Query the attributes of an activity.

```solidity
    function activityOf(
        uint activityId
    ) external view returns (Activity memory);
```

## Flowchart

```mermaid
graph TB

subgraph principal
Start((None))-->createActivity-->waitPay((waitPay))
pay-->Paid((Paid))-->updateContribute-->evaluate-->Evaluating((Evaluating))
takeReward-->End((End))-->withdrawReward
end

waitPay.->AcceptActivity.->pay
Evaluating.->AcceptEvaluate.-takeReward

subgraph committee
AcceptActivity{accept the activity}
AcceptEvaluate{accept the valuate of an activity}
end

```
