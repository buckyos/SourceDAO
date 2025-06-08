// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title ISourceDAOToken interface
 * @dev Describes the public methods available for the SourceDAOToken
 */
interface ISourceDAOToken is IERC20, IERC20Metadata {
    /**
     * @dev Create proposal for release tokens to an array of addresses (owners).
     * This function can only be called by the committee after the proposal passed.
     * @param duration Expiration time of the proposal, in seconds
     * @param owners The array of addresses that will receive tokens.
     * @param amounts The array of amounts that each owner will receive.
     *                It must have the same length as the owners array.
     * @return The proposal id
     */
    function prepareReleaseTokens(
        uint duration,
        address[] memory owners,
        uint256[] memory amounts
    ) external returns (uint);

    /**
     * @dev Release tokens to an array of addresses (owners).
     * This function can only be called by the committee after the proposal passed.
     * @param proposalId The proposal id that passed in the SourceDaoCommittee.
     * @param owners The array of addresses that will receive tokens.
     * @param amounts The array of amounts that each owner will receive.
     *                It must have the same length as the owners array.
     */
    function releaseTokens(
        uint proposalId,
        address[] memory owners,
        uint256[] memory amounts
    ) external;

    /**
     * @dev Release tokens to the sender. Only authorized addresses can call this.
     * @param amount The amount of tokens to be released.
     */
    function releaseTokensToSelf(uint256 amount) external;

    /**
     * @dev Burn tokens from the sender. Only authorized addresses can call this.
     * @param amount The amount of tokens to be burned.
     */
    function burn(uint256 amount) external;

    /**
     * @dev Get the total supply of tokens.
     * @return The total supply of tokens.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Get the total amount of released tokens.
     * @return Total amount of released tokens.
     */
    function totalReleased() external view returns (uint256);

    /**
     * @dev Get the total amount of unreleased tokens.
     * @return Total amount of unreleased tokens.
     */
    function totalUnreleased() external view returns (uint256);

    /**
     * @dev Get the total amount of tokens in circulation.
     * @return Total amount of tokens in circulation.
     */
    function totalInCirculation() external view returns (uint256);

    /**
     * @dev Emitted when tokens are released.
     * @param from The address of the receiver.
     * @param amount The amount of tokens released.
     */
    event TokensReleased(address indexed from, uint256 amount);

    /**
     * @dev Emitted when tokens are burned.
     * @param from The address of the sender.
     * @param amount The amount of tokens burned.
     */
    event TokensBurned(address indexed from, uint256 amount);
}

/**
 * @dev dao committee
 */
interface ISourceDaoCommittee {
    enum ProposalResult {
        // not found or voting
        NoResult,
        // accept by committee
        Accept,
        // reject by committee
        Reject,
        // expired
        Expired,
        // params not match
        NotMatch,
        Executed
    }

    enum ProposalState {
        // default
        NotFound,
        // voting
        InProgress,
        // accept by committee
        Accepted,
        // reject by committee
        Rejected,
        Executed,
        Expired
    }

    struct Proposal {
        // propose from which group
        address fromGroup;
        // propose from who's address
        address origin;
        // when proposal expired
        uint expired;
        // members who support
        address[] support;
        // members who reject
        address[] reject;
        // state
        ProposalState state;
        // param hash root
        bytes32 paramroot;
    }

    /**
     * @dev a proposal started
     */
    event ProposalStart(uint indexed proposalId, bool fullPropose);
    /**
     * @dev a proposal accepted
     */
    event ProposalAccept(uint indexed proposalId);
    /**
     * @dev a proposal rejected
     */
    event ProposalReject(uint indexed proposalId);
    /**
     * @dev a proposal expired
     */
    event ProposalExpire(uint indexed proposalId);

    event ProposalExecuted(uint indexed proposalId);

    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event MemberChanged(address[] oldMembers, address[] newMembers);

    event ProposalVoted(
        address indexed user,
        uint indexed proposalId,
        bool support
    );

    /**
     * @dev check if someOne is a committee member now
     */
    function isMember(address someOne) external view returns (bool);

    /**
     * @dev returns all committee members
     */
    function members() external view returns (address[] memory);

    /**
     * @dev start a propose, returns a unique proposalId
     * call from a ISourceDaoGroup contract
     * @param duration declares how long proposal gets expired if not accepted or rejected
     */
    function propose(
        uint duration,
        bytes32[] memory params
    ) external returns (uint proposalId);

