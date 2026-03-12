# SourceDAO Core Contract Interface Guide

This document is intended for developers. It explains the responsibilities, key external interfaces, typical callers, and common calling sequences of the core contracts in the current implementation.

It is recommended to read Architecture.en.md before this document.

## 1. Overview

The current implementation can be grouped into four layers:

- Control layer: Dao.sol, SourceDaoUpgradeable.sol
- Governance layer: Committee.sol
- Production layer: Project.sol
- Asset layer: DevToken.sol, NormalToken.sol, TokenLockup.sol, Dividend.sol, Acquired.sol

Most shared interface definitions are located in contracts/Interface.sol.

## 2. Dao.sol

### Responsibility

Dao.sol is the system-wide registry. It does not implement business logic directly. Instead, it serves as the common entry point through which modules discover each other.

### Key external interfaces

- initialize()
  - Initializes the main contract.
  - The current implementation takes no parameters.

- setDevTokenAddress(address)
- setNormalTokenAddress(address)
- setCommitteeAddress(address)
- setProjectAddress(address)
- setTokenLockupAddress(address)
- setTokenDividendAddress(address)
- setAcquiredAddress(address)
  - Registers module addresses.
  - Each address can only be set once.

- devToken()
- normalToken()
- committee()
- project()
- lockup()
- dividend()
- acquired()
  - Returns the corresponding module instance.

- isDAOContract(address)
  - Checks whether an address is one of the DAO's internal modules.
  - Governance modules rely on this to restrict certain proposal entry points to internal contracts only.

### Typical callers

- Deployment scripts
- Other core modules
- Off-chain read scripts

### Development notes

- This contract is a one-time registry bus, not a free-form control panel.
- The module initialization order affects whether cross-module calls will work correctly.

## 3. SourceDaoUpgradeable.sol

### Responsibility

This is the shared upgrade base for major modules. It stores the main contract address and routes UUPS upgrade authorization into committee governance.

### Key interfaces and behavior

- setMainContractAddress(address)
  - The main contract address can only be set once.

- version()
  - Returns the implementation version.

- Upgrade authorization logic
  - Internally calls committee.verifyContractUpgrade(newImplementation).
  - In other words, upgrades are not decided by an owner or a single admin account, but by governance.

### Typical callers

- UUPS proxy contracts themselves
- The committee upgrade proposal flow

## 4. Committee.sol

### Responsibility

Committee.sol is the governance core. It handles:

- Regular proposals
- Full-community proposals
- Committee membership changes
- DevToken weight adjustments
- Contract upgrade proposals

### Proposal interfaces

- propose(duration, params)
  - Starts a regular proposal.
  - Can only be called by internal DAO modules.
  - A typical caller is Project.sol.

- fullPropose(duration, params, threshold)
  - Starts a full-community proposal.
  - Also intended for internal module calls.
  - Suitable for governance actions that require token-holder participation.

- support(proposalId, params)
- reject(proposalId, params)
  - Casts a vote on a proposal.
  - Verifies that the supplied parameter path matches the proposal's Merkle root.

- settleProposal(proposalId)
  - Actively settles a regular proposal.

- takeResult(proposalId, params)
  - Returns the proposal result and settles it if necessary.
  - Business modules usually use this when executing proposal-driven actions.

- proposalOf(proposalId)
- proposalExtraOf(proposalId)
  - Returns proposal metadata and full-proposal extension data.

- setProposalExecuted(proposalId)
  - Marks a proposal as executed after the related business action has been completed.

### Full-community proposal settlement

- endFullPropose(proposalId, voters)
  - Settles a full-community proposal in batches.
  - Since full votes may involve many addresses, the current design allows voter lists to be submitted incrementally for cumulative settlement.

### Committee management interfaces

- prepareAddMember(address)
- addCommitteeMember(address, proposalId)
- prepareRemoveMember(address)
- removeCommitteeMember(address, proposalId)
- prepareSetCommittees(address[], isFullProposal)
- setCommittees(address[], proposalId)
  - All of these follow a two-step pattern: propose first, execute later.

### Weight adjustment interfaces

- prepareSetDevRatio(newDevRatio)
- setDevRatio(newDevRatio, proposalId)
  - Adjusts the weight of DevToken in full-community voting.
  - Can no longer be changed after the formal release is published.

### Upgrade governance interfaces

- prepareContractUpgrade(proxy, newImplementation)
  - Starts an upgrade proposal for a specific proxy contract.

