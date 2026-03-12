// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../Interface.sol";

contract CommitteeProposalCallerMock {
    function fullPropose(
        address committee,
        uint duration,
        bytes32[] calldata params,
        uint threshold
    ) external returns (uint) {
        return ISourceDaoCommittee(committee).fullPropose(duration, params, threshold);
    }
}

contract ProjectVersionMock {
    mapping(bytes32 => mapping(uint64 => uint)) private releasedAt;

    function setVersionReleasedTime(bytes32 projectName, uint64 version, uint releasedTime) external {
        releasedAt[projectName][version] = releasedTime;
    }

    function versionReleasedTime(bytes32 projectName, uint64 version) external view returns (uint) {
        return releasedAt[projectName][version];
    }
}