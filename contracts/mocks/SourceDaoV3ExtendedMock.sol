// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../Dao.sol";

contract SourceDaoV3ExtendedMock is SourceDao {
    address private _governanceRelay;

    function version() external pure override returns (string memory) {
        return "2.2.0";
    }

    function setGovernanceRelayAddress(address newAddress) external onlyBootstrapAdmin onlySetOnce(_governanceRelay) {
        _requireValidAddress(newAddress);
        _governanceRelay = newAddress;
    }

    function governanceRelay() external view returns (address) {
        return _governanceRelay;
    }
}
