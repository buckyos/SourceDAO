// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./SourceDaoUpgradeable.sol";
import "./Interface.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import "hardhat/console.sol";
import "./util.sol";

// 委员会
contract SourceDaoCommittee is ISourceDaoCommittee, SourceDaoContractUpgradeable {
    // Monotonic proposal id cursor.
    uint curProposalId;
    // Current live committee set.
    address[] committees;

    // Core proposal storage.
    mapping(uint => Proposal) proposals;
    mapping(uint => ProposalExtra) proposalExtras;
    mapping(uint => mapping(address => int)) proposalVotes;

    // Proxy contract => queued upgrade proposal id.
    mapping(address => uint) contractUpgradeProposals;

    // Governance parameters for full proposals and dev ratio transitions.
    bytes32 public mainProjectName;
    uint64 public finalVersion;
    uint public devRatio;
    uint public finalRatio;
    // Snapshot version used by ordinary proposals.
    uint64 public committeeVersion;
    // Ordinary proposal => committee snapshot version at creation time.
    mapping(uint => uint64) proposalCommitteeVersion;
    // Snapshot version => committee size / membership lookup.
    mapping(uint64 => uint) committeeSizeByVersion;
    mapping(uint64 => mapping(address => bool)) committeeMemberByVersion;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Rejects empty, zero-address, or duplicate committee member lists.
    function _validateCommitteeList(address[] memory memberList) internal pure {
        require(memberList.length > 0, "committee required");
        for (uint i = 0; i < memberList.length; i++) {
            require(memberList[i] != address(0), "invalid committee member");
            for (uint j = i + 1; j < memberList.length; j++) {
                require(memberList[i] != memberList[j], "duplicate committee member");
            }
        }
    }

    /// @notice Initializes the committee with its first member set and governance ratios.
    /// @dev `devRatio` uses two implied decimals and must always be greater than 100.
    function initialize(address[] memory initialCommittees, uint initProposalId, uint _initDevRatio, bytes32 _mainProjectName, uint64 _finalVersion, uint _finalDevRatio, address mainAddr) public initializer {
        require(initProposalId > 0, "invalid proposal id");
        require(_initDevRatio > 100, "dev ratio must greater than 100");
        require(_finalDevRatio > 100, "final dev ratio must greater than 100");
        _validateCommitteeList(initialCommittees);

        __SourceDaoContractUpgradable_init(mainAddr);

        curProposalId = initProposalId;

        committees = initialCommittees;
        _recordCommitteeSnapshot(initialCommittees);
        devRatio = _initDevRatio;
        mainProjectName = _mainProjectName;
        finalVersion = _finalVersion;
        finalRatio = _finalDevRatio;
        emit MemberChanged(new address[](0), initialCommittees);
    }

    /// @notice Returns whether `someOne` is in the current live committee set.
    function isMember(address someOne) public view override returns (bool) {
        return util.isExist(committees, someOne);
    }

    /// @notice Returns the current live committee set.
    function members() public view override returns (address[] memory) {
        return committees;
    }

    /// @dev Creates a proposal and binds ordinary proposals to the current committee snapshot version.
    function _propose(
        address from,
        uint duration,
        bytes32[] memory params,
        bool isFull
    ) internal returns (uint) {
        uint proposalId = curProposalId++;
        bytes32 root = MerkleProof.processProof(params, util.AddressToBytes32(tx.origin));
        proposals[proposalId] = Proposal(
            from,
            tx.origin,
            block.timestamp + duration,
            new address[](0),
            new address[](0),
            ProposalState.InProgress,
            root
        );

        if (!isFull) {
            _ensureCommitteeSnapshotInitialized();
            proposalCommitteeVersion[proposalId] = committeeVersion;
        }

        emit ProposalStart(proposalId, isFull);

        return proposalId;
    }

    /// @dev Creates a token-weighted full proposal with a turnout threshold.
    function _fullPropose(uint duration,
        bytes32[] memory params,
        uint threshold) internal returns (uint) {
            require(duration >= 7 days, "duration must greater than 7 days");
            require(threshold >= 10 && threshold <= 100, "threshold must in 10 to 100");
            // 12 seconds a block.
            uint id = _propose(
                msg.sender,
                duration,
                params,
                true
            );

            proposalExtras[id] = ProposalExtra(tx.origin, threshold, 0, 0, 0, 0);
            return id;
        }

    /// @notice Starts a full proposal from an approved DAO contract.
    function fullPropose(
        uint duration,
        bytes32[] memory params,
        uint threshold
    ) external override returns (uint proposalId) {
        require(getMainContractAddress().isDAOContract(msg.sender), "only DAO contract can propose");
        return _fullPropose(duration, params, threshold);
    }

    /// @notice Settles batched voters for a full proposal using current token balances.
    /// @dev Full proposal weighting semantics are intentionally left unchanged in this revision.
    function endFullPropose(
        uint proposalId,
        address[] memory voters
    ) external override {
        // 如果正式版已经发布，将devRatio固定为finalRatio
        if (devRatio != finalRatio) {
            if (getMainContractAddress().project().versionReleasedTime(mainProjectName, finalVersion) > 0) {
                emit DevRatioChanged(devRatio, finalRatio);
                devRatio = finalRatio;
            }
        }

        Proposal storage proposal = proposals[proposalId];
        ProposalExtra storage extra = proposalExtras[proposalId];

        require(extra.from != address(0), "not full propose");
        require(
            proposal.state == ProposalState.InProgress,
            "invalid proposal state"
        );
        require(proposal.expired < block.timestamp, "not yet settled");

        if (extra.totalReleasedToken == 0) {
            ISourceDAODevToken devToken = getMainContractAddress().devToken();
            ISourceDAONormalToken normalToken = getMainContractAddress().normalToken();
            // 所有释放的token = normal总量+dev释放量
            extra.totalReleasedToken = (devToken.totalReleased() * devRatio / 100) + normalToken.totalSupply();
        }

        uint agree = 0;
        uint rejected = 0;
        uint settled = 0;
        for (uint i = 0; i < voters.length; i++) {
            int vote = proposalVotes[proposalId][voters[i]];
            if (vote == 1 || vote == -1) {
                uint votes = _fullProposalVotingPower(voters[i]);
                if (vote == 1) {
                    agree += votes;
                } else if (vote == -1) {
                    rejected += votes;
                }
                proposalVotes[proposalId][voters[i]] = 2;
                settled += 1;
            }
        }

        extra.agree += agree;
        extra.reject += rejected;
        extra.settled += settled;

        // 所有已投票的人都计算完毕
        if (extra.settled == proposal.support.length + proposal.reject.length) {
            // settlement votes
            if (extra.agree + extra.reject < extra.totalReleasedToken * extra.threshold / 100 ) {
                proposal.state = ProposalState.Expired;
                emit ProposalExpire(proposalId);
            } else {
                if (extra.agree > extra.reject) {
                    proposal.state = ProposalState.Accepted;
                    emit ProposalAccept(proposalId);
                } else {
                    proposal.state = ProposalState.Rejected;
                    emit ProposalReject(proposalId);
                }
            }
        }
        
    }

    function propose(
        uint duration,
        bytes32[] memory params
    ) external override returns (uint proposalId) {
        require(getMainContractAddress().isDAOContract(msg.sender), "only DAO contract can propose");
        return _propose(msg.sender, duration, params, false);
    }

    /// @dev Persists the latest committee set into a new snapshot version.
    function _recordCommitteeSnapshot(address[] memory memberList) internal {
        committeeVersion += 1;
        committeeSizeByVersion[committeeVersion] = memberList.length;
        for (uint i = 0; i < memberList.length; i++) {
            committeeMemberByVersion[committeeVersion][memberList[i]] = true;
        }
    }

    /// @dev Lazily initializes snapshot state for upgraded deployments that predate snapshot storage.
    function _ensureCommitteeSnapshotInitialized() internal {
        if (committeeVersion == 0) {
            _recordCommitteeSnapshot(committees);
        }
    }

    /// @dev Computes the current token-weighted voting power used by full proposals.
    function _fullProposalVotingPower(address voter) internal view returns (uint) {
        ISourceDAODevToken devToken = getMainContractAddress().devToken();
        ISourceDAONormalToken normalToken = getMainContractAddress().normalToken();

        return normalToken.balanceOf(voter) + (devToken.balanceOf(voter) * devRatio / 100);
    }

    /// @dev Ordinary proposals have no `ProposalExtra.from` marker; full proposals do.
    function _isOrdinaryProposal(uint proposalId) internal view returns (bool) {
        return proposalExtras[proposalId].from == address(0);
    }

    /// @dev Ensures an ordinary proposal is bound to a committee snapshot version.
    function _ensureProposalCommitteeVersion(uint proposalId) internal returns (uint64 version) {
        version = proposalCommitteeVersion[proposalId];
        if (version == 0) {
            _ensureCommitteeSnapshotInitialized();
            version = committeeVersion;
            proposalCommitteeVersion[proposalId] = version;
        }
    }

    /// @dev Counts only votes cast by members that belong to the proposal's snapshot version.
    function _countOrdinaryVotes(uint proposalId, uint64 version) internal view returns (uint agreed, uint rejected) {
        Proposal storage proposal = proposals[proposalId];

        for (uint i = 0; i < proposal.support.length; i++) {
            if (committeeMemberByVersion[version][proposal.support[i]]) {
                agreed += 1;
            }
        }

        for (uint i = 0; i < proposal.reject.length; i++) {
            if (committeeMemberByVersion[version][proposal.reject[i]]) {
                rejected += 1;
            }
        }
    }

    /// @notice Casts a support vote for either an ordinary or full proposal.
    /// @dev Ordinary proposals require membership in the proposal's snapshot version.
    function support(uint proposalId, bytes32[] memory params) external override returns (bool) {
        Proposal storage proposal = proposals[proposalId];
        require(
            proposal.state == ProposalState.InProgress,
            "invalid proposal state"
        );
        require(block.timestamp < proposal.expired, "proposal expired");
        require(proposalVotes[proposalId][msg.sender] == 0, "already voted");

        require(MerkleProof.verify(params, proposal.paramroot, util.AddressToBytes32(proposal.origin)), "invalid params");

        if (_isOrdinaryProposal(proposalId)) {
            uint64 version = _ensureProposalCommitteeVersion(proposalId);
            require(committeeMemberByVersion[version][msg.sender], "only committee can vote");
        } else {
            require(_fullProposalVotingPower(msg.sender) > 0, "only token holders can vote");
        }

        proposal.support.push(msg.sender);

        proposalVotes[proposalId][msg.sender] = 1;

        emit ProposalVoted(msg.sender, proposalId, true);

        return true;
    }

    /// @notice Casts a reject vote for either an ordinary or full proposal.
    /// @dev Ordinary proposals require membership in the proposal's snapshot version.
    function reject(uint proposalId, bytes32[] memory params) external override returns (bool) {
        Proposal storage proposal = proposals[proposalId];
        require(
            proposal.state == ProposalState.InProgress,
            "invalid proposal state"
        );
        require(block.timestamp < proposal.expired, "proposal expired");
        require(proposalVotes[proposalId][msg.sender] == 0, "already voted");
        require(MerkleProof.verify(params, proposal.paramroot, util.AddressToBytes32(proposal.origin)), "invalid params");

        if (_isOrdinaryProposal(proposalId)) {
            uint64 version = _ensureProposalCommitteeVersion(proposalId);
            require(committeeMemberByVersion[version][msg.sender], "only committee can vote");
        } else {
            require(_fullProposalVotingPower(msg.sender) > 0, "only token holders can vote");
        }
        
        proposal.reject.push(msg.sender);

        proposalVotes[proposalId][msg.sender] = -1;

        emit ProposalVoted(msg.sender, proposalId, false);

        return false;
    }

    /// @dev Converts internal storage state to the public-facing result enum.
    function ProposalStateToResult(
        ProposalState state
    ) internal pure returns (ProposalResult) {
        if (state == ProposalState.Accepted) {
            return ProposalResult.Accept;
        } else if (state == ProposalState.Rejected) {
            return ProposalResult.Reject;
        } else if (state == ProposalState.Expired) {
            return ProposalResult.Expired;
        } else if (state == ProposalState.Executed) {
            return ProposalResult.Executed;
        } else {
            return ProposalResult.NoResult;
        }
    }

    /// @dev Settles ordinary proposals against the committee snapshot captured at proposal creation.
    function _settleProposal (uint proposalId) internal returns (ProposalResult) {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.state == ProposalState.InProgress) {
            ProposalExtra memory extra = proposalExtras[proposalId];
            require(extra.from == address(0), "cannot settle full proposal");
            // Proposal in the InProgress state, try to calculate the ratio of votes
            uint64 version = _ensureProposalCommitteeVersion(proposalId);
            (uint agreed, uint rejected) = _countOrdinaryVotes(proposalId, version);
            uint committeeSize = committeeSizeByVersion[version];

            // If agreed is greater than half of committees, set Proposal state to Agreed
            if (agreed > committeeSize / 2) {
                proposal.state = ProposalState.Accepted;
                emit ProposalAccept(proposalId);
            } else if (rejected > committeeSize / 2) {
                proposal.state = ProposalState.Rejected;
                emit ProposalReject(proposalId);
            } else if (block.timestamp > proposal.expired) {
                proposal.state = ProposalState.Expired;
                emit ProposalExpire(proposalId);
            }
        }

        return ProposalStateToResult(proposal.state);
    }

    /// @notice Forces settlement of an ordinary proposal.
    function settleProposal(uint proposalId) external returns (ProposalResult) {
        return _settleProposal(proposalId);
    }

    /// @dev Validates params against the stored Merkle root before settling.
    function _takeResult(
        uint proposalId,
        bytes32[] memory params
    ) internal returns (ProposalResult) {
        Proposal memory proposal = proposals[proposalId];
        if (!MerkleProof.verify(params, proposal.paramroot, util.AddressToBytes32(proposal.origin))) {
            return ProposalResult.NotMatch;
        }

        return _settleProposal(proposalId);
    }

    /// @notice Returns the current result for a proposal if the provided params match.
    function takeResult(
        uint proposalId,
        bytes32[] memory params
    ) public override returns (ProposalResult) {
        return _takeResult(proposalId, params);
    }

    /// @notice Returns the core proposal record for `proposalId`.
    function proposalOf(
        uint proposalId
    ) external view override returns (Proposal memory) {
        return proposals[proposalId];
    }

    /// @notice Returns the extra bookkeeping used by full proposals.
    function proposalExtraOf(
        uint proposalId
    ) external view override returns (ProposalExtra memory) {
        return proposalExtras[proposalId];
    }

    /// @dev Builds params for add/remove committee membership proposals.
    function _prepareParams(
        address member,
        bool isAdd
    ) internal pure returns (bytes32[] memory) {
        bytes32[] memory params = new bytes32[](2);
        params[0] = bytes32(uint256(uint160(member)));
        params[1] = isAdd ? bytes32("addMember") : bytes32("removeMember");
        return params;
    }

    /// @notice Starts an ordinary proposal to add a new committee member.
    function prepareAddMember(address member) external returns (uint) {
        require(isMember(msg.sender), "only committee can add member");
        bytes32[] memory params = _prepareParams(member, true);

        return _propose(address(this), 7 days, params, false);
    }

    /// @notice Starts an ordinary proposal to remove an existing committee member.
    function prepareRemoveMember(address member) external returns (uint) {
        require(isMember(msg.sender), "only committee can remove member");
        require(isMember(member), "member not found");
        bytes32[] memory params = _prepareParams(member, false);

        return _propose(address(this), 7 days, params, false);
    }

    /// @notice Executes an accepted add-member proposal and records a new snapshot version.
    function addCommitteeMember(address member, uint proposalId) external {
        bytes32[] memory params = _prepareParams(member, true);
        require(
            _takeResult(proposalId, params) == ProposalResult.Accept,
            "proposal not accepted"
        );

        // Check if member are already on the committee
        require(
            !isMember(member),
            "The member is already in the committee."
        );

        committees.push(member);
        _recordCommitteeSnapshot(committees);

        _setProposalExecuted(proposalId, true);

        emit MemberAdded(member);
    }

    /// @notice Executes an accepted remove-member proposal and records a new snapshot version.
    function removeCommitteeMember(address member, uint proposalId) external {
        bytes32[] memory params = _prepareParams(member, false);
        require(
            _takeResult(proposalId, params) == ProposalResult.Accept,
            "proposal not accepted"
        );

        require(isMember(member), "member not found");

        // Find and delete member
        for (uint i = 0; i < committees.length; i++) {
            if (committees[i] == member) {
                committees[i] = committees[committees.length - 1];
                committees.pop();
                break;
            }
        }
        _recordCommitteeSnapshot(committees);

        _setProposalExecuted(proposalId, true);
        emit MemberRemoved(member);
    }

    /// @dev Builds params for a full committee replacement proposal.
    function _prepareSetCommitteesParam(address[] calldata newCommittees) pure internal returns(bytes32[] memory) {
        bytes32[] memory params = new bytes32[](newCommittees.length + 1);
        for (uint i = 0; i < newCommittees.length; i++) {
            params[i] = bytes32(uint256(uint160(newCommittees[i])));
        }
        params[newCommittees.length] = bytes32("setCommittees");
        return params;
    }

    /// @notice Starts either an ordinary or full proposal to replace the whole committee set.
    function prepareSetCommittees(address[] calldata newCommittees, bool isFullProposal) public returns (uint) {
        _validateCommitteeList(newCommittees);
        if (!isFullProposal) {
            require(
                isMember(msg.sender),
                "only committee can set member"
            );
        } else {
            // TODO: 要sender销毁一部分Token？
        }
        

        bytes32[] memory params = _prepareSetCommitteesParam(newCommittees);

        uint proposalId;
        if (isFullProposal) {
            // full propose
            proposalId = _fullPropose(7 days, params, 40);
        } else {
            // normal propose
            proposalId = _propose(address(this), 7 days, params, false);
        }

        return proposalId;
    }

    /// @notice Executes an accepted committee replacement proposal and records a new snapshot version.
    function setCommittees(address[] calldata newCommittees, uint256 proposalId) public {
        _validateCommitteeList(newCommittees);
        bytes32[] memory params = _prepareSetCommitteesParam(newCommittees);
        require(
            _takeResult(proposalId, params) == ProposalResult.Accept,
            "proposal not accepted"
        );

        emit MemberChanged(committees, newCommittees);

        committees = newCommittees;
        _recordCommitteeSnapshot(newCommittees);

        _setProposalExecuted(proposalId, true);
    }

    /// @dev Builds params for dev ratio adjustment proposals.
    function _prepareSetDevRatioParam(uint newDevRatio) pure internal returns(bytes32[] memory) {
        bytes32[] memory params = new bytes32[](2);
        params[0] = bytes32(newDevRatio);
        params[1] = bytes32("setDevRatio");
        return params;
    }

    /// @notice Starts an ordinary proposal to reduce the current dev ratio toward `finalRatio`.
    function prepareSetDevRatio(uint newDevRatio) public returns (uint) {
        require(
            isMember(msg.sender),
            "only committee can set dev ratio"
        );

        if (getMainContractAddress().project().versionReleasedTime(mainProjectName, finalVersion) > 0) {
            revert("cannot set dev ratio after final version released");
        }

        // 是否要限制新的ratio一定比旧的小？
        require(newDevRatio < devRatio, "new dev ratio must less then old one");
        // 也限制新的ratio不能小于finalRatio
        require(newDevRatio >= finalRatio, "new dev ratio must greater then final one");

        bytes32[] memory params = _prepareSetDevRatioParam(newDevRatio);

        return _propose(address(this), 7 days, params, false);
    }

    /// @notice Executes an accepted dev ratio proposal, or pins to `finalRatio` after the final release.
    function setDevRatio(uint newDevRatio, uint256 proposalId) public {
        bytes32[] memory params = _prepareSetDevRatioParam(newDevRatio);
        require(
            _takeResult(proposalId, params) == ProposalResult.Accept,
            "proposal not accepted"
        );

        if (getMainContractAddress().project().versionReleasedTime(mainProjectName, finalVersion) > 0) {
            if (devRatio != finalRatio) {
                emit DevRatioChanged(devRatio, finalRatio);
                devRatio = finalRatio;
            }

            _setProposalExecuted(proposalId, true);
            return;
        }

        emit DevRatioChanged(devRatio, newDevRatio);
        devRatio = newDevRatio;

        _setProposalExecuted(proposalId, true);
    }

    function _prepareContractUpgradeParam(
        address proxyContractAddress,
        address newImplementAddress,
        bytes32 calldataHash
    ) internal pure returns (bytes32[] memory params) {
        params = new bytes32[](4);
        params[0] = util.AddressToBytes32(proxyContractAddress);
        params[1] = util.AddressToBytes32(newImplementAddress);
        params[2] = calldataHash;
        params[3] = bytes32("upgradeContract");
    }

    /// @notice Starts an ordinary proposal to upgrade a DAO proxy contract.
    function prepareContractUpgrade(
        address proxyContractAddress,
        address newImplementAddress
    ) external override returns (uint) {
        return prepareContractUpgrade(
            proxyContractAddress,
            newImplementAddress,
            keccak256(bytes(""))
        );
    }

    /// @notice Starts an ordinary proposal to upgrade a DAO proxy contract with an approved calldata hash.
    function prepareContractUpgrade(
        address proxyContractAddress,
        address newImplementAddress,
        bytes32 calldataHash
    ) public override returns (uint) {
        require(
            isMember(msg.sender),
            "only committee can upgrade contract"
        );

        require(
            contractUpgradeProposals[proxyContractAddress] == 0,
            "already has upgrade proposal"
        );

        bytes32[] memory params = _prepareContractUpgradeParam(
            proxyContractAddress,
            newImplementAddress,
            calldataHash
        );

        uint id = _propose(proxyContractAddress, 7 days, params, false);

        contractUpgradeProposals[proxyContractAddress] = id;

        return id;
    }

    /// @notice Verifies whether the queued upgrade proposal for `msg.sender` has passed.
    function verifyContractUpgrade(
        address newImplementAddress
    ) external override returns (bool) {
        return verifyContractUpgrade(newImplementAddress, keccak256(bytes("")));
    }

    /// @notice Verifies whether the queued upgrade proposal for `msg.sender` and calldata hash has passed.
    function verifyContractUpgrade(
        address newImplementAddress,
        bytes32 calldataHash
    ) public override returns (bool) {
        uint id = contractUpgradeProposals[msg.sender];

        require(id != 0, "not found upgrade proposal");

        bytes32[] memory params = _prepareContractUpgradeParam(
            msg.sender,
            newImplementAddress,
            calldataHash
        );

        ProposalResult result = _takeResult(id, params);

        if (
            result != ProposalResult.NoResult &&
            result != ProposalResult.NotMatch
        ) {
            contractUpgradeProposals[msg.sender] = 0;
        }

        bool pass = result == ProposalResult.Accept;

        if (pass) {
            _setProposalExecuted(id, false);
        }

        return pass;
    }

    /// @notice Clears an expired or rejected queued upgrade proposal.
    function cancelContractUpgrade(address proxyContractAddress) external override {
        require(isMember(msg.sender), "only committee can cancel upgrade");
        uint id = contractUpgradeProposals[proxyContractAddress];

        require(id != 0, "not found upgrade proposal");
        ProposalResult result = _settleProposal(id);
        if (result != ProposalResult.NoResult && result != ProposalResult.Accept) {
            contractUpgradeProposals[proxyContractAddress] = 0;
        }
    }

    /// @notice Returns the currently queued upgrade proposal for a proxy contract.
    function getContractUpgradeProposal(address proxyContractAddress) external view returns(Proposal memory) {
        return proposals[contractUpgradeProposals[proxyContractAddress]];
    }

    /// @dev Marks an accepted proposal as executed, optionally requiring the original caller group.
    function _setProposalExecuted(uint proposalId, bool self) internal {
        Proposal storage prop = proposals[proposalId];
        if (!self) {
            require(msg.sender == prop.fromGroup, "sender not match");
        }

        require(prop.state == ProposalState.Accepted, "state not match");

        prop.state = ProposalState.Executed;

        emit ProposalExecuted(proposalId);
    }

    /// @notice Marks an accepted proposal as executed from its originating DAO contract.
    function setProposalExecuted(uint proposalId) external override {
        _setProposalExecuted(proposalId, false);
    }
}
