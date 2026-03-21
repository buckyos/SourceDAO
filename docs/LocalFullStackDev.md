# Local Full Stack Development

## Goal

This document describes the shortest way to bring up the local SourceDAO stack for browser debugging:

1. local Hardhat chain
2. locally deployed `SourceDAO` contracts
3. local `SourceDAOBackend`
4. local `buckydaowww` frontend

The one-command entry point lives in:

- [local_dev_stack.sh](/home/bucky/work/SourceDAO/scripts/local_dev_stack.sh)

---

## Start Everything

From [SourceDAO](/home/bucky/work/SourceDAO):

```bash
npm run stack:local
```

The script will:

1. start or reuse `hardhat node` on `127.0.0.1:8545`
2. deploy a fresh local SourceDAO stack
3. write [buckydaowww/src/.env.local](/home/bucky/work/buckydaowww/src/.env.local)
4. generate [SourceDAOBackend/src/config.local.toml](/home/bucky/work/SourceDAOBackend/src/config.local.toml)
5. start `SourceDAOBackend`
6. start the Next.js frontend

When it succeeds, you can open:

- Frontend: `http://127.0.0.1:3000`
- Backend: `http://127.0.0.1:3333`
- Hardhat RPC: `http://127.0.0.1:8545`

If `3000` is already occupied by another local Next.js process, you can override the frontend port:

```bash
SOURCE_DAO_FRONTEND_PORT=3001 npm run stack:local
```

Then open:

- `http://127.0.0.1:3001`

---

## Stop Everything

```bash
npm run stack:local:stop
```

This only stops processes started by the local stack script.

---

## Logs

Logs are written under:

- [SourceDAO/.local-dev/logs](/home/bucky/work/SourceDAO/.local-dev/logs)

Key files:

- `hardhat.log`
- `backend.log`
- `frontend.log`

---

## What Gets Generated

- frontend env:
  [buckydaowww/src/.env.local](/home/bucky/work/buckydaowww/src/.env.local)
- backend config:
  [SourceDAOBackend/src/config.local.toml](/home/bucky/work/SourceDAOBackend/src/config.local.toml)

Both are local-only files and should not be committed.

---

## Notes

- The backend defaults to SQLite in local mode.
- If an external Hardhat node is already running on `127.0.0.1:8545`, the script will reuse it.
- If frontend or backend ports are occupied by unrelated processes, the script will stop with a clear error instead of reusing them silently.
- If frontend `node_modules` is missing, the script will run `npm i` in [buckydaowww/src](/home/bucky/work/buckydaowww/src) before starting `next dev`.
