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

    function dev2normal(uint256 amount) external;
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
     * @dev dev ratio changed
     * @param oldDevRatio the old dev ratio
     * @param newDevRatio the new dev ratio
     */
    event DevRatioChanged(
        uint oldDevRatio,
        uint newDevRatio);
        
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
        uint duration,
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

    function prepareSetCommittees(address[] calldata newCommittees, bool isFullProposal) external returns (uint);
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
interface ISourceProject {
    enum ProjectState {
        // wating committe votes for start this project
        Preparing,
        // in development
        Developing,
        // waiting committe votes for project's result
        Accepting,
        // project has finished, check its result
        Finished,
        // project failed
        Rejected
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
        // project name in string, max 32 bytes
        bytes32 projectName;
        // version in uint64, convert from a.b.c: a*10000000000+b*100000+c
        uint64 version;
        // start time
        uint64 startDate;
        // project deadline
        uint64 endDate;
        ProjectState state;
        ProjectResult result;
        address[] extraTokens;
        uint256[] extraTokenAmounts;
    }

    struct Contribution {
        address contributor;
        // contribution in percent
        uint64 value;
    }

    struct VersionInfo {
        uint64 version;
        uint256 versionTime;
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
        bytes32 name, 
        uint64 version,
        uint64 startDate,
        uint64 endDate, 
        address[] calldata extraTokens, 
        uint256[] calldata extraTokenAmounts
    ) external returns (uint ProjectId);

    function cancelProject(uint projectId) external;

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

    function latestProjectVersion(bytes32 projectName) external view returns(VersionInfo memory);

    // 判定指定版本是否已经发布，如果未发布，返回0，如果发布，返回发布时间
    function versionReleasedTime(bytes32 projectName, uint64 version) external view returns(uint256);
}

/**
 * @dev Interface of the SourceTokenLockup.
 */
interface ISourceTokenLockup {
    /**
     * @dev Event emitted when tokens are prepared to unlock to the owner.
     * @param proposalId The proposal id that created by the SourceDaoCommittee.
     * @param duration Expiration time of the proposal, in seconds
     */
    event TokensPrepareUnlock(
        uint proposalId,
        uint duration
    );

    /**
     * @dev Event emitted when tokens are unlocked.
     * @param proposalId The proposal id that passed in the SourceDaoCommittee.
     * @param total The total amount to be deposit
     */
    event TokensUnlocked(
        uint proposalId,
        uint256 total
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
    function totalClaimed(address owner) external view returns (uint256);

    function transferAndLock(address[] calldata to, uint256[] calldata amount) external;
    function convertAndLock(address[] calldata to, uint256[] calldata amount) external;

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

    function getCanClaimTokens() external view returns (uint256);
}

interface ISourceDAODividend {
    struct RewardInfo {
        address token;
        uint256 amount;
    }

    struct CycleInfo {
        // The start block of the cycle
        uint256 startBlocktime;

        // The total stake amount of the curent cycle
        uint256 totalStaked;

        // The reward info of the cycle       
        RewardInfo[] rewards;
    }

    struct RewardWithdrawInfo {
        address token;
        uint256 amount;
        bool withdrawed;
    }

    event TokenAddedToWhitelist(address token);
    event TokenRemovedFromWhitelist(address token);
    event Deposit(uint256 amount, address token);
    event Stake(address indexed user, uint256 amount);
    event Unstake(address indexed user, uint256 amount);
    event NewCycle(uint256 cycleIndex, uint256 startBlock);
    event Withdraw(address indexed user, address token, uint256 amount);

    /// @notice Receive ETH deposits
    receive() external payable;

    function getCurrentCycleIndex() external view returns (uint256);

    function getCurrentCycle() external view returns (CycleInfo memory);
    function getCycleInfos(uint256 startCycle, uint256 endCycle) external view returns (CycleInfo[] memory);
    function getTotalStaked(uint256 cycleIndex) external view returns (uint256);
    function getDepositTokenBalance(address token) external view returns (uint256);

    function deposit(uint256 amount, address token) external;
    function updateTokenBalance(address token) external;

    function getStakeAmount(uint256 cycleIndex) external view returns (uint256);

    function stakeNormal(uint256 amount) external;
    function stakeDev(uint256 amount) external;
    function unstakeNormal(uint256 amount) external;
    function unstakeDev(uint256 amount) external;

    function tryNewCycle() external;

    function isDividendWithdrawed(uint256 cycleIndex, address token) external view returns (bool);
    function estimateDividends(uint256[] calldata cycleIndexs, address[] calldata tokens) external view returns (RewardWithdrawInfo[] memory);

    function withdrawDividends(uint256[] calldata cycleIndexs, address[] calldata tokens) external;
}

interface IAcquired {
    /**
     * TokenRatio为标准代币单位，不涉及到代币精度，精度在合约内部自动处理
     * 例：使用1 USDC收购1 DAO Token，则TokenRatio为{tokenAmount: 1, daoTokenAmount: 1}
     * 例：使用0.5 USDC收购1 DAO Token，则TokenRatio为{tokenAmount: 5, daoTokenAmount: 10}
     */
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

    function dividend() external view returns (ISourceDAODividend);

    function acquired() external view returns (IAcquired);

    function isDAOContract(address addr) external view returns (bool);
    /**
     * @dev Set the address of the dev token contract.
     * @param newAddress The address of the new dev token contract.
     */

    /**
     * Transfer is restricted to certain addresses or conditions.
     * This event is emitted when a transfer is restricted.
     * @param from The address from which the tokens are transferred.
     * @param to The address to which the tokens are transferred.
     * @param amount The amount of tokens transferred.
     */
    event TransferRestricted(
        address indexed from,
        address indexed to,
        uint256 amount
    );
}
