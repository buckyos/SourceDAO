// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./SourceDaoUpgradeable.sol";
import "./Interface.sol";
import {MerkleProofUpgradeable as MerkleProof} from "@openzeppelin/contracts-upgradeable/utils/cryptography/MerkleProofUpgradeable.sol";

import "hardhat/console.sol";

// 委员会
contract SourceDaoCommittee is ISourceDaoCommittee, SourceDaoContractUpgradeable {
    struct PorposalExtra {
        address from;
        uint threshold;
        uint agree;
        uint reject;
        uint endBlockNumber;
        uint settled;
        uint totalReleasedToken;
    }

    uint curProposalId;
    address[] committees;
    mapping(address => bool) isCommitteeMember;

    mapping(uint => Proposal) _proposals;
    mapping(uint => PorposalExtra) _extras;
    mapping(uint => mapping(address => int)) proposalVotes;

    mapping(address => uint) contractUpgradeProposals;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address[] memory initialCommittees) public initializer {
        __SourceDaoContractUpgradable_init();

        curProposalId = 1;
        committees = initialCommittees;
        for (uint i = 0; i < committees.length; i++) {
            isCommitteeMember[committees[i]] = true;
        }
    }

    function isMember(address someOne) external view override returns (bool) {
        return isCommitteeMember[someOne];
    }

    function members() external view override returns (address[] memory) {
        return committees;
    }

    function _propose(
        address from,
        uint duration,
        bytes32[] memory params,
        bool isFull
    ) internal returns (uint) {
        uint _proposalId = curProposalId++;
        bytes32 root = MerkleProof.processProof(params, bytes32(0));
        _proposals[_proposalId] = Proposal(
            from,
            block.timestamp + duration,
            new address[](0),
            new address[](0),
            ProposalState.Inprogress,
            root
        );

        emit ProposalStart(_proposalId, isFull);

        return _proposalId;
    }

    function fullPropose(
        uint endBlockNumber,
        bytes32[] memory params,
        uint threshold
    ) external override returns (uint proposalId) {
        require(threshold > 30 && threshold < 100, "threshold must in 30 to 100");
        // 12 seconds a block.
        uint id = _propose(
            msg.sender,
            block.timestamp + (endBlockNumber - block.number) * 12,
            params,
            true
        );

        _extras[id] = PorposalExtra(tx.origin, threshold, 0, 0, endBlockNumber, 0, 0);
        return id;
    }

    function endFullPropose(
        uint proposalId,
        address[] memory voters
    ) external override {
        Proposal storage proposal = _proposals[proposalId];
        PorposalExtra storage extra = _extras[proposalId];

        require(extra.endBlockNumber != 0, "not full propose");
        require(
            proposal.state == ProposalState.Inprogress,
            "invalid proposal state"
        );
        require(extra.endBlockNumber < block.number, "not yet settled");

        if (extra.totalReleasedToken == 0) {
            extra.totalReleasedToken = getMainContractAddress().token().totalReleased();
        }

        uint agree = 0;
        uint rejected = 0;
        uint settled = 0;
        for (uint i = 0; i < voters.length; i++) {
            int vote = proposalVotes[proposalId][voters[i]];
            if (vote == 1 || vote == -1) {
                uint balance = getMainContractAddress().token().balanceOf(voters[i]) + getMainContractAddress().lockup().totalAssigned(voters[i]);
                if (vote == 1) {
                    agree += balance;
                } else if (vote == -1) {
                    rejected += balance;
                }
                proposalVotes[proposalId][voters[i]] = 2;
                settled += 1;
            }
        }

        extra.agree += agree;
        extra.reject += rejected;
        extra.settled += settled;

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
        return _propose(msg.sender, duration, params, false);
    }

    function support(uint proposalId) external override returns (bool) {
        Proposal storage proposal = _proposals[proposalId];
        require(
            proposal.state == ProposalState.Inprogress,
            "invalid proposal state"
        );
        require(block.timestamp < proposal.expired, "proposal expired");
        require(proposalVotes[proposalId][msg.sender] == 0, "already voted");
        proposal.support.push(msg.sender);

        proposalVotes[proposalId][msg.sender] = 1;

        emit ProposalVoted(msg.sender, proposalId, true);

        return true;
    }

    function reject(uint proposalId) external override returns (bool) {
        Proposal storage proposal = _proposals[proposalId];
        require(
            proposal.state == ProposalState.Inprogress,
            "invalid proposal state"
        );
        require(block.timestamp < proposal.expired, "proposal expired");
        require(proposalVotes[proposalId][msg.sender] == 0, "already voted");
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
        Proposal storage proposal = _proposals[proposalId];
        
        if (proposal.state == ProposalState.Inprogress) {
            PorposalExtra memory extra = _extras[proposalId];
            require(extra.endBlockNumber == 0, "cannot settle full proposal");
            // Proposal in the Inprogress state, try to calculate the ratio of votes
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
        Proposal memory proposal = _proposals[proposalId];
        if (!MerkleProof.verify(params, proposal.paramroot, bytes32(0))) {
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
        return _proposals[proposalId];
    }

    function _perpareParams(
        address member,
        bool isAdd
    ) internal pure returns (bytes32[] memory) {
        bytes32[] memory params = new bytes32[](2);
        params[0] = bytes32(bytes20(member));
        params[1] = isAdd ? bytes32("add") : bytes32("remove");
        return params;
    }

    function perpareAddMember(address member) external returns (uint) {
        require(isCommitteeMember[msg.sender], "only committee can add member");
        bytes32[] memory params = _perpareParams(member, true);

        return _propose(address(this), 7 days, params, false);
    }

    function perpareRemoveMember(address member) external returns (uint) {
        require(
            isCommitteeMember[msg.sender],
            "only committee can remove member"
        );
        bytes32[] memory params = _perpareParams(member, false);

        return _propose(address(this), 7 days, params, false);
    }

    // Add a committee member
    function addCommitteeMember(address member, uint proposalId) external {
        bytes32[] memory params = _perpareParams(member, true);
        require(
            _takeResult(proposalId, params) == ProposalResult.Accept,
            "proposal not accepted"
        );

        // Check if member are already on the committee
        require(
            !isCommitteeMember[member],
            "The member is already in the committee."
        );

        committees.push(member);
        isCommitteeMember[member] = true;

        _setProposalExecuted(proposalId, true);

        emit MemberAdded(member);
    }

    function removeCommitteeMember(address member, uint proposalId) external {
        bytes32[] memory params = _perpareParams(member, false);
        require(
            _takeResult(proposalId, params) == ProposalResult.Accept,
            "proposal not accepted"
        );

        // Check if member are already on the committee
        require(
            isCommitteeMember[member],
            "The member is not in the committee."
        );

        // Find and delete member
        for (uint i = 0; i < committees.length; i++) {
            if (committees[i] == member) {
                committees[i] = committees[committees.length - 1];
                committees.pop();
                isCommitteeMember[member] = false;
                break;
            }
        }

        _setProposalExecuted(proposalId, true);
        emit MemberRemoved(member);
    }

    function perpareContractUpgrade(
        address proxyContractAddress,
        address newImplementAddress
    ) external override returns (uint) {
        require(
            isCommitteeMember[msg.sender],
            "only committee can upgrade contract"
        );

        require(
            contractUpgradeProposals[proxyContractAddress] == 0,
            "already has upgrade proposal"
        );
        bytes32[] memory params = new bytes32[](2);
        params[0] = bytes32(bytes20(proxyContractAddress));
        params[1] = bytes32(bytes20(newImplementAddress));

        uint id = _propose(proxyContractAddress, 7 days, params, false);

        contractUpgradeProposals[proxyContractAddress] = id;

        return id;
    }

    function verifyContractUpgrade(
        address newImplementAddress
    ) external override returns (bool) {
        uint id = contractUpgradeProposals[msg.sender];

        require(id != 0, "not found upgrade proposal");

        bytes32[] memory params = new bytes32[](2);
        params[0] = bytes32(bytes20(msg.sender));
        params[1] = bytes32(bytes20(newImplementAddress));

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
        require(isCommitteeMember[msg.sender], "only committee can cancel upgrade");
        uint id = contractUpgradeProposals[msg.sender];

        require(id != 0, "not found upgrade proposal");
        ProposalResult result = _settleProposal(id);
        if (result != ProposalResult.NoResult && result != ProposalResult.Accept) {
            contractUpgradeProposals[proxyContractAddress] = 0;
        }
    }

    function getContractUpgradeProposal(address proxyContractAddress) external view returns(Proposal memory) {
        return _proposals[contractUpgradeProposals[proxyContractAddress]];
    }

    function _setProposalExecuted(uint proposalId, bool self) internal {
        Proposal storage prop = _proposals[proposalId];
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