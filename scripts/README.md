# SourceDAO Scripts

这个目录里的脚本来自两个阶段：

1. 早期 SourceDAO 作为普通可升级合约部署在已有 EVM 链上，脚本主要围绕 `hardhat + upgrades` 做部署和后续升级。
2. 引入 USDB 链后，DAO 和 Dividend 支持内置合约地址冷启动，脚本增加了 `artifacts-usdb` 构建、内置地址初始化、模块部署和前后端本地联调流程。

因此这里同时存在推荐使用的当前脚本、测试/审计脚本，以及只适合作为历史参考的旧脚本。生产或主网操作前，优先使用当前推荐入口；legacy 脚本不要直接运行。

当前结论：

- USDB 冷启动使用 `usdb_bootstrap_smoke.ts` 和 `usdb_bootstrap_full.ts`。
- 本地前端/后端联调使用 `local_dev_stack.sh`、`deploy_frontend_local.ts` 和 `seed_local_scenarios.ts`。
- `deploy_all*.ts` 和 `update_*.ts` 是历史脚本，不是当前生产级入口。
- 如果还需要“已有链上 SourceDAO 的正式部署/升级入口”，应新建参数化脚本，复用 full bootstrap 中的强校验思路。

## 环境前提

- 当前 Hardhat 3 需要 Node.js `22.13.0+`。如果默认 `node -v` 是 18.x，`npm run build:usdb` 会直接失败。
- 常规合约 artifacts 输出到 `artifacts/`，USDB profile 输出到 `artifacts-usdb/`。
- USDB profile 使用 `evmVersion: shanghai`，并配套 `audit_usdb_bytecode.mjs` 检查不兼容 opcode。
- 本地联调脚本默认假设三个工程是同级目录：
  - `SourceDAO`
  - `SourceDAOBackend`
  - `buckydaowww/src`

## 推荐入口

| 目标 | 推荐命令 | 说明 |
| --- | --- | --- |
| 编译当前合约 | `npm run build` | 使用默认 Hardhat profile，输出到 `artifacts/`。 |
| 编译 USDB 版本 | `npm run build:usdb` | 输出到 `artifacts-usdb/`，会先清理 `artifacts-usdb` 和 `cache-usdb`。 |
| 检查 USDB bytecode | `npm run test:usdb:audit` | 检查 `artifacts-usdb` 中是否包含 USDB 不支持的 opcode。 |
| USDB 编译并审计 | `npm run test:usdb:compile-and-audit` | 推荐作为 USDB 部署前检查。 |
| USDB 内置合约 smoke | `npm run test:usdb:smoke` | 初始化/检查内置 DAO + Dividend，并做 native deposit smoke。 |
| 本地链 | `npm run node:local` | 启动 Hardhat localhost。 |
| 本地前端合约部署 | `npm run deploy:frontend-local` | 部署完整本地合约栈，打印前端 `.env.local` 内容。 |
| 本地前端合约部署并写 env | `npm run deploy:frontend-local:write` | 写入 `../buckydaowww/src/.env.local`。 |
| 一键本地联调 | `npm run stack:local:reset` | 启动/重置 Hardhat、部署合约、重置后端 sqlite、启动后端和前端。 |
| 停止本地联调 | `npm run stack:local:stop` | 停止前端和后端，默认保留 Hardhat 链。 |
| 停止全部本地联调 | `bash scripts/stop_local_dev_stack.sh --all` | 额外停止由脚本管理的 Hardhat node。 |
| 灌入本地 UI 数据 | `npm run seed:local` | 依赖本地后端 dev login，目前只支持 `full-ui` preset。 |

## USDB 冷启动脚本

### `usdb_bootstrap_smoke.ts`

用途：验证 USDB 内置地址冷启动的最小路径。

它假设 DAO 和 Dividend 已经在链上固定地址有 code，不负责部署这两个内置合约。脚本会：

- 检查 `chainId`。
- 检查 DAO 和 Dividend 地址有 code。
- 如果 DAO 未初始化，则调用 `Dao.initialize()`。
- 如果 Dividend 未初始化，则调用 `Dividend.initialize(cycleMinLength, daoAddress)`。
- 将 Dividend 地址写入 DAO。
- 向 Dividend 发送一笔 native token，确认收款路径可用。

默认配置：`tools/config/sourcedao-local.json`。

可用参数和环境变量：

```bash
npm run build:usdb
npm run test:usdb:audit
npx tsx scripts/usdb_bootstrap_smoke.ts \
  --config tools/config/sourcedao-local.json \
  --rpc-url http://127.0.0.1:8545
```