    function fullPropose(
        uint endBlockNumber,
        bytes32[] memory params,
        uint threshold
    ) external returns (uint proposalId);

    function endFullPropose(uint proposalId, address[] memory voters) external;

    /**
     * @dev support a propose
     * call from a member
     */
    function support(uint proposalId, bytes32[] memory params) external returns (bool);

    /**
     * @dev reject a propose
     * call from a member
     */
    function reject(uint proposalId, bytes32[] memory params) external returns (bool);

    /**
     * @dev take result of a proposal, and then remove it
     * call from a ISourceDaoGroup contract from who called propose
     */
    function takeResult(
        uint proposalId,
        bytes32[] memory params
    ) external returns (ProposalResult);

    /**
     * @dev returns proposal information of a id
     */
    function proposalOf(
        uint proposalId
    ) external view returns (Proposal memory);

    function settleProposal(uint proposalId) external returns (ProposalResult);

    function setProposalExecuted(uint proposalId) external;

    function prepareAddMember(address member) external returns (uint);

    function prepareRemoveMember(address member) external returns (uint);

    function addCommitteeMember(address member, uint proposalId) external;

    function removeCommitteeMember(address member, uint proposalId) external;

    function prepareSetCommittees(address[] calldata newCommittees) external returns (uint);
    function setCommittees(address[] calldata newCommittees, uint256 proposalId) external;

    function prepareContractUpgrade(
        address proxyContractAddress,
        address newImplementAddress
    ) external returns (uint);

    function cancelContractUpgrade(address proxyContractAddress) external;

    function verifyContractUpgrade(
        address newImplementAddress
    ) external returns (bool);

    function getContractUpgradeProposal(
        address proxyContractAddress
    ) external view returns (Proposal memory);
}

/**
 * @dev dao dev group
 */
interface ISourceDevGroup {
    enum ProjectState {
        // wating committe votes for start this project
        Preparing,
        // in development
        Developing,
        // waiting committe votes for project's result
        Accepting,
        // project has finished, check its result
        Finished
    }

    enum ProjectResult {
        // still in progress, no result
        InProgress,
        // over time after endDate
        Expired,
        // project failed
        Failed,
        // a normal result
        Normal,
        // a good result
        Good,
        // a excellent result
        Excellent
    }

    struct ProjectBrief {
        // manager of this project
        address manager;
        // waiting a committe proposal
        uint proposalId;
        // budget of this project, in token amount
        uint budget;
        // issue id referenced on git hub
        uint64 issueId;
        // start time
        uint64 startDate;
        // project deadline
        uint64 endDate;
        ProjectState state;
        ProjectResult result;
    }

    struct Contribution {
        address contributor;
        // contribution in percent
        uint64 value;
    }

    /**
     * @dev a project started, in preparing state
     */
    event ProjectCreate(uint indexed projectId, uint indexed proposalId);
    /**
     * @dev a project state changed
     */
    event ProjectChange(
        uint indexed projectId,
        uint indexed proposalId,
        ProjectState oldState,
        ProjectState newState
    );

    /**
     * @dev create a project by project manager, initializing with Preparing state, start a propose to committe
     * trigger ProjectCreate event
     */
    function createProject(
        uint budget,
        uint64 issueId,
        uint64 startDate,
        uint64 endDate
    ) external returns (uint ProjectId);

    /**
     * @dev promote to change project state if waiting a committe's proposal,
     * called by project manager who created this project,
     * call committee contract's takeResult for project's current proposalId,
     * if proposal is supported, change project state to next,
     * if proposal is rejected or expired, change project state to failed,
     * trigger ProjectChange event, Preparing => Developing / Accepting => Finished
     */
    function promoteProject(uint projectId) external;

    /**
     * @dev check and accept this project result and contribution of members, start a propose to committe ,
     * called by project manager who created this project,
     * trigger ProjectCreate event, Developing => Accepting
     */
    function acceptProject(
        uint projectId,
        ProjectResult result,
        Contribution[] calldata contributions
    ) external;

    /**
     * @dev Project managers can update contribution values throughout the vote completion phase
     */
    function updateContribute(
        uint projectId,
        Contribution calldata contribution
    ) external;

