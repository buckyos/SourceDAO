# Offline Vote Flow

## 目标

`tools/vote_offline.ts` 提供一个不改合约的最小版离线签名流程。

这个版本不是 `vote by signature`，而是把一次真实链上投票拆成三步：

1. 在线机器准备未签名交易
2. 离线机器签名原始交易
3. 在线机器广播已签名交易

这样做的重点是：

- 私钥不再需要放在联网机器上
- 不需要修改 `Committee` 合约
- 可以先把现有治理流程迁移到更安全的操作方式

## 当前脚本

脚本路径：

```bash
tools/vote_offline.ts
```

它支持 3 个模式：

- `prepare`
- `sign`
- `broadcast`

## JSON 配置文件

离线工具和在线投票工具共用同一套 JSON 配置读取逻辑。

默认查找顺序：

1. 仓库根目录 `vote.config.json`
2. `tools/vote.config.json`

也可以通过环境变量显式指定：

```bash
SOURCE_DAO_CONFIG=./tools/vote.config.json \
npx hardhat run tools/vote_offline.ts --network opmain
```

示例文件见：

- [../tools/vote.config.example.json](../tools/vote.config.example.json)

适合放进配置文件的字段：

- `daoAddress`
- `proposalApiBase`
- `voterAddress`
- `offline.mode`
- `offline.input`
- `offline.output`
- `offline.signedOutput`
- `offline.broadcastOutput`

如果这些 `offline.*` 路径字段使用相对路径，当前实现会按配置文件所在目录解析。

不建议放进配置文件的内容：

- 离线签名私钥

当前实现里，私钥仍建议通过 `SOURCE_DAO_OFFLINE_PRIVATE_KEY` 在离线环境临时传入。

## 1. 在线准备未签名交易

推荐命令：

```bash
npx hardhat run tools/vote_offline.ts --network opmain
```

`prepare` 是默认模式，不设置额外环境变量时会直接进入该流程。

执行后脚本会：

1. 连接目标网络
2. 读取 DAO 和 Committee 地址
3. 提示输入投票地址
4. 提示输入 proposal id
5. 提示选择 `support` 或 `reject`
6. 从后台拉取 proposal 参数
7. 编码 `support(...)` / `reject(...)` calldata
8. 查询：
   - `chainId`
   - `nonce`
   - `gasLimit`
   - `maxFeePerGas` / `maxPriorityFeePerGas`
9. 生成一个未签名交易 bundle

默认输出文件名类似：

```text
vote-offline-123-support-unsigned.json
```

### 可选环境变量

- `SOURCE_DAO_ADDRESS`
  - 覆盖默认 DAO 地址

- `SOURCE_DAO_API_BASE`
  - 覆盖默认后台 API

- `SOURCE_DAO_VOTER_ADDRESS`
  - 直接指定投票地址，避免交互输入

- `SOURCE_DAO_OFFLINE_OUTPUT`
  - 覆盖未签名 bundle 输出路径

这些字段也可以写入 JSON 配置文件中的：

- `voterAddress`
- `offline.output`

## 2. 离线签名

把 `*-unsigned.json` 文件拷贝到离线机器后执行：

```bash
SOURCE_DAO_OFFLINE_MODE=sign \
SOURCE_DAO_OFFLINE_INPUT=vote-offline-123-support-unsigned.json \
SOURCE_DAO_OFFLINE_PRIVATE_KEY=0xyour_private_key \
npx hardhat run tools/vote_offline.ts
```

脚本会：

1. 读取未签名 bundle
2. 校验私钥地址与 bundle 里的 `voterAddress` 一致
3. 对 bundle 中的原始交易签名
4. 输出 `*-signed.json`

默认输出文件名类似：

```text
vote-offline-123-support-signed.json
```

### 可选环境变量

- `SOURCE_DAO_OFFLINE_PRIVATE_KEY`
  - 离线签名私钥

- `SOURCE_DAO_OFFLINE_MODE`
  - 设置为 `sign`

- `SOURCE_DAO_OFFLINE_INPUT`
  - 指向未签名 bundle 文件

- `SOURCE_DAO_OFFLINE_SIGNED_OUTPUT`
  - 覆盖已签名 bundle 输出路径

这些字段也可以写入 JSON 配置文件中的：

- `offline.mode`
- `offline.input`
- `offline.signedOutput`

### 安全注意

这个第一版为了尽快落地，仍然使用环境变量传私钥。

因此建议：

1. 只在离线机器上使用
2. 不要把私钥写进仓库或 shell 历史
3. 用一次即清理环境变量

后续如果继续演进，可以再考虑：

- 私钥文件输入
- 硬件钱包签名
- 助记词隔离

## 3. 在线广播

把 `*-signed.json` 文件带回联网机器后执行：

```bash
SOURCE_DAO_OFFLINE_MODE=broadcast \
SOURCE_DAO_OFFLINE_INPUT=vote-offline-123-support-signed.json \
npx hardhat run tools/vote_offline.ts --network opmain
```

脚本会：

1. 解析已签名交易
2. 校验：
   - `to` 是否仍是 bundle 中的 Committee 地址
   - `from` 是否仍是 bundle 中的 voter 地址
   - `chainId` 是否与当前网络一致
3. 广播交易
4. 把交易 hash 回写到 bundle 文件

### 可选环境变量

- `SOURCE_DAO_OFFLINE_MODE`
  - 设置为 `broadcast`

- `SOURCE_DAO_OFFLINE_INPUT`
  - 指向已签名 bundle 文件

- `SOURCE_DAO_OFFLINE_BROADCAST_OUTPUT`
  - 覆盖广播后 bundle 的回写路径

这些字段也可以写入 JSON 配置文件中的：

- `offline.mode`
- `offline.input`
- `offline.broadcastOutput`

## 文件格式

当前 bundle 里会保存这些关键信息：

- 网络名
- RPC URL
- DAO 地址
- Committee 地址
- voter 地址
- proposal id
- proposal 类型
- 原始后台参数
- 编码后的 proposal 参数
- 未签名交易字段
- 已签名交易 hex
- 广播后的 tx hash

这样做的目的，是让离线签名和在线广播两端都能核对上下文，而不是只传一段裸 `0x...` 交易。

## 这个版本解决了什么

它解决的是：

- 私钥不必继续放在联网机器
- 投票人可以在离线环境签名真实交易
- 在线机器只负责准备和广播

## 这个版本没有解决什么

它还没有解决：

1. 用户签的是“原始交易”，不是更高层的人类可读投票意图
2. nonce 和 gas 参数是在准备阶段固定下来的
3. 如果拖太久再广播，可能需要重新准备
4. 这不是 `supportBySig / rejectBySig`
5. 这不能替代未来更正式的 EIP-712 `vote by signature`

## 推荐操作顺序

1. 在线机器运行 `prepare`
2. 人工核对 proposal、vote choice、voter 地址、目标合约地址
3. 把 bundle 拷到离线机器
4. 离线机器运行 `sign`
5. 把签名后的 bundle 带回在线机器
6. 在线机器运行 `broadcast`

## 后续演进方向

如果这套最小版离线签名流程验证稳定，后续建议继续往下做两层：

1. 为 bundle 增加更严格的 schema 校验和更清晰的人类可读摘要
2. 把 `Committee` 合约升级到真正的 `vote by signature` 模型
