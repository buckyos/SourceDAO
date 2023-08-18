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
        if (mainAddr != address(0)) {
            mainContractAddress = mainAddr;
        }
    }

    function getMainContractAddress() internal view returns(ISourceDao) {
        return ISourceDao(mainContractAddress);
    }

    function setMainContractAddress(address newAddr) external onlySetOnce(mainContractAddress) {
        mainContractAddress = newAddr;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal virtual override {
        require(getMainContractAddress().committee().verifyContractUpgrade(newImplementation), "verify proposal fail");
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}