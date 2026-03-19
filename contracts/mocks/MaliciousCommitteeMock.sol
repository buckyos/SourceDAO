// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../Interface.sol";

contract MaliciousCommitteeMock {
    uint256 public nextProposalId = 1;
    uint256 public executedCount;
    uint256 public lastExecutedProposalId;

    uint256 public proposeReentryAttempts;
    uint256 public proposeReentrySuccesses;
    uint256 public takeResultReentryAttempts;
    uint256 public takeResultReentrySuccesses;

    address public proposeReentryTarget;
    bytes public proposeReentryData;
    address public takeResultReentryTarget;
    bytes public takeResultReentryData;

    bool private _inCallback;

    function configureProposeReentry(address target, bytes calldata data) external {
        proposeReentryTarget = target;
        proposeReentryData = data;
    }

    function configureTakeResultReentry(address target, bytes calldata data) external {
        takeResultReentryTarget = target;
        takeResultReentryData = data;
    }

    function clearCallbacks() external {
        proposeReentryTarget = address(0);
        delete proposeReentryData;
        takeResultReentryTarget = address(0);
        delete takeResultReentryData;
    }

    function propose(uint, bytes32[] memory) external returns (uint proposalId) {
        _attemptCallback(proposeReentryTarget, proposeReentryData, true);
        proposalId = nextProposalId;
        nextProposalId += 1;
    }

    function takeResult(uint, bytes32[] memory) external returns (ISourceDaoCommittee.ProposalResult) {
        _attemptCallback(takeResultReentryTarget, takeResultReentryData, false);
        return ISourceDaoCommittee.ProposalResult.Accept;
    }

    function setProposalExecuted(uint proposalId) external {
        executedCount += 1;
        lastExecutedProposalId = proposalId;
    }

    function _attemptCallback(address target, bytes storage data, bool duringPropose) internal {
        if (_inCallback || target == address(0) || data.length == 0) {
            return;
        }

        _inCallback = true;
        if (duringPropose) {
            proposeReentryAttempts += 1;
        } else {
            takeResultReentryAttempts += 1;
        }

        (bool success, ) = target.call(data);
        if (success) {
            if (duringPropose) {
                proposeReentrySuccesses += 1;
            } else {
                takeResultReentrySuccesses += 1;
            }
        }

        _inCallback = false;
    }
}
