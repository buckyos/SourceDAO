# Local Scenario Seeding

## Goal

This document describes the first local scenario seeding preset for SourceDAO.

The goal is to make the local Hardhat chain and local backend much more useful for:

- frontend page walkthroughs
- end-to-end manual testing
- backend metadata verification
- regression checks against realistic mixed state

The first preset is:

- `full-ui`

It focuses on healthy, readable, demo-friendly state instead of edge-case corruption.

---

## Why This Exists

The default local deploy only creates a very small amount of data:

- one finished project version
- one viewer lockup
- a few token balances

That is enough to boot the stack, but not enough to properly test:

- `/funding`
- `/token`
- `/me`
- project and version lifecycle views
- proposal pages with multiple states
- investment history and active rounds

The seeding script fills that gap.

---

## Command

From [SourceDAO](/home/bucky/work/SourceDAO):

```bash
npm run seed:local
```

This runs:

- [seed_local_scenarios.ts](/home/bucky/work/SourceDAO/scripts/seed_local_scenarios.ts)

The default preset is:

- `full-ui`

---

## Recommended Workflow

For the most predictable result, use a fresh local stack first:

```bash
npm run stack:local:reset
npm run seed:local
```

The script can still run against an already active local stack, but the first version is designed around a fresh reset.

---

## Preconditions

The first version assumes:

1. local Hardhat is running on `127.0.0.1:8545`
2. local backend is running on `127.0.0.1:3333`
3. local contracts have already been deployed
4. backend local auth still allows `devlogin`

The script uses normal backend APIs to submit metadata, so the seeded data exercises both:

- on-chain state
- backend sync and metadata flows

It does not write directly into the database.

If your local stack is currently running in GitHub OAuth mode:

- `SOURCE_DAO_LOCAL_AUTH_MODE='github'`
- `SOURCE_DAO_BACKEND_ALLOW_DEV_LOGIN='false'`

then `npm run seed:local` will fail fast.

For the first version of the seed script, switch local auth back to the default dev mode before seeding.

---

## First Preset Scope

`full-ui` seeds these areas.

### 1. Project Profiles

It creates backend project profiles for:

- one empty project profile with no versions
- one profile with a version still waiting for committee vote
- one profile with a version in `Developing`
- one profile with a version in `Waiting settlement vote`
- one profile with a finished version
- one profile with a rejected version

### 2. Project / Version Lifecycle

It creates versions covering these visible states:

- `Waiting vote`
- `Developing`
- `Waiting settlement vote`
- `Version settled`
- `Rejected`

It also completes the tracked local `Buckyos` unlock version so lockup can become claimable.

### 3. Lockup

It extends the existing local lockup scenario so the final local state includes:

- at least one address with assigned lockup
- at least one address with partially claimed lockup
- an actual released project/version that unlocks the lockup

### 4. Dividend

It deploys a reward token and seeds:

- staked `BDT`
- staked `BDDT`
- a closed reward cycle
- one address that already withdrew dividends
- one address that still has withdrawable dividends

### 5. Funding / Investment

It creates multiple investment rounds so `/funding` and `/invest` show richer data:

- one active step-1 round
- one active step-2 round
- one ended partially filled round
- one ended fully sold round

The seeded investment ratio follows the `Acquired` contract rule:

- `tokenRatio` uses plain token units, not `wei`
- example: `5 LSALE = 1 BDT`

The contract applies token decimals internally.

### 6. Proposal Metadata

For project creation, settlement proposals, and investment rounds, metadata is submitted through backend APIs:

- `/project/extra`
- `/proposal/extra`
- `/twostep/extra`
- `/repo/detail`

This avoids leaving most seeded items in `chain_only` state.

### 7. Manifest

The script writes a manifest file:

- [seed-manifest.json](/home/bucky/work/SourceDAO/.local-dev/seed-manifest.json)

The manifest records:

- labeled accounts
- contract addresses
- seeded project profiles
- project/version IDs and proposal IDs
- investment IDs
- reward token addresses
- key lockup/dividend notes

---

## First Version Design Choices

### Healthy State First

The first preset is intentionally biased toward visible, healthy application state.

It is not primarily an edge-case preset.

That means it tries to produce:

- readable project pages
- readable proposal pages
- active and historical funding rounds
- usable token and dashboard pages

rather than:

- metadata conflicts
- `chain_only` proposals
- expired broken states
- misconfigured contracts

Those edge cases are better handled by a future preset.

### Backend Metadata Uses Real APIs

The script does not insert rows directly into backend tables.

Instead, it:

1. performs real on-chain actions
2. obtains tx hashes
3. uses backend auth locally
4. submits metadata through the same APIs used by the frontend

This makes the seeded state much closer to real production flows.

### Manual, Not Automatic

The first version is a manual command, not part of `stack:local`.

That is intentional:

- local developers sometimes want a minimal chain
- seeded scenarios are stateful and heavy
- automatic reseeding would make debugging harder

---

## Planned Follow-Up

Possible later additions:

- an `edge-cases` preset
- auto-seed after `stack:local:reset`
- richer manifest output
- explicit cleanup/reset helpers
- more governance proposal types
- more investment permutations
