[中文](README.md) | [English](README.en.md)

# SourceDAO

SourceDAO is an on-chain governance and incentive system for open-source organizations. The current main implementation lives in `contracts/` and focuses on the following capabilities:

- committee governance and token-holder voting
- project creation, acceptance, and contribution settlement
- layered rights through `DevToken / NormalToken`
- lockup release, staking dividends, acquisition flows, and upgrade governance

The repository is built around `Hardhat 3` and `UUPS proxy` patterns.  
Required Node.js runtime: `v22+`, with the latest LTS recommended.

## Overview

SourceDAO is not a single voting contract. It is a set of cooperating modules:

- control layer: `Dao.sol`, `SourceDaoUpgradeable.sol`
- governance layer: `Committee.sol`
- production layer: `Project.sol`
- asset layer: `DevToken.sol`, `NormalToken.sol`, `TokenLockup.sol`, `Dividend.sol`, `Acquired.sol`

If this is your first time reading the project, start with:

1. [docs/Architecture.en.md](docs/Architecture.en.md)
2. [docs/ContractInterfaces.en.md](docs/ContractInterfaces.en.md)
3. [contracts/Dao.sol](contracts/Dao.sol)
4. [contracts/Committee.sol](contracts/Committee.sol)
5. [contracts/Project.sol](contracts/Project.sol)

Chinese references are also available:

- [docs/Architecture.md](docs/Architecture.md)
- [docs/ContractInterfaces.md](docs/ContractInterfaces.md)

## Core Modules

### `Dao.sol`

The system registry. It stores the addresses of all core modules and uses `isDAOContract(...)` to enforce internal call boundaries.

### `Committee.sol`

The governance core. It is responsible for:

- ordinary proposals
- full proposals
- committee membership management
- `devRatio / finalRatio`
- contract upgrade proposals

### `Project.sol`

The project lifecycle manager. It is responsible for:

- project creation
- development-stage transitions
- acceptance proposals
- contribution records
- DevToken reward settlement

### `DevToken.sol` / `NormalToken.sol`

- `DevToken`: contribution-rights token with restricted transfer paths
- `NormalToken`: freely transferable token converted 1:1 from `DevToken`

### `TokenLockup.sol`

Lockup and linear-release module tied to main-project version release state.

### `Dividend.sol`

Staking and dividend module supporting `DevToken / NormalToken` staking and multi-asset rewards.

### `Acquired.sol`

Module for buying `NormalToken` with external assets, supporting both ERC20 and native-token flows.

## Repository Layout

```text
contracts/    current main contracts
docs/         architecture, interfaces, tools, and governance discussion docs
test/         primary test suite
test-hh3/     Hardhat 3 test entrypoints and compatibility helpers
tools/        voting, offline signing, and status helpers
```

Notes:

- `contracts/` should be treated as the current source of truth.
- Historical directories or older scripts, if present, should be read separately from the current implementation.

## Quick Start

### Install dependencies

```bash
npm install
```

### Build

```bash
npx hardhat build
```

### Run tests

```bash
npm test
```

## Tooling

The `tools/` directory is the unified helper-tool layer. It currently includes:

- `tools/vote.ts`: interactive online voting
- `tools/vote_offline.ts`: offline vote signing with `prepare / sign / broadcast`
- `tools/dao_status.ts`: read DAO and module configuration state
- `tools/committee_status.ts`: read committee governance state
- `tools/project_status.ts`: read project lifecycle and contribution state
- `tools/proposal_status.ts`: read ordinary/full proposal state

The root `vote.ts` remains as a compatibility entrypoint, but new usage should target `tools/`.

### Tool configuration

Tools support layered configuration:

1. `tools/config/profiles/<profile>.json`
2. `tools/config/local.json`
3. environment variable overrides

Example files:

- [tools/config/profiles/opmain.json](tools/config/profiles/opmain.json)
- [tools/config/local.example.json](tools/config/local.example.json)

Additional tool docs:

- [tools/README.md](tools/README.md) (Chinese)
- [docs/VoteTool.md](docs/VoteTool.md) (Chinese)
- [docs/VoteOffline.md](docs/VoteOffline.md) (Chinese)
- [docs/StatusTools.md](docs/StatusTools.md) (Chinese)

## Voting and Status Queries

### Online voting

```bash
npx hardhat run tools/vote.ts --network opmain
```

### Offline vote signing

```bash
npx hardhat run tools/vote_offline.ts --network opmain
```

### Read DAO status

```bash
npx hardhat run tools/dao_status.ts --network opmain
```

### Read committee status

```bash
npx hardhat run tools/committee_status.ts --network opmain
```

### Read project status

```bash
npx hardhat run tools/project_status.ts --network opmain
```

### Read proposal status

```bash
npx hardhat run tools/proposal_status.ts --network opmain
```

## Key Documents

### Architecture and interfaces

- [docs/Architecture.en.md](docs/Architecture.en.md)
- [docs/ContractInterfaces.en.md](docs/ContractInterfaces.en.md)
- [docs/NewSourceDao.md](docs/NewSourceDao.md) (Chinese)

### Tools and operations

- [docs/VoteTool.md](docs/VoteTool.md) (Chinese)
- [docs/VoteOffline.md](docs/VoteOffline.md) (Chinese)
- [docs/StatusTools.md](docs/StatusTools.md) (Chinese)

### Change log and governance discussions

- [docs/ContractChangeLog.md](docs/ContractChangeLog.md) (Chinese)
- [docs/FullProposalSnapshotProposal.md](docs/FullProposalSnapshotProposal.md) (Chinese)
- [docs/Committee.md](docs/Committee.md) (Chinese)

## Test Coverage

The current test suite covers both single-contract behavior and multi-module integration, including:

- ordinary and full proposals in `Committee`
- project lifecycle and reward settlement in `Project`
- edge cases in `Dividend`, `TokenLockup`, and `Acquired`
- upgrade compatibility for `Dao` and `Committee`
- offline-signing and status-tool regression coverage in `tools/`

Recommended test entrypoints:

- [test/committee.ts](test/committee.ts)
- [test/project.ts](test/project.ts)
- [test/system_integration.ts](test/system_integration.ts)
- [test/upgrade.ts](test/upgrade.ts)
- [test/vote_tool.ts](test/vote_tool.ts)
- [test/status_tool.ts](test/status_tool.ts)

## Suggested Reading Order

If this is your first time in the repository, a good reading order is:

1. Start with [docs/Architecture.en.md](docs/Architecture.en.md)
2. Then read [docs/ContractInterfaces.en.md](docs/ContractInterfaces.en.md)
3. Move on to [contracts/Dao.sol](contracts/Dao.sol) and [contracts/Committee.sol](contracts/Committee.sol)
4. Then review [contracts/Project.sol](contracts/Project.sol) and the asset-layer contracts
5. Finally, use [docs/ContractChangeLog.md](docs/ContractChangeLog.md) and `test/` to understand current implementation boundaries