    /**
     * @dev withdraw tokens which caller's earned from contribution to all finished projects
     */
    function withdrawContributions(
        uint[] calldata projectIds
    ) external returns (uint);

    /**
     * @dev query some one's contribution percent on a project
     */
    function contributionOf(
        uint projectId,
        address who
    ) external view returns (uint);

    function projectOf(
        uint projectId
    ) external view returns (ProjectBrief memory);
}

interface IMarketingGroup {
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

    struct Contribution {
        address contributor;
        // contribution
        uint64 value;
    }

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

    /**
     * @dev create a new activity; and return a new `activityId`
     */
    function createActivity(
        uint budget,
        uint reward,
        uint64 startDate,
        uint64 endDate,
        bytes32 description
    ) external returns (uint ActivityId);

    /**
     * @dev transfer `budget` to the `principal`.
     * If the `budget` is 0, it's necessary to call `pay` to confirm the votes from committee.
     * This interface is called by the `principal` after it's accepted by committee.
     * */
    function pay(uint activityId) external;

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

    /**
     * @dev evaluate the result of the activity, will pay `reward * evaluatePercent / 100` to the contributors.
     * This interface should be called by the `principal` after the contribution is updated if there are any contributions.
     * And a proposal will be post to the committee,
     *      if the committee accept it, the `principal` can take the `reward` with the `takeReward` method and then the contributors can withdraw it with contribution.
     *      otherwise the `principal` can update the proposal by recall this interface.
     * Note: evaluatePercent <= 100
     */
    function evaluate(uint activityId, uint evaluatePercent) external;

    /**
     * @dev the committee has evaluated the activity, the `principal` take the reward in this contract.
     */
    function takeReward(uint activityId) external;

    /**
     * @dev withdraw tokens which caller's earned from contribution from ended activities.
     */
    function withdrawReward(
        uint[] calldata activityIds
    ) external returns (uint);

    /**
     * @dev query some one's contribution percent on an activity
     */
    function contributionOf(
        uint activityId,
        address who
    ) external view returns (uint);

    function activityOf(
        uint activityId
    ) external view returns (Activity memory);
}

/**
 * @dev Interface of the SourceTokenLockup.
 */
interface ISourceTokenLockup {
    /**
     * @dev Event emitted when tokens are prepared to deposit into the contract.
     * @param proposalId The proposal id that created by the SourceDaoCommittee.
     * @param duration Expiration time of the proposal, in seconds
     * @param owners The addresses of the owners
     * @param amounts The amounts of tokens to be deposit for each owner
     */
    event TokensPrepareDeposit(
        uint proposalId,
        uint duration,
        address[] owners,
        uint256[] amounts
    );

    /**
     * @dev Event emitted when tokens are deposited into the contract.
     * @param proposalId The proposal id that created by the SourceDaoCommittee.
     * @param total The total amount to be deposit
     * @param owners The addresses of the owners
     * @param amounts The amounts of tokens to be deposit for each owner
     */
    event TokensDeposited(
        uint proposalId,
        uint256 total,
        address[] owners,
        uint256[] amounts
    );

    /**
     * @dev Event emitted when tokens are prepared to unlock to the owner.
     * @param proposalId The proposal id that created by the SourceDaoCommittee.
     * @param duration Expiration time of the proposal, in seconds
     * @param owners The addresses of the owners
     * @param amounts The amounts of tokens to be unlocked for each owner
     */
    event TokensPrepareUnlock(
        uint proposalId,
        uint duration,
        address[] owners,
        uint256[] amounts
    );

    /**
     * @dev Event emitted when tokens are unlocked.
     * @param proposalId The proposal id that passed in the SourceDaoCommittee.
     * @param total The total amount to be deposit
     * @param owners The address of the owner.
     * @param amounts The amount of tokens unlocked.
     */
    event TokensUnlocked(
        uint proposalId,
        uint256 total,
        address[] owners,
        uint256[] amounts
    );

    /**
     * @dev Event emitted when tokens are claimed by certain owners.
     * @param owner The address of the owner.
     * @param amount The amount of tokens claimed.
     */
    event TokensClaimed(address indexed owner, uint256 amount);

    /**
     * @dev Get the total amount of tokens assigned to an owner.
     * This includes both locked and unlocked tokens.
     * @param owner The address of the owner.
     * @return The total amount of tokens assigned to the owner.
     */
    function totalAssigned(address owner) external view returns (uint256);

