[中文](README.md) | [English](README.en.md)

# SourceDAO

SourceDAO 是一套面向开源组织的链上治理与激励系统。当前主实现位于 `contracts/`，围绕以下几类能力展开：

- 委员会治理与全员投票
- 项目立项、验收与贡献结算
- `DevToken / NormalToken` 双代币分层权益
- 锁仓释放、质押分红、收购与升级治理

仓库使用 `Hardhat 3` 和 `UUPS proxy` 模式组织核心合约。  
Node.js 运行环境要求：`v22+`，推荐最新 LTS。

## 项目概览

从系统职责看，SourceDAO 不是单一投票合约，而是一组协作模块：

- 主控层：`Dao.sol`、`SourceDaoUpgradeable.sol`
- 治理层：`Committee.sol`
- 生产层：`Project.sol`
- 资产层：`DevToken.sol`、`NormalToken.sol`、`TokenLockup.sol`、`Dividend.sol`、`Acquired.sol`

如果是第一次阅读这个项目，建议先看：

1. [docs/Architecture.md](docs/Architecture.md)
2. [docs/ContractInterfaces.md](docs/ContractInterfaces.md)
3. [contracts/Dao.sol](contracts/Dao.sol)
4. [contracts/Committee.sol](contracts/Committee.sol)
5. [contracts/Project.sol](contracts/Project.sol)

英文版本可参考：

- [docs/Architecture.en.md](docs/Architecture.en.md)
- [docs/ContractInterfaces.en.md](docs/ContractInterfaces.en.md)

## 核心模块

### `Dao.sol`

系统总注册表，维护各核心模块地址，并通过 `isDAOContract(...)` 限制内部模块调用边界。

### `Committee.sol`

治理核心，负责：

- 普通提案
- 全员提案
- 委员会成员管理
- `devRatio / finalRatio`
- 合约升级提案

### `Project.sol`

项目生命周期管理，负责：

- 立项
- 开发期状态推进
- 验收提案
- contribution 记录
- DevToken 奖励结算

### `DevToken.sol` / `NormalToken.sol`

- `DevToken`：贡献权益型 Token，流转受限
- `NormalToken`：可流通 Token，由 `DevToken` 1:1 转换得到

### `TokenLockup.sol`

锁仓与线性释放模块，和主项目版本发布状态联动。

### `Dividend.sol`

质押与分红模块，支持 `DevToken / NormalToken` 质押和多资产奖励发放。

### `Acquired.sol`

外部资产收购 `NormalToken` 的模块，支持 ERC20 和原生币路径。

## 仓库结构

```text
contracts/    当前主合约实现
docs/         架构、接口、工具和治理讨论文档
test/         主测试套件
test-hh3/     Hardhat 3 测试入口与兼容辅助
tools/        投票、离线签名、状态读取等辅助工具
```

说明：

- 当前应优先以 `contracts/` 为准理解系统。
- 历史目录和旧脚本如果存在，应和当前主实现区分阅读。

## 快速开始

### 安装依赖

```bash
npm install
```

### 编译

```bash
npx hardhat build
```

### 运行测试

```bash
npm test
```

## 工具入口

`tools/` 目录已经整理为统一的辅助工具层，当前主要包括：

- `tools/vote.ts`：在线交互式投票
- `tools/vote_offline.ts`：离线签名投票，支持 `prepare / sign / broadcast`
- `tools/dao_status.ts`：读取 DAO 和模块配置状态
- `tools/committee_status.ts`：读取委员会治理状态
- `tools/project_status.ts`：读取项目生命周期和贡献状态
- `tools/proposal_status.ts`：读取普通/全员提案状态

根目录的 `vote.ts` 仍保留兼容入口，但新的使用方式应优先走 `tools/`。

### 工具配置

工具支持分层配置：

1. `tools/config/profiles/<profile>.json`
2. `tools/config/local.json`
3. 环境变量覆盖

示例文件：

- [tools/config/profiles/opmain.json](tools/config/profiles/opmain.json)
- [tools/config/local.example.json](tools/config/local.example.json)

更多工具说明见：

- [tools/README.md](tools/README.md)
- [docs/VoteTool.md](docs/VoteTool.md)
- [docs/VoteOffline.md](docs/VoteOffline.md)
- [docs/StatusTools.md](docs/StatusTools.md)

## 投票与状态查询

### 在线投票

```bash
npx hardhat run tools/vote.ts --network opmain
```

### 离线签名投票

```bash
npx hardhat run tools/vote_offline.ts --network opmain
```

### 读取 DAO 状态

```bash
npx hardhat run tools/dao_status.ts --network opmain
```

### 读取委员会状态

```bash
npx hardhat run tools/committee_status.ts --network opmain
```

### 读取项目状态

```bash
npx hardhat run tools/project_status.ts --network opmain
```

### 读取提案状态

```bash
npx hardhat run tools/proposal_status.ts --network opmain
```

## 关键文档

### 架构与接口

- [docs/Architecture.md](docs/Architecture.md)
- [docs/ContractInterfaces.md](docs/ContractInterfaces.md)
- [docs/NewSourceDao.md](docs/NewSourceDao.md)

### 工具与运维

- [docs/VoteTool.md](docs/VoteTool.md)
- [docs/VoteOffline.md](docs/VoteOffline.md)
- [docs/StatusTools.md](docs/StatusTools.md)

### 变更与治理讨论

- [docs/ContractChangeLog.md](docs/ContractChangeLog.md)
- [docs/FullProposalSnapshotProposal.md](docs/FullProposalSnapshotProposal.md)
- [docs/Committee.md](docs/Committee.md)

## 测试覆盖

当前测试不仅覆盖单合约行为，也包含多模块联动和升级回归，重点包括：

- `Committee` 普通提案 / 全员提案
- `Project` 生命周期与奖励结算
- `Dividend`、`TokenLockup`、`Acquired` 业务边界
- `Dao` / `Committee` 升级兼容
- `tools/` 层离线签名和状态查询回归

如需深入理解当前测试入口，可从以下文件开始：

- [test/committee.ts](test/committee.ts)
- [test/project.ts](test/project.ts)
- [test/system_integration.ts](test/system_integration.ts)
- [test/upgrade.ts](test/upgrade.ts)
- [test/vote_tool.ts](test/vote_tool.ts)
- [test/status_tool.ts](test/status_tool.ts)

## 阅读建议

如果你是第一次进入这个仓库，推荐按下面顺序建立整体认知：

1. 先读 [docs/Architecture.md](docs/Architecture.md)
2. 再读 [docs/ContractInterfaces.md](docs/ContractInterfaces.md)
3. 然后看 [contracts/Dao.sol](contracts/Dao.sol) 和 [contracts/Committee.sol](contracts/Committee.sol)
4. 再看 [contracts/Project.sol](contracts/Project.sol) 和资产层合约
5. 最后结合 [docs/ContractChangeLog.md](docs/ContractChangeLog.md) 和 `test/` 理解当前实现边界
