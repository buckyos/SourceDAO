// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./Interface.sol";
import "./SourceDaoUpgradeable.sol";

// Token分两种：DevToken和NormalToken
// DevToken只能通过开发活动得到
// DevToken只能有限转账
// DevToken只能单向转换到NormalToken

contract SourceDaoToken is ERC20BurnableUpgradeable, ISourceDAOToken, ReentrancyGuardUpgradeable, SourceDaoContractUpgradeable {
    uint256 public _totalSupply;
    uint256 public _totalReleased;
    uint256 public _totalUnreleased;

    mapping(address account => uint256) _dev_balances;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(string memory name, string memory symbol, uint256 __totalSupply, address[]calldata initAddress, uint256[] calldata initAmount, address mainAddr) public initializer {
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

    function releaseDevTokensToSelf(uint256 amount) external override nonReentrant {
        require(msg.sender == address(getMainContractAddress().devGroup()), "only dev group can call this");
        require(_totalUnreleased >= amount, "Not enough unreleased tokens");

        _totalReleased += amount;
        _totalUnreleased -= amount;

        _dev_balances[msg.sender] += amount;

        emit TokensReleased(msg.sender, amount);
    }

    function burn(uint256 amount) public override(ISourceDAOToken, ERC20BurnableUpgradeable) nonReentrant {
        require(_totalReleased >= amount, "Not enough released tokens");

        _totalReleased -= amount;
        _totalUnreleased += amount;

        super.burn(amount);

        emit TokensReleased(msg.sender, amount);
    }

    function dev2normal(uint256 amount) external nonReentrant {
        require(_dev_balances[msg.sender] >= amount, "Not enough dev tokens");
        _dev_balances[msg.sender] -= amount;
        _mint(msg.sender, amount);
    }

    function balanceOfDev(address account) external view returns (uint256) {
        return _dev_balances[account];
    }

    function balanceOf(address account) public view override(ERC20Upgradeable, IERC20) returns (uint256) {
        return super.balanceOf(account) + _dev_balances[account];
    }

    function balanceOfNormal(address account) external view returns (uint256) {
        return super.balanceOf(account);
    }

    // 只有少数情况下，需要转账DevToken
    function transferDev(address to, uint256 amount) external override nonReentrant {
        require(_dev_balances[msg.sender] >= amount, "Not enough dev tokens");
        require(msg.sender == address(getMainContractAddress().devGroup()), "only dev group can call this");
        require(false, "Not allowed to transfer dev tokens");
        _dev_balances[msg.sender] -= amount;
        _dev_balances[to] += amount;
    }
}