- verifyContractUpgrade(newImplementation)
  - Called by the proxy contract when executing an upgrade.
  - Returns true only when the matching upgrade proposal has passed.

- cancelContractUpgrade(proxy)
- getContractUpgradeProposal(proxy)
  - Cancels or queries an upgrade proposal.

### Typical call sequence

Regular proposal:

1. A business contract calls propose.
2. Members call support or reject.
3. The business contract calls takeResult.
4. If the result is Accept, the business contract executes the action.
5. The business contract calls setProposalExecuted.

Full-community proposal:

1. A business contract calls fullPropose.
2. Token holders call support or reject.
3. After the deadline, endFullPropose is called in batches.
4. The proposal finally becomes Accept, Reject, or Expired.

### Development notes

- Parameter validation depends on the Merkle root, so execution must supply the same parameter array used to build the proposal.
- setProposalExecuted is not just cosmetic state cleanup. It is an important safeguard against reusing an already-approved proposal.

## 5. Project.sol

### Responsibility

Project.sol manages the lifecycle of an open source project from initiation to completion, and distributes completion rewards according to contribution share.

### Core states

- Preparing: waiting for the initiation proposal
- Developing: under development
- Accepting: waiting for the acceptance proposal
- Finished: completed
- Rejected: failed or rejected

### Key external interfaces

- createProject(budget, name, version, startDate, endDate, extraTokens, extraTokenAmounts)
  - Creates a project.
  - Automatically starts an initiation proposal.
  - The budget is constrained by the DevToken supply rules.

- cancelProject(projectId)
  - Cancels a project when the related proposal fails or expires.
  - If the project carried extra tokens, they are returned to the project manager.

- promoteProject(projectId)
  - Advances the project state after proposal approval.
  - Moves Preparing to Developing.
  - Moves Accepting to Finished and runs the reward settlement logic.

- acceptProject(projectId, result, contributions)
  - Submitted by the project manager with the project result and contribution list.
  - Automatically starts an acceptance proposal.

- updateContribute(projectId, contribution)
  - Updates or adds a contribution value during the acceptance voting stage.

- withdrawContributions(projectIds)
  - Lets contributors claim rewards from completed projects.
  - Also handles the distribution of extra tokens.

- projectOf(projectId)
- projectDetailOf(projectId)
- contributionOf(projectId, who)
- latestProjectVersion(projectName)
- versionReleasedTime(projectName, version)
  - Query project state, contribution, and release information.

### Typical call sequence

1. The project manager calls createProject.
2. The committee votes on the initiation proposal.
3. The project manager calls promoteProject to move the project into Developing.
4. The project manager calls acceptProject with the result and contribution list.
5. The committee votes on the acceptance proposal.
6. The project manager calls promoteProject again to trigger reward issuance.
7. Contributors call withdrawContributions to claim rewards.

### Development notes

- Project creation and project acceptance are not single-step actions. They are both state-machine transitions driven by governance.
- latestProjectVersion and versionReleasedTime are not just read helpers. They are referenced by lockup and governance logic.

## 6. DevToken.sol

### Responsibility

DevToken is a contribution-rights token, not a freely circulating token.

### Key external interfaces

- initialize(name, symbol, totalSupply, initAddress, initAmount, mainAddr)
  - Initializes total supply and the initial distribution.

- mintDevToken(amount)
  - Can only be called by Project.sol.
  - In practice, this releases rewards from the contract-held reserve to the project module.

- dev2normal(amount)
  - Converts DevToken to NormalToken at a 1:1 ratio.

- totalReleased()
  - Returns the total released supply.

### Special behavior

- Transfer logic is restricted to a small set of valid paths.
- Valid paths include project rewards, lockup conversion, and dividend staking.

### Development notes

- DevToken should not be treated as a normal ERC20 token.
- It is closer to a contribution-rights instrument constrained by institutional rules.

## 7. NormalToken.sol

### Responsibility

NormalToken is the transferable token used for transfers, trading, voting weight, and acquisition flows.

### Key external interfaces

- initialize(name, symbol, mainAddr)
- mintNormalToken(to, amount)
  - Can only be called by DevToken.sol.

### Development notes

- The current mint path for NormalToken comes only from DevToken conversion.
- This ensures that transferable rights still originate from contribution-based rights.

## 8. TokenLockup.sol

### Responsibility

TokenLockup.sol handles lockup logic for early investment, capital cooperation, or other special allocations.

### Key external interfaces

- initialize(unlockProjectName, unlockVersion, mainAddr)
  - Sets the project name and version that will trigger release.

