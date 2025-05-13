// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title ISourceDAOToken interface
 * @dev Describes the public methods available for the SourceDAOToken
 */
interface ISourceDAONormalToken is IERC20, IERC20Metadata {
    /**
     * @dev Get the total amount of tokens in circulation.
     * @return Total amount of tokens in circulation.
     */
    function totalInCirculation() external view returns (uint256);

    /**
     * @dev Mint normal tokens to a specified address.
     * @param to The address to mint tokens to.
     * @param amount The amount of tokens to mint.
     */
    function mintNormalToken(address to, uint256 amount) external;
}

interface ISourceDAODevToken is IERC20, IERC20Metadata {
    /**
     * @dev "mint" dev token to caller. Only project contract can call this.
     * @param amount The amount of tokens to be "mint".
     */
    function mintDevToken(uint256 amount) external;

    function totalReleased() external view returns (uint256);
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
        Inprogress,
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

    function perpareAddMember(address member) external returns (uint);

    function perpareRemoveMember(address member) external returns (uint);

    function addCommitteeMember(address member, uint proposalId) external;

    function removeCommitteeMember(address member, uint proposalId) external;

    function prepareSetCommittees(address[] calldata newCommittees) external returns (uint);
    function setCommittees(address[] calldata newCommittees, uint256 proposalId) external;

    function perpareContractUpgrade(
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
interface ISourceProject {
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
        Inprogress,
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

/**
 * @dev Interface of the SourceTokenLockup.
 */
interface ISourceTokenLockup {
    /**
     * @dev Event emitted when tokens are prepared to unlock to the owner.
     * @param proposalId The proposal id that created by the SourceDaoCommittee.
     * @param duration Expiration time of the proposal, in seconds
     * @param owners The addresses of the owners
     */
    event TokensPrepareUnlock(
        uint proposalId,
        uint duration,
        address[] owners
    );

    /**
     * @dev Event emitted when tokens are unlocked.
     * @param proposalId The proposal id that passed in the SourceDaoCommittee.
     * @param total The total amount to be deposit
     * @param owners The address of the owner.
     */
    event TokensUnlocked(
        uint proposalId,
        uint256 total,
        address[] owners
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

    function transferAndLock(address[] calldata to, uint256[] calldata amount) external;

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
     * @return The proposal id
     */
    function prepareUnlockTokens(
        uint duration,
        address[] memory owners
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
     */
    function unlockTokens(
        uint proposalId,
        address[] memory owners
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

interface IAcquired {
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
    function endInventment(uint256 investmentId) external;
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
    function devToken() external view returns (ISourceDAODevToken);
    function normalToken() external view returns (ISourceDAONormalToken);

    /**
     * @dev DAO committee contract address, to approval daily events
     */
    function committee() external view returns (ISourceDaoCommittee);

    /**
     * @dev DAO develop contract address, to manage developing projects
     */
    function project() external view returns (ISourceProject);

    /**
     * @dev DAO ERC2O token lockup contract address, to manage developing projects
     */
    function lockup() external view returns (ISourceTokenLockup);

    function dividend() external view returns (ISourceDAOTokenDividend);

    function acquired() external view returns (IAcquired); 
}
