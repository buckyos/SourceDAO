// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./SourceDaoUpgradeable.sol";
import "./Interface.sol";

contract DevToken is
    ISourceDAODevToken,
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
        uint256 __totalSupply,
        address[] calldata initAddress,
        uint256[] calldata initAmount,
        address mainAddr
    ) public initializer {
        __ERC20_init(name, symbol);
        __ERC20Burnable_init();
        __ReentrancyGuard_init();
        __SourceDaoContractUpgradable_init(mainAddr);

        require(initAddress.length == initAmount.length, "init data error");
        uint256 totalInited = 0;
        for (uint i = 0; i < initAddress.length; i++) {
            _mint(initAddress[i], initAmount[i]);
            totalInited += initAmount[i];
        }

        _mint(address(this), __totalSupply - totalInited);
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        require(
            from == address(0)    // mint
                || from == address(getMainContractAddress().project())   // claim project award
                || to == address(0)  // burn
                || to == address(getMainContractAddress().project())  // project award
                || to == address(getMainContractAddress().lockup())  // convert and lockup
                || from == address(getMainContractAddress().dividend())  // stack to dividend
                || to == address(getMainContractAddress().dividend())  // unstack from dividend
            , "invalid transfer"
        );
        super._update(from, to, amount);
    }

    function mintDevToken(uint256 amount) external override {
        require(
            msg.sender == address(getMainContractAddress().project()),
            "only project can release"
        );

        this.transfer(msg.sender, amount);
    }

    function dev2normal(uint256 amount) external override nonReentrant {
        burn(amount);
        getMainContractAddress().normalToken().mintNormalToken(msg.sender, amount);
    }

    function totalReleased() external view override returns (uint256) {
        return totalSupply() - balanceOf(address(this));
    }
}