    /**
     * @dev Get the amount of unlocked tokens of an owner.
     * @param owner The address of the owner.
     * @return The amount of unlocked tokens of the owner.
     */
    function totalUnlocked(address owner) external view returns (uint256);

    /**
     * @dev Get the amount of locked tokens of an owner.
     * @param owner The address of the owner.
     * @return The amount of locked tokens of the owner.
     */
    function totalLocked(address owner) external view returns (uint256);

    /**
     * @dev Function to deposit tokens and assign them to owners.
     * Can only be called by a committee member and requires proposal approval.
     *
     * Emits a {TokensLocked} event.
     *
     * Requirements:
     *
     * - `owners` and `amounts` must have the same length.
     * - `proposalId` must be a proposal that has passed.
     * - The caller must be a committee member.
     *
     * @param duration Expiration time of the proposal, in seconds
     * @param owners The addresses of the owners
     * @param amounts The amounts of tokens to be locked for each owner
     * @return The proposal id
     */
    function prepareDepositTokens(
        uint duration,
        address[] memory owners,
        uint256[] memory amounts
    ) external returns (uint);

    /**
     * @dev Function to deposit tokens and assign them to owners.
     * Can only be called by a committee member and requires proposal approval.
     *
     * Emits a {TokensLocked} event.
     *
     * Requirements:
     *
     * - `owners` and `amounts` must have the same length.
     * - `proposalId` must be a proposal that has passed.
     * - The caller must be a committee member.
     *
     * @param proposalId The id of the proposal
     * @param owners The addresses of the owners
     * @param amounts The amounts of tokens to be locked for each owner
     */
    function depositTokens(
        uint proposalId,
        address[] memory owners,
        uint256[] memory amounts
    ) external;

    /**
     * @dev Function to unlock tokens for a set of owners.
     * Can only be called by a committee member and requires proposal approval.
     *
     * Emits a {TokensUnlocked} event.
     *
     * Requirements:
     *
     * - `owners` and `amounts` must have the same length.
     * - `proposalId` must be a proposal that has passed.
     * - The caller must be a committee member.
     *
     * @param duration Expiration time of the proposal, in seconds
     * @param owners The addresses of the owners
     * @param amounts The amounts of tokens to be unlocked for each owner
     * @return The proposal id
     */
    function prepareUnlockTokens(
        uint duration,
        address[] memory owners,
        uint256[] memory amounts
    ) external returns (uint);

    /**
     * @dev Function to unlock tokens for a set of owners.
     * Can only be called by a committee member and requires proposal approval.
     *
     * Emits a {TokensUnlocked} event.
     *
     * Requirements:
     *
     * - `owners` and `amounts` must have the same length.
     * - `proposalId` must be a proposal that has passed.
     * - The caller must be a committee member.
     *
     * @param proposalId The id of the proposal
     * @param owners The addresses of the owners
     * @param amounts The amounts of tokens to be unlocked for each owner
     */
    function unlockTokens(
        uint proposalId,
        address[] memory owners,
        uint256[] memory amounts
    ) external;

    /**
     * @dev Function to claim tokens for the caller.
     * The caller must have unlocked tokens.
     *
     * Emits a {TokensClaimed} event.
     *
     * Requirements:
     *
     * - The caller must have unlocked tokens.
     */
    function claimTokens(uint256 amount) external;
}

/**
 * @dev dao investment
 */
interface IInvestment {
    enum PriceType {
        Fixed, // Fixed price investment
        Floating // Floating price investment, token price = raisedAsset / totalTokenAmount
    }

    enum InvestmentState {
        Prepare, // Waiting for the proposal to be approved
        Started, // Started, can invest
        Successful, // Investment success
        Failed // Investment failed
    }

