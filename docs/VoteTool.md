# Vote Tool

## 目标

`tools/vote.ts` 是当前仓库内的交互式投票辅助脚本，用于向 `SourceDaoCommittee` 提交 `support` / `reject` 交易。

它的定位是：

- 面向真实链上治理操作的辅助工具
- 默认服务于当前 `opmain` 的 `SourceDAO`
- 依赖后台接口拉取 proposal 参数
- 目前只覆盖少数 proposal 类型
- 已提供一版不改合约的离线签名辅助流程

它不是一个通用治理 CLI，也不是一个离线参数构造器。

## 当前入口

推荐入口：

```bash
npx hardhat run tools/vote.ts --network opmain
```

兼容入口：

```bash
npx hardhat run vote.ts --network opmain
```

根目录的 `vote.ts` 只是一个兼容转发入口，后续应优先使用 `tools/vote.ts`。

离线签名入口：

```bash
npx hardhat run tools/vote_offline.ts --network opmain
```

离线签名流程说明见：

- [VoteOffline.md](VoteOffline.md)

## 前置条件

1. Node.js 使用 `v22+`
2. 在仓库根目录执行过 `npm i`
3. 在 `hardhat.config.ts` 里配置了目标网络和投票私钥
4. 投票私钥放在对应网络 `accounts` 数组的第一位
5. 操作者已经确认自己连接的是正确网络和正确 DAO 地址

示例：

```ts
networks: {
    opmain: {
        url: "your opmain endpoint url",
        accounts: [
            "your private key, begin with 0x",
        ]
    }
}
```

## 可选环境变量

当前脚本保留了默认地址和默认后台接口，但支持用环境变量覆盖：

- `SOURCE_DAO_ADDRESS`
  - 默认值：当前 `opmain` DAO 地址
  - 用途：切换到另一个 DAO 实例

- `SOURCE_DAO_API_BASE`
  - 默认值：`https://dao.buckyos.org/api`
  - 用途：切换到另一个 proposal backend

示例：

```bash
SOURCE_DAO_ADDRESS=0xYourDaoAddress \
SOURCE_DAO_API_BASE=https://dao.example.org/api \
npx hardhat run tools/vote.ts --network opmain
```

## JSON 配置文件

当前工具还支持读取 JSON 配置文件。

默认查找顺序：

1. 仓库根目录 `vote.config.json`
2. `tools/vote.config.json`

也可以通过环境变量显式指定：

```bash
SOURCE_DAO_CONFIG=./tools/vote.config.json \
npx hardhat run tools/vote.ts --network opmain
```

推荐做法是：

1. 复制 [../tools/vote.config.example.json](../tools/vote.config.example.json) 为你自己的配置文件
2. 填入常用的 `daoAddress`、`proposalApiBase`、`voterAddress`
3. 运行时只在需要覆盖时再用环境变量

支持字段：

- `daoAddress`
- `proposalApiBase`
- `voterAddress`
- `offline.mode`
- `offline.input`
- `offline.output`
- `offline.signedOutput`
- `offline.broadcastOutput`

如果配置文件里的 `offline.input/output` 使用相对路径，当前实现会按配置文件所在目录解析。

优先级是：

1. 环境变量
2. JSON 配置文件
3. 脚本内默认值

当前第一版只支持 `JSON`，还没有接入 `TOML` 解析。

## 使用流程

1. 运行脚本
2. 检查输出的网络名、RPC endpoint、DAO 地址、签名地址
3. 输入 proposal id
4. 检查链上 proposal 的基础信息
5. 选择 `support` 或 `reject`
6. 脚本从后台拉取 proposal 参数
7. 检查后台返回的参数是否与预期一致
8. 输入 `y` 确认，发送链上交易
9. 等待交易确认

## 离线签名

当前仓库已经提供一个最小版离线签名流程：

1. 在线机器 `prepare`
2. 离线机器 `sign`
3. 在线机器 `broadcast`

这个版本不修改合约，只是把真实链上交易拆成准备、签名、广播三步。

详细说明见：

- [VoteOffline.md](VoteOffline.md)

## 当前支持的 proposal 类型

脚本目前只支持以下 proposal 参数编码：

- `createProject`
- `acceptProject`
- `upgradeContract`
- `setCommittees`

如果后台返回其他 proposal 类型，脚本会直接报错并退出。

这意味着：

- 工具能力受限于链上 proposal 类型和后台返回格式
- 新增 proposal 类型时，需要同步更新 `tools/vote.ts`

## full proposal 的特别说明

当脚本检测到目标 proposal 是 `full proposal` 时，会显示当前地址的 `DevToken` / `NormalToken` 余额，以及按当前 `devRatio` 计算出的一个估算票数。

这里需要明确：

- 这个数字只是当前状态下的提示信息
- 它不是最终治理结果的权威票数
- 最终结算仍然以合约的链上逻辑为准

当前仓库已经把 full proposal 的统一快照问题单独记录在：

- [FullProposalSnapshotProposal.md](FullProposalSnapshotProposal.md)

## 已知限制

### 1. 默认仍偏向单环境使用

虽然脚本现在支持用环境变量覆盖 DAO 地址和后台 API，但默认行为仍是指向当前 `opmain` 部署。

### 2. 强依赖后台接口

脚本不会在本地自行恢复完整 proposal 参数，而是调用：

```text
https://dao.buckyos.org/api/proposal/:id
```

因此只要后台不可用、返回字段变化、或 proposal schema 演进，脚本就可能失败。

### 3. 不是通用 proposal 浏览器

脚本只做投票，不负责：

- proposal 列表查询
- 历史交易索引
- 参数对比和差异审计
- `endFullPropose(...)` 的批量结算

### 4. 当前没有独立单元测试

脚本目前仍属于运维辅助工具，主要依赖人工执行和链上反馈验证。后续如果继续扩展 proposal 类型，建议把参数编码和后端响应解析拆出来做单测。

## 常见失败场景

### `No signer found`

- 检查 `hardhat.config.ts` 里对应网络是否配置了 `accounts`
- 检查投票私钥是否在第一个位置

### `Proposal X not found`

- 检查 proposal id 是否正确
- 检查连接到的 DAO 地址是否正确
- 检查连接的网络是否正确

### `Unsupported proposal type`

- 说明后台返回的 proposal 类型当前脚本还不支持
- 需要补充 `tools/vote.ts` 里的参数编码逻辑

### `only token holders can vote`

- 这是 full proposal 下的链上拒绝
- 当前地址在该提案结算语义下没有有效票权

### `already voted`

- 当前地址已经对该 proposal 提交过投票

### `invalid params`

- 后台返回的参数与链上 proposal 期望编码不一致
- 或脚本本地的 proposal 参数编码逻辑已经落后于合约

## 后续整理建议

如果继续扩展治理辅助工具，建议按下面的方向演进：

1. 把 proposal 参数编码拆成独立模块
2. 为后端响应格式加显式 schema 校验
3. 增加网络和 `chainId` 防呆检查
4. 增加更多 proposal 类型支持
5. 为工具层单独增加测试
6. 把其他辅助脚本逐步归拢到 `tools/`