- transferAndLock(to[], amount[])
  - Transfers NormalToken into the contract and locks it for a group of recipients.

- convertAndLock(to[], amount[])
  - Converts DevToken to NormalToken first, then locks it for a group of recipients.

- claimTokens(amount)
  - Claims released tokens according to the 6-month linear release schedule after the target version is formally released.

- getCanClaimTokens()
- totalAssigned(owner)
- totalClaimed(owner)
  - Queries claimable amount, total assigned amount, and total claimed amount.

### Development notes

- Once release has started, the contract is no longer suitable for receiving new lockup batches.
- Release is not handled by manually distributing proposal-approved batches. It becomes active automatically based on the target version release time.

## 9. Dividend.sol

### Responsibility

Dividend.sol is a revenue pool and staking pool. It accepts external income and distributes it across participants according to stake share by cycle.

### Key external interfaces

- initialize(cycleMinLength, mainAddr)
  - Sets the minimum cycle length.

- deposit(amount, token)
- receive()
- updateTokenBalance(token)
  - Injects external assets into the dividend pool.
  - Supports native token deposits and ERC20 tokens other than the DAO's own tokens.

- stakeNormal(amount)
- stakeDev(amount)
- unstakeNormal(amount)
- unstakeDev(amount)
  - Stakes and unstakes both token types.

- tryNewCycle()
  - Manually advances the pool into a new cycle.

- getCurrentCycleIndex()
- getCurrentCycle()
- getCycleInfos(start, end)
- getTotalStaked(cycleIndex)
- getDepositTokenBalance(token)
- getStakeAmount(cycleIndex)
  - Queries cycle and staking information.

- isDividendWithdrawed(cycleIndex, token)
- estimateDividends(cycleIndexes, tokens)
- withdrawDividends(cycleIndexes, tokens)
  - Estimates and withdraws dividends from selected cycles.

### Development notes

- The current design explicitly forbids using the DAO's own two tokens as dividend deposit assets.
- Stake accounting follows a cycle snapshot model rather than a real-time per-block model.

## 10. Acquired.sol

### Responsibility

Acquired.sol provides a mechanism for acquiring NormalToken with external assets, including whitelist control and a two-stage quota model.

### Key external interfaces

- initialize(initInvestmentCount, mainAddr)

- startInvestment(param)
  - Starts an acquisition.
  - Can use native token or ERC20 as the payment asset.
  - Supports whitelist restrictions and stage-one allocation ratios.

- invest(investmentId, amount)
  - Lets whitelisted addresses acquire external assets according to the defined rules using NormalToken.

- endInvestment(investmentId)
  - Ends the acquisition and lets the initiator retrieve the NormalToken received plus any unsold remaining assets.

- getInvestmentInfo(investmentId)
- isInWhiteList(investmentId, addr)
- getAddressPercent(investmentId, addr)
- getAddressInvestedAmount(investmentId, addr)
- getAddressLeftAmount(investmentId, addr)
  - Queries acquisition state, whitelist quota, and personal remaining capacity.

### Development notes

- The asset flow of this module is different from the project reward flow. It is closer to a secondary allocation and external asset swap mechanism.
- The acquisition target is NormalToken, not DevToken.

## 11. Common Cross-Contract Call Paths

### Project initiation and completion

- Project.sol calls Committee.sol to start proposals.
- Committee.sol returns governance results.
- Project.sol advances project state and calls DevToken.sol to distribute rewards.

### Converting DevToken to transferable token

- A user holds DevToken.
- The user calls dev2normal.
- DevToken.sol burns the DevToken amount.
- NormalToken.sol mints the same amount of transferable token.

### Lockup release

- A target version is formally released.
- TokenLockup.sol checks Project.sol versionReleasedTime to determine whether release has started.
- The user calls claimTokens to withdraw according to linear release progress.

### Contract upgrade

- A committee member starts an upgrade proposal.
- After committee approval, the proxy contract calls verifyContractUpgrade during upgrade execution.
- The upgrade is only allowed if verification succeeds.

## 12. Suggested Reading Order

If the goal is to understand the interfaces and call relationships, the recommended reading order is:

1. contracts/Interface.sol
2. contracts/Dao.sol
3. contracts/Committee.sol
4. contracts/Project.sol
5. contracts/DevToken.sol
6. contracts/NormalToken.sol
7. contracts/TokenLockup.sol
8. contracts/Dividend.sol
9. contracts/Acquired.sol

If you want to extend the documentation further, the most natural next step is to add either a state diagram or a permission matrix for each contract.