也可以用：

- `SOURCE_DAO_USDB_CONFIG`
- `SOURCE_DAO_USDB_RPC_URL`

配置字段包括：

- `chainId`
- `rpcUrl`
- `artifactsDir`
- `daoAddress`
- `dividendAddress`
- `bootstrapAdminPrivateKey`
- `cycleMinLength`
- `nativeDepositWei`
- `transactionGasLimit`
- `nativeTransferGasLimit`

### `usdb_bootstrap_full.ts`

用途：完整 USDB 冷启动。适合 USDB 链内置 DAO/Dividend 地址已经存在后，部署并 wiring 其他模块：

- Committee
- DevToken
- NormalToken
- TokenLockup
- Project
- Acquired

脚本会先处理 DAO 和 Dividend 初始化，然后部署缺失模块，并写入 DAO 的一次性模块地址槽位。当前版本已经加入强校验：

- existing 模块会做接口 smoke 和关键初始化不变量校验。
- fresh 部署模块会校验初始化参数、公开 getter、token supply 等。
- 每个 `Dao.set*Address` 都会先 `staticCall`，再发送交易，之后用 DAO getter readback。
- 写入后确认 `dao.isDAOContract(moduleAddress) == true`。
- 结束前再次检查所有 final wiring。

推荐命令。先复制配置样例，并删除 `artifactsDir` 使用默认 `artifacts-usdb`，或把它改成绝对路径/相对配置文件的正确路径：

```bash
npm run build:usdb
npm run test:usdb:audit
npx tsx scripts/usdb_bootstrap_full.ts \
  --config /path/to/sourcedao-bootstrap-full.json \
  --rpc-url http://127.0.0.1:8545 \
  --state-file .local-dev/usdb-bootstrap-state.json
```

也可以用：

- `SOURCE_DAO_USDB_CONFIG`
- `SOURCE_DAO_USDB_RPC_URL`
- `SOURCE_DAO_USDB_STATE_FILE`
- `SOURCE_DAO_REPO_DIR`

注意：

- DAO 模块地址槽位是一次性设置的。生产环境必须先用测试链或 fork 验证配置。
- `daoAddress` 和 `dividendAddress` 不是脚本部署出来的，它们必须已经是 USDB 内置地址并且有 code。
- `artifactsDir` 在 full bootstrap 中按配置文件所在目录解析；如果配置文件放在 `tools/config/`，可以省略该字段使用默认 `artifacts-usdb`，或写成相对该配置文件的正确路径，例如 `../../artifacts-usdb`。
- 缺失的 `committee/devToken/normalToken/tokenLockup/project/acquired` 配置会回落到脚本内 legacy defaults，但生产配置应显式写全。
- `--state-file` 会持续写入进度快照，适合 UI 或运维面板展示 bootstrap 状态。

## 本地前端/后端联调脚本

### `deploy_frontend_local.ts`

用途：在 Hardhat localhost 上部署一套完整合约栈，给前端本地调试使用。

脚本会：

- 部署 DAO、Committee、Project、DevToken、NormalToken、TokenLockup、Dividend、Acquired。
- 在 wiring 前校验模块类型和初始化参数。
- 通过 `staticCall -> tx -> getter readback -> isDAOContract` 写入 DAO 模块槽位。
- seed 少量 token、lockup 和一个 finished project，让前端页面有可读数据。
- 打印前端 `.env.local` 所需变量。

常用命令：

```bash
npm run node:local
npm run deploy:frontend-local
npm run deploy:frontend-local:write
```

可用参数和环境变量：

- `--write-frontend-env [path]`
- `--frontend-env-output <path>`
- `FRONTEND_ENV_OUTPUT=default`
- `FRONTEND_BACKEND_URL`
- `FRONTEND_LOCAL_AUTH_MODE`
- `SOURCE_DAO_LOCAL_AUTH_MODE`

### `local_dev_stack.sh`

用途：一键拉起本地完整开发栈。

它会：

- 检查/启动 Hardhat node。
- 必要时运行 `deploy:frontend-local:write`。
- 启动 `../SourceDAOBackend` 的本地后端。
- 启动 `../buckydaowww/src` 的 Next dev server。
- 写日志和 pid 到 `.local-dev/`。

常用命令：

```bash
npm run stack:local
npm run stack:local:reset
npm run stack:local:stop
```

主要环境变量：

