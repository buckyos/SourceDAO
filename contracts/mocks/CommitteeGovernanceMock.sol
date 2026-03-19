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
    uint private defaultReleasedTime;
    bool private revertVersionRead;

    function setVersionReleasedTime(bytes32 projectName, uint64 version, uint releasedTime) external {
        releasedAt[projectName][version] = releasedTime;
    }

    function setDefaultReleasedTime(uint releasedTime) external {
        defaultReleasedTime = releasedTime;
    }

    function setVersionReadRevert(bool shouldRevert) external {
        revertVersionRead = shouldRevert;
    }

    function versionReleasedTime(bytes32 projectName, uint64 version) external view returns (uint) {
        require(!revertVersionRead, "project version read reverted");

        uint configured = releasedAt[projectName][version];
        if (configured > 0) {
            return configured;
        }

        return defaultReleasedTime;
    }
}
