// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "./SourceDaoUpgradeable.sol";
import "./Interface.sol";

contract Investment is
    IInvestment,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    SourceDaoContractUpgradeable
{
    /**
     * The minimum and maximum values limit for the whitelist.
     * If no individual limits are set, they must adhere to the rules outlined in the investment guidelines.
     */
    struct InvestAssetLimit {
        // The minimum value is set to 1 by default.
        uint256 minLimit;
        // The maximum value can be set as 0, indicating no limit.
        // However, if the maximum value is not 0, it must be greater than or equal to the minimum value.
        uint256 maxLimit;
    }

    struct Investor {
        // Total invested assets by the investor.
        uint256 assetInvested;
        // Whether the daoToken has been withdrawn.
        bool tokenWithdrawn;
    }

    struct InvestmentDetail {
        uint proposalId;
        InvestmentState state;
        // Total amount of funds raised, in minimum precision.
        uint256 raisedAssetAmount;
        // Whether the fundraising assets have been withdrawn.
        bool assetWithdrawn;
        InvestmentParams params;
        // The current remaining quantity of daoTokens in the investment.
        uint256 tokenBalance;
        // Investor list, recording the amount of assets each investor has contributed and whether they have already withdrawn the daoTokens.
        mapping(address => Investor) investors;
        mapping(address => InvestAssetLimit) whitelistLimit;
        address[] whitelist;
    }

    mapping(uint => InvestmentDetail) private investmentList;

    uint private investmentCount;

    event CreateInvestmentEvent(uint investmentId, uint proposalId);
    event InvestEvent(uint investmentId, uint256 assetAmount, address investor);
    event WithdrawTokensEvent(
        uint investmentId,
        uint256 assetInvested,
        uint256 tokenAmount,
        address investor
    );
    event RefundAssetEvent(
        uint investmentId,
        uint256 assetAmount,
        address investor
    );
    event InvestmentStateChangeEvent(
        uint investmentId,
        InvestmentState oldState,
        InvestmentState newState
    );
    event proposeAbortEvent(
        uint investmentId,
        uint proposalId,
        bool refund,
        address promoter
    );
    event BurnTokenEvent(uint investmentId, uint burnAmount, address caller);
    event WithdrawAssetEvent(
        uint investmentId,
        uint assetAmount,
        address caller
    );

    modifier onlyCommitteeMember() {
        require(
            getMainContractAddress().committee().isMember(msg.sender),
            "Not a committee member"
        );
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __SourceDaoContractUpgradable_init();
        investmentCount = 0;
    }

    /**
     * @dev Create a investment
     * @return Investment ID，proposal ID
     */
    function createInvestment(
        uint proposalDuration,
        InvestmentParams calldata params
    ) external onlyCommitteeMember nonReentrant returns (uint, uint) {
        require(params.totalTokenAmount > 0, "TotalTokenAmount <= 0");
        require(
            params.tokenExchangeRate > 0 && params.assetExchangeRate > 0,
            "Price not valid"
        );
        require(params.startTime >= 0, "StartTime < 0");
        require(
            params.endTime > params.startTime &&
                params.endTime > block.timestamp,
            "Endtime is not valid"
        );
        require(params.goalAssetAmount > 0, "GoalAssetAmount <= 0");
        require(proposalDuration > 0, "ProposalDuration <= 0");
        if (params.priceType == PriceType.Fixed) {
            require(
                params.tokenExchangeRate > 0 && params.assetExchangeRate > 0,
                "Price not valid"
            );
            require(
                (params.totalTokenAmount * params.assetExchangeRate) /
                    params.tokenExchangeRate >=
                    params.goalAssetAmount,
                "GoalAssetAmount not valid"
            );
        }
        if (params.maxAssetPerInvestor > 0) {
            require(
                params.maxAssetPerInvestor >= params.minAssetPerInvestor,
                "MaxAssetPerInvestor < MinAssetPerInvestor"
            );
        }

        uint investmentId = ++investmentCount;
        investmentList[investmentId].params = params;
        investmentList[investmentId].raisedAssetAmount = 0;
        investmentList[investmentId].state = InvestmentState.Prepare;
        investmentList[investmentId].assetWithdrawn = false;

        bytes32[] memory packParams = _packProposeParams(investmentId, params);

        uint proposalId = getMainContractAddress().committee().propose(
            proposalDuration,
            packParams
        );

        investmentList[investmentId].proposalId = proposalId;

        emit CreateInvestmentEvent(investmentId, proposalId);

        return (investmentId, proposalId);
    }

    function _boolToBytes32(bool value) public pure returns (bytes32) {
        bytes32 result;
        assembly {
            result := value
        }
        return result;
    }

    function _packProposeParams(
        uint investmentId,
        InvestmentParams memory params
    ) internal pure returns (bytes32[] memory) {
        bytes32[] memory packParams = new bytes32[](11);
        packParams[0] = bytes32(uint(investmentId));
        packParams[1] = bytes32(uint256(params.totalTokenAmount));
        packParams[2] = bytes32(uint(params.priceType));
        packParams[2] = bytes32(uint256(params.tokenExchangeRate));
        packParams[3] = bytes32(uint256(params.assetExchangeRate));
        packParams[4] = bytes32(uint256(params.startTime));
        packParams[5] = bytes32(uint256(params.endTime));
        packParams[6] = bytes32(uint256(params.goalAssetAmount));
        packParams[7] = bytes32(uint256(params.minAssetPerInvestor));
        packParams[8] = bytes32(uint256(params.maxAssetPerInvestor));
        packParams[9] = bytes32(bytes20(params.assetAddress));
        packParams[10] = _boolToBytes32(params.onlyWhitelist);
        return packParams;
    }

    /**
     * Retrieve the remaining quantity of daoTokens available for subscription.
     * Calculated in the minimum precision.
     * This applies only to fixed-price investment
     */
    function getAvailableTokenAmount(
        uint investmentId
    ) public view returns (uint256) {
        InvestmentDetail storage investment = investmentList[investmentId];
        InvestmentParams storage params = investment.params;

        require(params.priceType == PriceType.Fixed, "Not fixed price");
        require(investment.state == InvestmentState.Started, "Not started");
        require(block.timestamp <= params.endTime, "Already closed");

        uint256 tokenAllocated = (investment.raisedAssetAmount *
            params.tokenExchangeRate) / params.assetExchangeRate;
        uint256 available = params.totalTokenAmount - tokenAllocated;
        return available;
    }

    /**
     * Retrieve the current remaining quantity of daoTokens in the investment.
     */
    function getTokenBalance(
        uint investmentId
    ) external view returns (uint256) {
        InvestmentDetail storage investment = investmentList[investmentId];

        return investment.tokenBalance;
    }

    function checkAssetAmount(
        uint investmentId,
        uint256 assetAmount
    ) internal view {
        InvestmentDetail storage investment = investmentList[investmentId];
        InvestmentParams storage params = investment.params;

        require(assetAmount > 0, "AssetAmount <= 0");

        if (params.priceType == PriceType.Fixed) {
            uint256 tokenBuyAmount = (assetAmount * params.tokenExchangeRate) /
                params.assetExchangeRate;
            require(
                tokenBuyAmount <= getAvailableTokenAmount(investmentId),
                "No enough token"
            );
        }

        uint256 minAssetLimit = params.minAssetPerInvestor;
        uint256 maxAssetLimit = params.maxAssetPerInvestor;

        // For whitelist members, separate restriction logic is applied.
        if (investment.whitelistLimit[msg.sender].minLimit > 0) {
            minAssetLimit = investment.whitelistLimit[msg.sender].minLimit;
            if (investment.whitelistLimit[msg.sender].maxLimit > 0) {
                maxAssetLimit = investment.whitelistLimit[msg.sender].maxLimit;
            }
        }

        // For the first investment, the amount must be greater than the minimum limit.
        if (investment.investors[msg.sender].assetInvested == 0) {
            require(assetAmount >= minAssetLimit, "Amount < MinLimit");
        }

        // The cumulative investment cannot exceed the limit.
        if (maxAssetLimit > 0) {
            require(
                investment.investors[msg.sender].assetInvested + assetAmount <=
                    maxAssetLimit,
                "Amount > MaxLimit"
            );
        }
    }

    /**
     * @dev Investors can make investments using either ERC20 tokens or Ether.
     * @param investmentId    Investment ID
     * @param assetAmount     The amount of funds to be invested, calculated in the minimum precision.
     */
    function invest(
        uint investmentId,
        uint256 assetAmount
    ) external payable nonReentrant {
        InvestmentDetail storage investment = investmentList[investmentId];
        InvestmentParams storage params = investment.params;

        require(investment.state == InvestmentState.Started, "Not started");
        require(block.timestamp <= params.endTime, "Already closed");

        if (params.onlyWhitelist) {
            require(
                investment.whitelistLimit[msg.sender].minLimit > 0,
                "Only white list"
            );
        }

        checkAssetAmount(investmentId, assetAmount);

        if (params.assetAddress == address(0)) {
            require(msg.value == assetAmount, "Amount not match");
            //(bool result, ) = address(this).call{value: assetAmount}("");
            //require(result, "Failed to invest");
        } else {
            IERC20Upgradeable(params.assetAddress).transferFrom(
                msg.sender,
                address(this),
                assetAmount
            );
        }

        investment.raisedAssetAmount += assetAmount;
        investment.investors[msg.sender].assetInvested += assetAmount;
        emit InvestEvent(investmentId, assetAmount, msg.sender);
    }

    // WithdrawDaoToken，can only be made upon successful investment.
    function withdrawTokens(uint investmentId) external nonReentrant {
        InvestmentDetail storage investment = investmentList[investmentId];
        InvestmentParams storage params = investment.params;
        Investor storage investor = investment.investors[msg.sender];

        require(
            investment.state == InvestmentState.Successful,
            "Cannot withdraw right now"
        );
        require(investor.assetInvested > 0, "Did not invest");
        require(!investor.tokenWithdrawn, "Already withdrawn");
        require(
            investor.assetInvested <= investment.raisedAssetAmount,
            "Something wrong"
        );

        uint256 tokenAmount = 0;
        if (params.priceType == PriceType.Fixed) {
            tokenAmount =
                (investor.assetInvested * params.tokenExchangeRate) /
                params.assetExchangeRate;
        } else {
            if (investor.assetInvested == investment.raisedAssetAmount) {
                tokenAmount = params.totalTokenAmount;
            } else {
                uint256 temp = params.totalTokenAmount * investor.assetInvested;
                if (temp / investor.assetInvested == params.totalTokenAmount) {
                    // No overflow
                    tokenAmount = temp / investment.raisedAssetAmount;
                } else {
                    // overflow
                    uint256 mul = (investment.raisedAssetAmount /
                        investor.assetInvested) + 1;
                    tokenAmount =
                        (((investor.assetInvested * mul) /
                            investment.raisedAssetAmount) *
                            params.totalTokenAmount) /
                        mul;
                }
            }
        }

        if (tokenAmount >= investment.tokenBalance) {
            tokenAmount = investment.tokenBalance;
        }
        require(tokenAmount > 0, "Token amount = 0");

        investment.investors[msg.sender].tokenWithdrawn = true;
        investment.tokenBalance -= tokenAmount;
        bool transResult = getMainContractAddress().token().transfer(
            msg.sender,
            tokenAmount
        );

        require(transResult, "Transfer failed");
        emit WithdrawTokensEvent(
            investmentId,
            investor.assetInvested,
            tokenAmount,
            msg.sender
        );
    }

    // Refund asset, can be refund only in the case of investment failure.
    function refundAsset(uint investmentId) external nonReentrant {
        InvestmentDetail storage investment = investmentList[investmentId];
        Investor storage investor = investment.investors[msg.sender];
        address assetAddress = investment.params.assetAddress;
        uint256 assetInvested = investor.assetInvested;

        require(
            investment.state == InvestmentState.Failed,
            "Cannot refund right now"
        );
        require(assetInvested > 0, "No asset to refund");

        investment.investors[msg.sender].assetInvested = 0;

        if (assetAddress == address(0)) {
            //payable(msg.sender).transfer(assetInvested);
            (bool success, ) = msg.sender.call{value: assetInvested}("");
            require(success, "Failed to withdraw");
        } else {
            bool result = IERC20Upgradeable(assetAddress).transfer(
                msg.sender,
                assetInvested
            );
            require(result, "Failed to withdraw");
        }

        emit RefundAssetEvent(investmentId, assetInvested, msg.sender);
    }

    function startInvestment(uint investmentId) external nonReentrant {
        InvestmentDetail storage investment = investmentList[investmentId];
        uint proposalId = investment.proposalId;
        InvestmentParams memory params = investment.params;
        bytes32[] memory packParams = _packProposeParams(investmentId, params);
        ISourceDaoCommittee.ProposalResult result = getMainContractAddress()
            .committee()
            .takeResult(proposalId, packParams);

        require(
            result == ISourceDaoCommittee.ProposalResult.Accept,
            "Proposal not accept"
        );
        require(
            investment.state == InvestmentState.Prepare,
            "State is not PREPARE"
        );
        require(params.totalTokenAmount > 0, "TotalTokenAmount <= 0");
        require(
            block.timestamp >= params.startTime &&
                block.timestamp < params.endTime,
            "Not start time"
        );

        InvestmentState oldState = investment.state;
        investment.state = InvestmentState.Started;

        // Transfer the tokens used for investment.
        getMainContractAddress().token().releaseTokensToSelf(
            params.totalTokenAmount
        );
        investment.tokenBalance = params.totalTokenAmount;

        emit InvestmentStateChangeEvent(
            investmentId,
            oldState,
            investment.state
        );
    }

    function finishInvestment(uint investmentId) external nonReentrant {
        _finishInvestmentImpl(investmentId, false);
    }

    function _finishInvestmentImpl(uint investmentId, bool force) private {
        InvestmentDetail storage investment = investmentList[investmentId];
        InvestmentParams storage params = investment.params;
        require(
            investment.state == InvestmentState.Started ||
                investment.state == InvestmentState.Prepare,
            "Alreay closed"
        );
        if (!force) {
            require(block.timestamp >= params.endTime, "Not the end time");
        }

        InvestmentState oldState = investment.state;
        if (investment.raisedAssetAmount >= params.goalAssetAmount) {
            investment.state = InvestmentState.Successful;
            emit InvestmentStateChangeEvent(
                investmentId,
                oldState,
                InvestmentState.Successful
            );
        } else {
            investment.state = InvestmentState.Failed;
            emit InvestmentStateChangeEvent(
                investmentId,
                oldState,
                InvestmentState.Failed
            );
        }
    }

    /**
     * @dev Initiate a proposal to abort the investment.
     * @param investmentId      Investment ID
     * @param proposalDuration  Duration of the proposal.
     * @param refund            Whether to process refunds.
                                If set to "true," the investment will directly fail, and investors will be eligible for a refund.
                                If set to "false," the current investment will be terminated early, and success or failure will be determined based on whether the investment goal has been reached.
     * @return Proposal ID
     */
    function proposeAbortInvestment(
        uint investmentId,
        uint proposalDuration,
        bool refund
    ) external onlyCommitteeMember nonReentrant returns (uint) {
        InvestmentDetail storage investment = investmentList[investmentId];
        InvestmentParams storage params = investment.params;
        require(
            investment.state == InvestmentState.Started ||
                investment.state == InvestmentState.Prepare,
            "Already closed"
        );
        require(block.timestamp < params.endTime, "Already closed");
        require(proposalDuration > 0, "Proposal duration <= 0");

        bytes32[] memory proposalParams = new bytes32[](2);
        proposalParams[0] = bytes32(uint(investmentId));
        proposalParams[1] = _boolToBytes32(refund);
        uint abortProposalId = getMainContractAddress().committee().propose(
            proposalDuration,
            proposalParams
        );

        emit proposeAbortEvent(
            investmentId,
            abortProposalId,
            refund,
            msg.sender
        );

        return abortProposalId;
    }

    function abortInvestment(
        uint investmentId,
        uint proposalId,
        bool refund
    ) external nonReentrant {
        InvestmentDetail storage investment = investmentList[investmentId];
        require(
            investment.state == InvestmentState.Started ||
                investment.state == InvestmentState.Prepare,
            "Already closed"
        );
        require(block.timestamp < investment.params.endTime, "Already closed");

        bytes32[] memory params = new bytes32[](2);
        params[0] = bytes32(uint(investmentId));
        params[1] = _boolToBytes32(refund);

        ISourceDaoCommittee.ProposalResult result = getMainContractAddress()
            .committee()
            .takeResult(proposalId, params);

        require(
            result == ISourceDaoCommittee.ProposalResult.Accept,
            "Proposal not be accepted"
        );

        if (refund) {
            InvestmentState oldState = investment.state;
            investment.state = InvestmentState.Failed;
            emit InvestmentStateChangeEvent(
                investmentId,
                oldState,
                InvestmentState.Failed
            );
        } else {
            _finishInvestmentImpl(investmentId, true);
        }
    }

    /**
     * @dev add a whitelist member
     * @param investmentId      Investment ID
     * @param addresses         Whitelist address list
     * @param minAssetLimits    Corresponding minimum amount list, calculated in the minimum precision.
     * @param maxAssetLimits    Corresponding maximum amount list, calculated in the minimum precision.
     */
    function addWhitelist(
        uint investmentId,
        address[] calldata addresses,
        uint256[] calldata minAssetLimits,
        uint256[] calldata maxAssetLimits
    ) external onlyCommitteeMember {
        InvestmentDetail storage investment = investmentList[investmentId];
        require(
            investment.state == InvestmentState.Prepare ||
                investment.state == InvestmentState.Started,
            "Already closed"
        );
        require(
            addresses.length == minAssetLimits.length &&
                addresses.length == maxAssetLimits.length,
            "Length not equal"
        );

        for (uint256 i = 0; i < addresses.length; i++) {
            require(
                minAssetLimits[i] >= 0 &&
                    (maxAssetLimits[i] >= minAssetLimits[i] ||
                        maxAssetLimits[i] == 0),
                "Params not valid"
            );
            if (investment.whitelistLimit[addresses[i]].minLimit == 0) {
                investment.whitelist.push(addresses[i]);
            }
            if (minAssetLimits[i] > 0) {
                investment
                    .whitelistLimit[addresses[i]]
                    .minLimit = minAssetLimits[i];
            } else {
                investment.whitelistLimit[addresses[i]].minLimit = 1;
            }
            investment.whitelistLimit[addresses[i]].maxLimit = maxAssetLimits[
                i
            ];
        }
    }

    function getWhitelistLimit(
        uint investmentId,
        address[] calldata addresses
    )
        external
        view
        onlyCommitteeMember
        returns (uint256[] memory, uint256[] memory)
    {
        InvestmentDetail storage investment = investmentList[investmentId];

        uint256[] memory minLimits = new uint256[](addresses.length);
        uint256[] memory maxLimits = new uint256[](addresses.length);
        for (uint256 i = 0; i < addresses.length; i++) {
            minLimits[i] = investment.whitelistLimit[addresses[i]].minLimit;
            maxLimits[i] = investment.whitelistLimit[addresses[i]].maxLimit;
        }

        return (minLimits, maxLimits);
    }

    function getWhitelist(
        uint investmentId
    ) external view onlyCommitteeMember returns (address[] memory) {
        InvestmentDetail storage investment = investmentList[investmentId];

        return investment.whitelist;
    }

    function viewInvestment(
        uint investmentId
    ) external view returns (InvestmentBrief memory) {
        InvestmentDetail storage investment = investmentList[investmentId];
        InvestmentBrief memory brief = InvestmentBrief(
            investment.proposalId,
            investment.state,
            investment.raisedAssetAmount,
            investment.params
        );

        return brief;
    }

    function viewSelfInfo(
        uint investmentId
    ) external view returns (uint256, uint256, uint256, bool) {
        InvestmentDetail storage investment = investmentList[investmentId];
        uint256 minLimit = investment.params.minAssetPerInvestor;
        uint256 maxLimit = investment.params.maxAssetPerInvestor;
        if (investment.whitelistLimit[msg.sender].minLimit > 0) {
            minLimit = investment.whitelistLimit[msg.sender].minLimit;
            maxLimit = investment.whitelistLimit[msg.sender].maxLimit;
        }
        return (
            minLimit,
            maxLimit,
            investment.investors[msg.sender].assetInvested,
            investment.investors[msg.sender].tokenWithdrawn
        );
    }

    function viewInvestorsInfo(
        uint investmentId,
        address[] calldata investors
    )
        public
        view
        onlyCommitteeMember
        returns (uint256[] memory, bool[] memory)
    {
        InvestmentDetail storage investment = investmentList[investmentId];
        uint256[] memory investeds = new uint256[](investors.length);
        bool[] memory withdrawns = new bool[](investors.length);
        for (uint256 i = 0; i < investors.length; i++) {
            investeds[i] = investment.investors[investors[i]].assetInvested;
            withdrawns[i] = investment.investors[investors[i]].tokenWithdrawn;
        }
        return (investeds, withdrawns);
    }

    // Burn the remaining tokens, which can be due to either a failed investment or the surplus after a successful fixed-price investment.
    function burnUnAllocatedTokens(
        uint investmentId
    ) public onlyCommitteeMember nonReentrant {
        InvestmentDetail storage investment = investmentList[investmentId];
        InvestmentParams storage params = investment.params;
        require(
            investment.state == InvestmentState.Successful ||
                investment.state == InvestmentState.Failed,
            "Not finished"
        );

        uint256 burnAmount = 0;
        if (investment.state == InvestmentState.Failed) {
            require(
                params.totalTokenAmount == investment.tokenBalance,
                "Token amount error"
            );
            burnAmount = investment.tokenBalance;
        } else {
            require(params.priceType == PriceType.Fixed, "Price type error");
            // Calculate the remaining number of tokens.
            uint256 allocatedAmount = (investment.raisedAssetAmount *
                params.tokenExchangeRate) / params.assetExchangeRate;
            burnAmount = params.totalTokenAmount - allocatedAmount;
            if (burnAmount >= investment.tokenBalance) {
                burnAmount = investment.tokenBalance;
            }
        }

        getMainContractAddress().token().burn(burnAmount);
        investment.tokenBalance -= burnAmount;
        emit BurnTokenEvent(investmentId, burnAmount, msg.sender);
    }

    // Withdraw to the asset wallet.
    function withdrawAsset(uint investmentId) external nonReentrant {
        InvestmentDetail storage investment = investmentList[investmentId];
        require(
            investment.state == InvestmentState.Successful,
            "Not successful"
        );
        require(!investment.assetWithdrawn, "Already withdraw");

        uint256 raisedAssetAmount = investment.raisedAssetAmount;

        require(raisedAssetAmount > 0, "Raised asset amount <= 0");

        address to = address(getMainContractAddress().assetWallet());
        investment.assetWithdrawn = true;
        if (investment.params.assetAddress == address(0)) {
            (bool success, ) = to.call{value: raisedAssetAmount}("");
            require(success, "Failed to withdraw");
        } else {
            bool result = IERC20Upgradeable(investment.params.assetAddress)
                .transfer(to, raisedAssetAmount);
            require(result, "Failed to withdraw");
        }
        emit WithdrawAssetEvent(investmentId, raisedAssetAmount, msg.sender);
    }
}
