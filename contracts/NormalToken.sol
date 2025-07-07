// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./SourceDaoUpgradeable.sol";
import "./Interface.sol";

contract NormalToken is
    ISourceDAONormalToken,
    ERC20BurnableUpgradeable,
    ReentrancyGuardUpgradeable,
    SourceDaoContractUpgradeable
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name,
        string memory symbol,
        address mainAddr
    ) public initializer {
        __ERC20_init(name, symbol);
        __ERC20Burnable_init();
        __ReentrancyGuard_init();
        __SourceDaoContractUpgradable_init(mainAddr);
    }

    function mintNormalToken(
        address to,
        uint256 amount
    ) external override nonReentrant {
        require(
            msg.sender == address(getMainContractAddress().devToken()),
            "only dev token contract can mint"
        );
        _mint(to, amount);
    }
}