    struct InvestmentParams {
        // Total number of tokens for investment
        uint256 totalTokenAmount;
        PriceType priceType;
        // Token exchange rate, only valid for fixed-price investment
        uint256 tokenExchangeRate;
        // Asset exchange rate, only valid for fixed-price investment
        // Exp: tokenExchangeRate = 10, assetExchangeRate = 1, 1 asset will exchange 10 token
        uint256 assetExchangeRate;
        // Investment start time, can be 0
        uint256 startTime;
        // Investment end time, must be greater than startTime and now
        uint256 endTime;
        // Minimum investment amount per investor, initial investment must be greater than this value
        uint256 minAssetPerInvestor;
        // Maximum investment amount per investor, cumulative investments must be less than this value
        // If the investor is whitelisted, they are not subject to the limits of minAssetPerInvestor and maxAssetPerInvestor.
        uint256 maxAssetPerInvestor;
        // Target fundraising amount, if the raised funds reach this value by the end of the fundraising, it is considered a success; otherwise, it is considered a failure.
        uint256 goalAssetAmount;
        // Asset contract address for fundraising, use address(0) if it's ETH
        address assetAddress;
        // Only allow whitelist-only investments
        bool onlyWhitelist;
    }

    struct InvestmentBrief {
        // Proposal ID for starting the fundraising
        uint proposalId;
        // State of investment
        InvestmentState state;
        // Raised funds amount right now.
        uint256 raisedAssetAmount;
        InvestmentParams params;
    }

    /**
     * @dev Create a investment
     * Automatically initiate an investment proposal
     * will emit a ProposalStart event and a CreateInvestmentEvent event
     * @param proposalDuration The duration of proposal (in seconds)
     * @param params Investment params
     * @return The investment ID and proposal ID.
     */
    function createInvestment(
        uint proposalDuration,
        InvestmentParams calldata params
    ) external returns (uint, uint);

    /**
     * @dev Get token amount in this investment right now.
     * @param investmentId Investment Id
     * @return Token balance in this investment.
     */
    function getTokenBalance(uint investmentId) external view returns (uint256);

    /**
     * @dev Invest, will transferring the corresponding amount of assets from the investor's address to the contract.
     * will emit InvestEvent if successful.
     * @param investmentId The ID of the investment
     * @param assetAmount Amount of assets invested, measured in the minimum precision of that asset
     */
    function invest(uint investmentId, uint256 assetAmount) external payable;

    /**
     * @dev Withdraw subscribed tokens
     * Can only withdraw when the investment status is successful.
     * will emit WithDrawTokensEvent
     * @param investmentId The ID of the investment
     */
    function withdrawTokens(uint investmentId) external;

    /**
     * @dev Withdraw invested assets
     * Can only withdraw when the investment status is failed.
     * will emit RefundAssetEvent
     * @param investmentId The ID of the investment
     */
    function refundAsset(uint investmentId) external;

    /**
     * @dev Start a investment
     * Can only be started when the investment proposal is approved and the current time is greater than the startTime.
     * will emit InvestmentStateChangeEvent
     * @param investmentId The ID of the investment
     */
    function startInvestment(uint investmentId) external;

    /**
     * @dev Finish a investment
     * Can only be finished when the current time is greater than the endTime.
     * will emit InvestmentStateChangeEvent
     * @param investmentId The ID of the investment
     */
    function finishInvestment(uint investmentId) external;

    /**
     * @dev Initiate a proposal to abort the investment.
     * The investment status must be PREPARE or STARTED
     * will emit proposeAbortEvent
     * @param investmentId      The ID of the investment
     * @param proposalDuration  The duration of proposal (in seconds)
     * @param refund            Refund option:
     * true - Set the investment status as Failed, allowing investors to receive a refund;
     * false - Abort the investment based on whether the fundraising goal has been reached, determining the investment status.
     * @return The ID of proposal
     */
    function proposeAbortInvestment(
        uint investmentId,
        uint proposalDuration,
        bool refund
    ) external returns (uint);

    /**
     * @dev Abort the investment.
     * Can only be aborted when the state of investment is PREPARE or STARTED
     * and the abort proposal is approved.
     * will emit InvestmentStateChangeEvent
     * @param investmentId      The ID of the investment
     * @param proposalId        The ID of the proposal
     * @param refund            Refund option:
     * true - Set the investment status as Failed, allowing investors to receive a refund;
     * false - Abort the investment based on whether the fundraising goal has been reached, determining the investment status.
     */
    function abortInvestment(
        uint investmentId,
        uint proposalId,
        bool refund
    ) external;

    /**
     * @dev Add investor(s) into whitelist, can only be called by the committee
     * @param investmentId      The ID of the investment
     * @param addresses         List of investor addresses.
     * @param minLimits         List of minimum investment amount.
     * @param maxLimits         List of maximum investment amount.
     * The lengths of the three lists must be equal.
     */
    function addWhitelist(
        uint investmentId,
        address[] calldata addresses,
        uint256[] calldata minLimits,
        uint256[] calldata maxLimits
    ) external;

