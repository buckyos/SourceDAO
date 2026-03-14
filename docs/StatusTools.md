# Status Tools

## 目标

`tools/dao_status.ts`、`tools/committee_status.ts` 和 `tools/proposal_status.ts` 是当前仓库里的只读辅助工具。

它们的定位是：

- 快速读取链上治理和系统状态
- 默认不发送交易
- 适合做运维检查、提案确认和发布前核对

## 当前工具

### `tools/dao_status.ts`

读取 `SourceDao` 的整体系统状态，包括：

- `version`
- `bootstrapAdmin`
- `bootstrapFinalized`
- 7 个核心模块地址
- 每个模块是否已配置
- 每个模块是否有代码
- `SourceDao.isDAOContract(...)` 是否识别该地址
- 模块是否实现 `version()`

### `tools/committee_status.ts`

读取当前委员会治理状态，包括：

- `committeeVersion`
- 当前委员会成员和数量
- `devRatio / finalRatio`
- `mainProjectName / finalVersion`
- final version 是否已经发布
- 可选观察地址的当前 ordinary / full proposal 投票资格
- 可选观察地址的 `DevToken / NormalToken` 余额和当前 full proposal 票重

### `tools/proposal_status.ts`

读取单个 proposal 的状态，包括：

- proposal 是否存在
- ordinary / full proposal 类型
- `state`
- `fromGroup / origin`
- `expired`
- `support / reject` 地址和数量
- full proposal 的 `threshold / agree / reject / settled / pending`

当前普通 proposal 的 snapshot version 没有公开 getter，所以工具会明确提示这项状态目前无法直接从链上接口读取。

## 使用方式

### Dao 状态

```bash
npx hardhat run tools/dao_status.ts --network opmain
```

### Committee 状态

```bash
npx hardhat run tools/committee_status.ts --network opmain
```

### Proposal 状态

```bash
npx hardhat run tools/proposal_status.ts --network opmain
```

如果没有通过环境变量或配置文件提供 proposal id，`proposal_status.ts` 会进入交互输入。

## 输出格式

默认输出是文本格式。

如果需要 JSON：

```bash
SOURCE_DAO_OUTPUT_FORMAT=json \
npx hardhat run tools/dao_status.ts --network opmain
```

或：

```bash
SOURCE_DAO_OUTPUT_FORMAT=json \
SOURCE_DAO_PROPOSAL_ID=123 \
npx hardhat run tools/proposal_status.ts --network opmain
```

## 配置文件

这两个状态工具与 `vote.ts` / `vote_offline.ts` 共用同一套分层 JSON 配置读取逻辑。

推荐结构：

1. `tools/config/profiles/<profile>.json`
2. `tools/config/local.json`

示例文件见：

- [../tools/config/profiles/opmain.json](../tools/config/profiles/opmain.json)
- [../tools/config/local.example.json](../tools/config/local.example.json)

### 状态工具相关字段

```json
{
  "daoAddress": "0xYourDaoAddress",
  "status": {
    "address": "0xAddressToInspect",
    "proposalId": 123,
    "output": "json"
  }
}
```

支持字段：

- `daoAddress`
- `status.address`
- `status.proposalId`
- `status.output`

优先级：

1. 环境变量
2. `SOURCE_DAO_CONFIG` 指向的旧单文件配置
3. `local` 配置
4. `profile` 配置
5. 默认值

## 可选环境变量

### 通用

- `SOURCE_DAO_PROFILE`
  - 指定 profile 名称

- `SOURCE_DAO_PROFILE_PATH`
  - 显式指定 profile 配置文件路径

- `SOURCE_DAO_LOCAL_CONFIG`
  - 显式指定本地配置文件路径

- `SOURCE_DAO_CONFIG`
  - 旧单文件配置兼容入口

- `SOURCE_DAO_ADDRESS`
  - 覆盖默认 DAO 地址

- `SOURCE_DAO_OUTPUT_FORMAT`
  - `text` 或 `json`

- `SOURCE_DAO_STATUS_ADDRESS`
  - 为 `committee_status.ts` 指定要观察的地址；若未提供，会回退到 `voterAddress`

### Proposal 状态

- `SOURCE_DAO_PROPOSAL_ID`
  - 直接指定 proposal id，避免交互输入

## 当前边界

这两个工具是只读工具，不会发送交易。

当前仍有几个边界需要知道：

1. 普通 proposal 的 snapshot version 当前没有公开 getter
2. full proposal 哪些具体 voter 已经 `settled` 当前也没有公开 getter
3. full proposal 工具能给出 `pendingSettleCount`，但不能精确列出每个未 settle 地址
4. `committee_status.ts` 当前可以判断“当前”委员会资格和 full proposal 当前票重，但不会追溯历史快照

如果后续需要更深的 full proposal 诊断，下一步更适合单独补一个 `full_proposal_status.ts`

## 当前测试覆盖

当前已经有工具层回归测试覆盖：

- `dao_status` 的已配置 / 已 finalize 状态读取
- `committee_status` 的治理参数、成员和观察地址资格读取
- ordinary proposal 状态读取
- full proposal 状态读取

以及：

- 离线签名 bundle 的签名和广播路径

这些测试都已进入当前 Hardhat 3 测试套件。