- `SOURCE_DAO_FRONTEND_HOST`，默认 `127.0.0.1`
- `SOURCE_DAO_FRONTEND_PORT`，默认 `3000`
- `SOURCE_DAO_BACKEND_LISTEN`，默认 `127.0.0.1:3333`
- `SOURCE_DAO_HARDHAT_RPC_URL`，默认 `http://127.0.0.1:8545`

`--reset` 会重启脚本管理的 Hardhat、本地重新部署合约，并重置后端 sqlite。没有 `--reset` 时，如果已有 Hardhat 链和前端 env，会尽量复用。

### `stop_local_dev_stack.sh`

用途：停止 `local_dev_stack.sh` 拉起的进程。

```bash
npm run stack:local:stop
bash scripts/stop_local_dev_stack.sh --all
```

默认只停前端和后端，保留 Hardhat 链；`--all` 会同时停止脚本管理的 Hardhat node。

### `seed_local_scenarios.ts`

用途：给本地联调环境灌入更完整的 UI 场景数据。它依赖本地后端，并且后端必须启用 dev login。

当前只支持：

```bash
npm run seed:local
```

等价于：

```bash
SOURCE_DAO_LOCAL_SCENARIO=full-ui \
hardhat run scripts/seed_local_scenarios.ts --network localhost
```

可用参数和环境变量：

- `--preset full-ui`
- `--backend-url http://127.0.0.1:3333`
- `--manifest .local-dev/seed-manifest.json`
- `SOURCE_DAO_LOCAL_SCENARIO`
- `SOURCE_DAO_BACKEND_URL`
- `SOURCE_DAO_LOCAL_SCENARIO_MANIFEST`

它会创建项目生命周期、proposal metadata、投资轮、分红周期、项目 profile 等数据，并把结果写入 manifest。

## 测试和审计辅助脚本

### `audit_usdb_bytecode.mjs`

用途：检查 USDB artifacts 是否含有 USDB 当前不支持的 Cancun 相关 opcode。

默认扫描 `artifacts-usdb`，也可通过 `SOURCE_DAO_ARTIFACTS_DIR` 覆盖。

```bash
npm run build:usdb
npm run test:usdb:audit
```

当前禁止项：

- `BLOBHASH`
- `BLOBBASEFEE`
- `TLOAD`
- `TSTORE`
- `MCOPY`

## 历史/参考脚本

这些脚本保留了项目历史演进信息，但不应直接作为当前部署入口。它们可能包含硬编码地址、旧合约名、旧 setter、ethers v5 写法或 OpenZeppelin upgrades 旧接口。

| 脚本 | 状态 | 说明 |
| --- | --- | --- |
| `deploy_all.ts` | legacy，不推荐运行 | 早期一次性部署脚本，引用 `SourceDaoToken`、`Investment`、`MarketingContract`、`MultiSigWallet` 和旧 DAO setter，如 `setTokenAddress`、`setDevAddress`。与当前 DevToken/NormalToken/Acquired 模块体系不匹配。 |
| `deploy_all_as_sourcedao.ts` | 历史增量部署脚本，不推荐直接运行 | 面向已有 SourceDao 地址做模块补齐，包含多条历史主网/测试网硬编码地址。当前生产使用前必须先参数化、移除硬编码地址，并补齐强校验。 |
| `update_committee.ts` | 历史升级参考 | 针对硬编码 amoy DAO 地址部署 Committee 新 implementation，只打印 implementation 地址，不完成治理提案执行。 |
| `update_dev.ts` | legacy，不兼容当前接口 | 使用旧 `devGroup()`、`ethers.utils.*`、`receipt.events` 等旧写法，且面向旧 ProjectManagement 升级流程。 |
| `update_invsement.ts` | legacy，不兼容当前接口 | 文件名和变量沿用 `invsement` 拼写，目标是旧 `Investment` 模块；当前对应模块已是 `Acquired`。 |

如果需要恢复“已有链上 SourceDAO 的正式升级脚本”，建议新建一个参数化脚本，而不是直接修改 legacy 文件：

- 从 profile/config 读取 DAO 地址、模块名、proxy 地址、new implementation 地址或 factory 名。
- 部署 implementation 后，调用当前 Committee 的 `prepareContractUpgrade`。
- 输出 proposal id、params、calldata hash 和待签名/待投票信息。
- 在执行 `upgradeTo` 前做 implementation code、version、storage layout 和接口 smoke。
- 不要在脚本里硬编码生产地址或私钥。

## 目录边界

- `scripts/`：会改变链上状态、启动服务、部署合约、seed 本地数据或做构建审计。
- `tools/`：偏只读状态查询、投票辅助和操作者工具。新增只读治理/status 工具优先放 `tools/`。