    /**
     * @dev Retrieve the investment limit for the addresses in whitelist.
     * can only be called by the committee
     * @param investmentId      The ID of the investment
     * @param addresses         List of addresses.
     * @return List of minimum investment amount. List of maximum investment amount.
     */
    function getWhitelistLimit(
        uint investmentId,
        address[] calldata addresses
    ) external view returns (uint256[] memory, uint256[] memory);

    /**
     * @dev Retrieve the addresses in whitelist.
     * can only be called by the committee
     * @param investmentId      The ID of the investment
     * @return List of whitelist.
     */
    function getWhitelist(
        uint investmentId
    ) external view returns (address[] memory);

    /**
     * @dev View the brief info
     * @param investmentId      The ID of the investment
     */
    function viewInvestment(
        uint investmentId
    ) external view returns (InvestmentBrief memory);

    /**
     * @dev Investor(s) view their own investment information.
     * @param investmentId      The ID of the investment
     * @return
     * Min asset limit
     * Max asset limit
     * Assets invested in this investment (if refunded, return 0)
     * Whether the subscribed tokens have been withdrawn.
     */
    function viewSelfInfo(
        uint investmentId
    ) external view returns (uint256, uint256, uint256, bool);

    /**
     * @dev Withdraw raised funds to asset wallet.
     * Will emit WithdrawAssetEvent(uint investmentId, uint assetAmount, address caller)
     * @param investmentId      The ID of the investment
     */
    function withdrawAsset(uint investmentId) external;
}

interface IMultiSigWallet {
    // Event that will be emitted whenever a new transfer is requested
    event TransferRequested(
        uint proposalId,
        uint duration,
        address token,
        address to,
        uint256 amount
    );

    // Event that will be emitted whenever a requested transfer has been executed
    event TransferExecuted(
        uint proposalId,
        address token,
        address to,
        uint256 amount
    );

    /**
     * @dev Returns the name of the wallet
     */
    function walletName() external view returns (string memory);

    /**
     * @dev Prepares a transfer of a token (or ETH), emits a TransferRequested event
     * @param duration the duration of the proposal in seconds
     * @param token the token to transfer (address(0) for ETH)
     * @param to the recipient of the transfer
     * @param amount the amount to transfer
     * @return proposalId the id of the proposal
     */
    function prepareTransfer(
        uint duration,
        address token,
        address to,
        uint256 amount
    ) external returns (uint);

    /**
     * @dev Executes a prepared transfer of a token (or ETH), emits a TransferExecuted event
     * @param proposalId the id of the proposal
     * @param token the token to transfer (address(0) for ETH)
     * @param to the recipient of the transfer
     * @param amount the amount to transfer
     */
    function executeTransfer(
        uint proposalId,
        address token,
        address to,
        uint256 amount
    ) external;

    /**
     * @dev Returns the balance of a given token (or ETH if token address is 0x0) that the contract holds
     * @param token the token to get balance for
     * @return the balance of the given token
     */
    function getTokenBalance(address token) external view returns (uint256);

    /**
     * @dev Updates the list of tokens that the contract holds
     * @param token the token to update in the list
     */
    function updateTokenList(address token) external;

    /**
     * @dev Returns the token list holded by the wallet
     */
    function getTokenList() external view returns (address[] memory);
}

interface ISourceDAOTokenDividend {
    enum DividendState {
        // init
        Disable,
        // enabl eafter the specified block number
        Enable
    }

    /// @notice Event emitted when assets are deposited
    /// @param amount The amount of tokens deposited
    /// @param token The token address
    event Deposit(uint256 amount, address token);

    /// @notice Event emitted when assets are withdrawn
    /// @param SourceAmount The amount of Source tokens burned
    event Withdraw(address to, uint256 SourceAmount);

    /// @notice Event emitted when devidend enable state been requested
    /// @param proposalId the id of the proposal
    /// @param state the new devidend state of the contract
    /// @param blockNumber the devidend state will enable after the blockNumber
    event DividendStateChangeRequested(
        uint proposalId,
        DividendState state,
        uint256 blockNumber
    );

    /// @notice Event emitted when devidend enable state changed
    /// @param state the new devidend state of the contract
    /// @param blockNumber the devidend state will enable after the blockNumber
    event DividendStateChanged(DividendState state, uint256 blockNumber);

