// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "./Interface.sol";

abstract contract SourceDaoContractUpgradeable is Initializable, UUPSUpgradeable {
    modifier onlySetOnce(address addr) {
        require(addr == address(0), "can set once");
        _;
    }

    address mainContractAddress;

    function __SourceDaoContractUpgradable_init(address mainAddr) internal onlyInitializing {
        __UUPSUpgradeable_init();
        require(mainAddr != address(0), "invalid main address");
        mainContractAddress = mainAddr;
    }

    function getMainContractAddress() internal view returns(ISourceDao) {
        return ISourceDao(mainContractAddress);
    }

    function setMainContractAddress(address newAddr) external onlySetOnce(mainContractAddress) {
        require(newAddr != address(0) && newAddr.code.length > 0, "invalid main address");
        mainContractAddress = newAddr;
    }

    /// @notice Upgrades through governance only after both implementation and calldata hash are approved.
    function upgradeToAndCall(
        address newImplementation,
        bytes memory data
    ) public payable virtual override onlyProxy {
        require(
            getMainContractAddress().committee().verifyContractUpgrade(
                newImplementation,
                keccak256(data)
            ),
            "verify proposal fail"
        );

        super.upgradeToAndCall(newImplementation, data);
    }

    /// @dev Upgrade authorization is enforced in {upgradeToAndCall} so calldata can be part of governance approval.
    function _authorizeUpgrade(
        address
    ) internal virtual override {
    }

    function version() external pure virtual returns (string memory) {
        return "2.0.0";
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}
