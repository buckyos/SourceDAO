// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "./Interface.sol";
import "./SourceDaoUpgradeable.sol";


contract SourceDaoToken is ERC20BurnableUpgradeable, ISourceDAOToken, ReentrancyGuardUpgradeable, SourceDaoContractUpgradeable {
    uint256 public _totalSupply;
    uint256 public _totalReleased;
    uint256 public _totalUnreleased;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(uint256 __totalSupply, address[]calldata initAddress, uint256[] calldata initAmount, address mainAddr) public initializer {
        __ERC20_init("SourceDAOToken", "CDT");
        __ERC20Burnable_init();
        __ReentrancyGuard_init();
        __SourceDaoContractUpgradable_init(mainAddr);

        require(initAddress.length == initAmount.length, "init data error");
        uint256 totalInited = 0;
        for (uint i = 0; i < initAddress.length; i++) {
            _mint(initAddress[i], initAmount[i]);
            totalInited += initAmount[i];
        }

        _totalSupply = __totalSupply;
        _totalUnreleased = _totalSupply - totalInited;
        _totalReleased = totalInited;
    }

    function totalSupply() public view override(ERC20Upgradeable, ISourceDAOToken) returns (uint256) {
        return _totalSupply;
    }

    function totalReleased() public view override returns (uint256) {
        return _totalReleased;
    }

    function totalUnreleased() public view override returns (uint256) {
        return _totalUnreleased;
    }

    function totalInCirculation() public view override returns (uint256) {
        ISourceTokenLockup lockup = getMainContractAddress().lockup();
        uint256 lockupAmount =  lockup.totalLocked(address(0));
        require(_totalReleased >= lockupAmount, "Too much locked tokens");

        return _totalReleased - lockupAmount;
    }

    function prepareProposalParams(address[] memory owners, uint256[] memory amounts) internal pure returns (bytes32[] memory) {
        require(owners.length == amounts.length, "Input arrays must be of same length");

        bytes32[] memory params = new bytes32[](owners.length+1);
        for (uint i = 0; i < owners.length; i++) {
            params[i] = keccak256(abi.encodePacked(owners[i], amounts[i]));
        }
        params[owners.length] = bytes32("releaseTokens");

        return params;
    }

    function prepareReleaseTokens(uint duration, address[] memory owners, uint256[] memory amounts) external override nonReentrant returns (uint) {
        ISourceDaoCommittee committee = getMainContractAddress().committee();
        require(committee.isMember(msg.sender), "Only committee members can call this");

        bytes32[] memory params = prepareProposalParams(owners, amounts);

        return committee.propose(duration, params);
    }

    function releaseTokens(uint proposalId, address[] memory owners, uint256[] memory amounts) external override nonReentrant {
        ISourceDaoCommittee committee = getMainContractAddress().committee();
        require(committee.isMember(msg.sender), "Only committee members can call this");

        bytes32[] memory params = prepareProposalParams(owners, amounts);

        require(committee.takeResult(proposalId, params) == ISourceDaoCommittee.ProposalResult.Accept, "Proposal must be passed");

        for (uint256 i = 0; i < owners.length; i++) {
            require(_totalUnreleased >= amounts[i], "Not enough unreleased tokens");

            _totalReleased += amounts[i];
            _totalUnreleased -= amounts[i];

            _mint(owners[i], amounts[i]);

            emit TokensReleased(owners[i], amounts[i]);
        }

        committee.setProposalExecuted(proposalId);
    }

    function releaseTokensToSelf(uint256 amount) external override nonReentrant {
        require(getMainContractAddress().isAuthorizedAddress(msg.sender), "Address is not authorized");
        require(_totalUnreleased >= amount, "Not enough unreleased tokens");

        _totalReleased += amount;
        _totalUnreleased -= amount;

        _mint(msg.sender, amount);

        emit TokensReleased(msg.sender, amount);
    }

    function burn(uint256 amount) public override(ISourceDAOToken, ERC20BurnableUpgradeable) nonReentrant {
        require(_totalReleased >= amount, "Not enough released tokens");

        _totalReleased -= amount;
        _totalUnreleased += amount;

        super.burn(amount);

        emit TokensReleased(msg.sender, amount);
    }
}