    /// @notice Receive ETH deposits
    receive() external payable;

    /// @notice Deposit tokens to the contract
    /// @param amount The amount of tokens to deposit
    /// @param token The token to deposit
    function deposit(uint256 amount, address token) external;

    /// @notice Update token balance for the contract
    /// @param token The token to deposit
    function updateTokenBalance(address token) external;

    /// @notice Get the estimated assets per Source token
    /// @return tokens The list of tokens the contract holds
    /// @return amounts The amount of each token that can be claimed per Source token
    function estimate()
        external
        view
        returns (address[] memory tokens, uint256[] memory amounts);

    /// @notice Withdraw assets from the contract
    /// @param SourceAmount The amount of Source tokens to burn
    function withdraw(uint256 SourceAmount) external;

    /// @notice Check if the dividend operation is currently allowed
    /// @return enable The dividend is anable or not
    function isDividendEnable() external view returns (bool enable);

    /// @notice Change the devidend state of the contract
    /// @param duration the duration of the proposal in seconds
    /// @param _state the new devidend state of the contract
    /// @param blockNumber the devidend state will enable after the blockNumber
    /// @return proposalId the id of the proposal
    function prepareChangeState(
        uint duration,
        DividendState _state,
        uint256 blockNumber
    ) external returns (uint proposalId);

    function changeState(
        uint proposalId,
        DividendState _state,
        uint256 blockNumber
    ) external;
}

interface ITwoStepWhitelistInvestment {
    struct TokenRatio {
        uint256 tokenAmount;
        uint256 daoTokenAmount;
    }

    struct startInvestmentParam {
        address[] whitelist;
        uint16[] firstPercent;
        address tokenAddress;
        uint256 tokenAmount;
        TokenRatio tokenRatio;
        uint256 step1Duration;
        uint256 step2Duration;
        bool canEndEarly;
    }

    struct InvestmentInfo {
        address investor;
        address tokenAddress;
        TokenRatio tokenRatio;
        uint256 totalAmount;
        uint256 investedAmount;
        uint256 daoTokenAmount;
        uint256 step1EndTime;
        uint256 step2EndTime;
        bool canEndEarly;
        bool end;
    }

    function startInvestment(startInvestmentParam calldata param) external payable;
    function endInvestment(uint256 investmentId) external;
    function invest(uint256 investmentId, uint256 amount) external;
    function getInvestmentInfo(uint256 investmentId) external view returns (InvestmentInfo memory);
    function isInWhiteList(uint256 investmentId, address addr) external view returns (bool);
    function getAddressPercent(uint256 investmentId, address addr) external view returns (uint256);
    function getAddressInvestedAmount(uint256 investmentId, address addr) external view returns (uint256);
    function getAddressLeftAmount(uint256 investmentId, address addr) external view returns (uint256);
}

/**
 * @dev dao dev group
 */
interface ISourceDao {
    /**
     * @dev DAO token contract address
     */
    function token() external view returns (ISourceDAOToken);

    function isAuthorizedAddress(address addr) external view returns (bool);

    /**
     * @dev DAO committee contract address, to approval daily events
     */
    function committee() external view returns (ISourceDaoCommittee);

    /**
     * @dev DAO develop contract address, to manage developing projects
     */
    function devGroup() external view returns (ISourceDevGroup);

    /**
     * @dev DAO ERC2O token lockup contract address, to manage developing projects
     */
    function lockup() external view returns (ISourceTokenLockup);

    function dividend() external view returns (ISourceDAOTokenDividend);

    function investment() external view returns (IInvestment);

    function committeeWallet() external view returns (address);

    function assetWallet() external view returns (IMultiSigWallet);

    function incomeWallet() external view returns (IMultiSigWallet);

    function twostepInvestment() external view returns (ITwoStepWhitelistInvestment); 

    function perpareSetCommitteeWallet(address walletAddress) external;

    function perpareSetAssetWallet(address walletAddress) external;

    function perpareSetIncomeWallet(address walletAddress) external;

    function setCommitteeWallet(
        address walletAddress,
        uint proposalId
    ) external;

    function setAssetWallet(address walletAddress, uint proposalId) external;

    function setIncomeWallet(address walletAddress, uint proposalId) external;
}
