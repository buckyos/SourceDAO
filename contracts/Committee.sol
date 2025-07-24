// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./SourceDaoUpgradeable.sol";
import "./Interface.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import "hardhat/console.sol";
import "./util.sol";

// 委员会
contract SourceDaoCommittee is ISourceDaoCommittee, SourceDaoContractUpgradeable {
    uint curProposalId;
    address[] committees;

    mapping(uint => Proposal) proposals;
    mapping(uint => ProposalExtra) proposalExtras;
    mapping(uint => mapping(address => int)) proposalVotes;

    mapping(address => uint) contractUpgradeProposals;

    bytes32 public mainProjectName;
    uint64 public finalVersion;
    uint public devRatio;
    uint public finalRatio;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // devRatio支持两位小数，必须大于100, 使用时除100
    function initialize(address[] memory initialCommittees, uint initProposalId, uint _initDevRatio, bytes32 _mainProjectName, uint64 _finalVersion, uint _finalDevRatio, address mainAddr) public initializer {
        require(_initDevRatio > 100, "dev ratio must greater than 100");
        require(_finalDevRatio > 100, "final dev ratio must greater than 100");

        __SourceDaoContractUpgradable_init(mainAddr);

        curProposalId = initProposalId;

        committees = initialCommittees;
        devRatio = _initDevRatio;
        mainProjectName = _mainProjectName;
        finalVersion = _finalVersion;
        finalRatio = _finalDevRatio;
        emit MemberChanged(new address[](0), initialCommittees);
    }

    function isMember(address someOne) public view override returns (bool) {
        return util.isExist(committees, someOne);
    }

    function members() public view override returns (address[] memory) {
        return committees;
    }

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

        emit ProposalStart(proposalId, isFull);

        return proposalId;
    }

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

    function fullPropose(
        uint duration,
        bytes32[] memory params,
        uint threshold
    ) external override returns (uint proposalId) {
        require(getMainContractAddress().isDAOContract(msg.sender), "only DAO contract can propose");
        return _fullPropose(duration, params, threshold);
    }

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

        ISourceDAODevToken devToken = getMainContractAddress().devToken();

        ISourceDAONormalToken normalToken = getMainContractAddress().normalToken();

        if (extra.totalReleasedToken == 0) {
            // 所有释放的token = normal总量+dev释放量
            extra.totalReleasedToken = (devToken.totalReleased() * devRatio / 100) + normalToken.totalSupply();
        }

        uint agree = 0;
        uint rejected = 0;
        uint settled = 0;
        for (uint i = 0; i < voters.length; i++) {
            int vote = proposalVotes[proposalId][voters[i]];
            if (vote == 1 || vote == -1) {
                // 锁定的normal token不参与投票
                uint balance = normalToken.balanceOf(voters[i]);
                uint devBalance = devToken.balanceOf(voters[i]);
                uint votes = balance + (devBalance * devRatio / 100);
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

    function support(uint proposalId, bytes32[] memory params) external override returns (bool) {
        Proposal storage proposal = proposals[proposalId];
        require(
            proposal.state == ProposalState.InProgress,
            "invalid proposal state"
        );
        require(block.timestamp < proposal.expired, "proposal expired");
        require(proposalVotes[proposalId][msg.sender] == 0, "already voted");

        require(MerkleProof.verify(params, proposal.paramroot, util.AddressToBytes32(proposal.origin)), "invalid params");

        proposal.support.push(msg.sender);

        proposalVotes[proposalId][msg.sender] = 1;

        emit ProposalVoted(msg.sender, proposalId, true);

        return true;
    }

    function reject(uint proposalId, bytes32[] memory params) external override returns (bool) {
        Proposal storage proposal = proposals[proposalId];
        require(
            proposal.state == ProposalState.InProgress,
            "invalid proposal state"
        );
        require(block.timestamp < proposal.expired, "proposal expired");
        require(proposalVotes[proposalId][msg.sender] == 0, "already voted");
        require(MerkleProof.verify(params, proposal.paramroot, util.AddressToBytes32(proposal.origin)), "invalid params");
        
        proposal.reject.push(msg.sender);

        proposalVotes[proposalId][msg.sender] = -1;

        emit ProposalVoted(msg.sender, proposalId, false);

        return false;
    }

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

    function _settleProposal (uint proposalId) internal returns (ProposalResult) {
        Proposal storage proposal = proposals[proposalId];
        
        if (proposal.state == ProposalState.InProgress) {
            ProposalExtra memory extra = proposalExtras[proposalId];
            require(extra.from == address(0), "cannot settle full proposal");
            // Proposal in the InProgress state, try to calculate the ratio of votes
            uint agreed = 0;
            uint rejected = 0;
            for (uint i = 0; i < committees.length; i++) {
                if (proposalVotes[proposalId][committees[i]] == 1) {
                    agreed++;
                } else if (proposalVotes[proposalId][committees[i]] == -1) {
                    rejected++;
                }
            }

            // If agreed is greater than half of committees, set Proposal state to Agreed
            if (agreed > committees.length / 2) {
                proposal.state = ProposalState.Accepted;
                emit ProposalAccept(proposalId);
            } else if (rejected > committees.length / 2) {
                proposal.state = ProposalState.Rejected;
                emit ProposalReject(proposalId);
            } else if (block.timestamp > proposal.expired) {
                proposal.state = ProposalState.Expired;
                emit ProposalExpire(proposalId);
            }
        }

        return ProposalStateToResult(proposal.state);
    }

    function settleProposal(uint proposalId) external returns (ProposalResult) {
        return _settleProposal(proposalId);
    }

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

    function takeResult(
        uint proposalId,
        bytes32[] memory params
    ) public override returns (ProposalResult) {
        return _takeResult(proposalId, params);
    }

    function proposalOf(
        uint proposalId
    ) external view override returns (Proposal memory) {
        return proposals[proposalId];
    }

    function proposalExtraOf(
        uint proposalId
    ) external view override returns (ProposalExtra memory) {
        return proposalExtras[proposalId];
    }

    function _prepareParams(
        address member,
        bool isAdd
    ) internal pure returns (bytes32[] memory) {
        bytes32[] memory params = new bytes32[](2);
        params[0] = bytes32(uint256(uint160(member)));
        params[1] = isAdd ? bytes32("addMember") : bytes32("removeMember");
        return params;
    }

    function prepareAddMember(address member) external returns (uint) {
        require(isMember(msg.sender), "only committee can add member");
        bytes32[] memory params = _prepareParams(member, true);

        return _propose(address(this), 7 days, params, false);
    }

    function prepareRemoveMember(address member) external returns (uint) {
        require(isMember(msg.sender), "only committee can remove member");
        bytes32[] memory params = _prepareParams(member, false);

        return _propose(address(this), 7 days, params, false);
    }

    // Add a committee member
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

        _setProposalExecuted(proposalId, true);

        emit MemberAdded(member);
    }

    function removeCommitteeMember(address member, uint proposalId) external {
        bytes32[] memory params = _prepareParams(member, false);
        require(
            _takeResult(proposalId, params) == ProposalResult.Accept,
            "proposal not accepted"
        );

        // Find and delete member
        for (uint i = 0; i < committees.length; i++) {
            if (committees[i] == member) {
                committees[i] = committees[committees.length - 1];
                committees.pop();
                break;
            }
        }

        _setProposalExecuted(proposalId, true);
        emit MemberRemoved(member);
    }

    function _prepareSetCommitteesParam(address[] calldata newCommittees) pure internal returns(bytes32[] memory) {
        bytes32[] memory params = new bytes32[](newCommittees.length + 1);
        for (uint i = 0; i < newCommittees.length; i++) {
            params[i] = bytes32(uint256(uint160(newCommittees[i])));
        }
        params[newCommittees.length] = bytes32("setCommittees");
        return params;
    }

    function prepareSetCommittees(address[] calldata newCommittees, bool isFullProposal) public returns (uint) {
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

    function setCommittees(address[] calldata newCommittees, uint256 proposalId) public {
        bytes32[] memory params = _prepareSetCommitteesParam(newCommittees);
        require(
            _takeResult(proposalId, params) == ProposalResult.Accept,
            "proposal not accepted"
        );

        emit MemberChanged(committees, newCommittees);

        committees = newCommittees;

        _setProposalExecuted(proposalId, true);
    }

    function _prepareSetDevRatioParam(uint newDevRatio) pure internal returns(bytes32[] memory) {
        bytes32[] memory params = new bytes32[](2);
        params[0] = bytes32(newDevRatio);
        params[1] = bytes32("setDevRatio");
        return params;
    }

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

    function setDevRatio(uint newDevRatio, uint256 proposalId) public {
        bytes32[] memory params = _prepareSetDevRatioParam(newDevRatio);
        require(
            _takeResult(proposalId, params) == ProposalResult.Accept,
            "proposal not accepted"
        );

        emit DevRatioChanged(devRatio, newDevRatio);
        devRatio = newDevRatio;

        _setProposalExecuted(proposalId, true);
    }

    function prepareContractUpgrade(
        address proxyContractAddress,
        address newImplementAddress
    ) external override returns (uint) {
        require(
            isMember(msg.sender),
            "only committee can upgrade contract"
        );

        require(
            contractUpgradeProposals[proxyContractAddress] == 0,
            "already has upgrade proposal"
        );
        bytes32[] memory params = new bytes32[](3);
        params[0] = util.AddressToBytes32(proxyContractAddress);
        params[1] = util.AddressToBytes32(newImplementAddress);
        params[2] = bytes32("upgradeContract");

        uint id = _propose(proxyContractAddress, 7 days, params, false);

        contractUpgradeProposals[proxyContractAddress] = id;

        return id;
    }

    function verifyContractUpgrade(
        address newImplementAddress
    ) external override returns (bool) {
        uint id = contractUpgradeProposals[msg.sender];

        require(id != 0, "not found upgrade proposal");

        bytes32[] memory params = new bytes32[](3);
        params[0] = util.AddressToBytes32(msg.sender);
        params[1] = util.AddressToBytes32(newImplementAddress);
        params[2] = bytes32("upgradeContract");

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

    function cancelContractUpgrade(address proxyContractAddress) external override {
        require(isMember(msg.sender), "only committee can cancel upgrade");
        uint id = contractUpgradeProposals[proxyContractAddress];

        require(id != 0, "not found upgrade proposal");
        ProposalResult result = _settleProposal(id);
        if (result != ProposalResult.NoResult && result != ProposalResult.Accept) {
            contractUpgradeProposals[proxyContractAddress] = 0;
        }
    }

    function getContractUpgradeProposal(address proxyContractAddress) external view returns(Proposal memory) {
        return proposals[contractUpgradeProposals[proxyContractAddress]];
    }

    function _setProposalExecuted(uint proposalId, bool self) internal {
        Proposal storage prop = proposals[proposalId];
        if (!self) {
            require(msg.sender == prop.fromGroup, "sender not match");
        }

        require(prop.state == ProposalState.Accepted, "state not match");

        prop.state = ProposalState.Executed;

        emit ProposalExecuted(proposalId);
    }

    function setProposalExecuted(uint proposalId) external override {
        _setProposalExecuted(proposalId, false);
    }
}