# Full Proposal 统一快照议案草案

状态：`Discussion / 未决`

适用范围：

1. [contracts/Committee.sol](../contracts/Committee.sol)
2. [contracts/DevToken.sol](../contracts/DevToken.sol)
3. [contracts/NormalToken.sol](../contracts/NormalToken.sol)

## 背景

`SourceDaoCommittee` 的 `full proposal` 目前保留了“分批结算”设计：

1. 提案到期后，由外部多次调用 `endFullPropose(...)`
2. 每次调用传入一批 voter 地址
3. 合约逐批累加 `agree / reject / settled`

这样设计的原因是合理的：

1. full proposal 的 voter 数量理论上可能很多
2. 如果强制一次性结算全部 voter，单笔交易可能因为 gas 过高而失败
3. 因此必须允许外部分批 settle

## 现状

当前实现已经完成了一层收口：

1. zero-balance outsider 已不能再对 full proposal 投票
2. full proposal 不再需要额外 settle 这些零票重 outsider 记录

但还保留一个更深层的已知问题：

1. full proposal 的票重是在 `endFullPropose(...)` 结算时按“当前余额”计算
2. 由于 `endFullPropose(...)` 本身允许分批执行
3. 同一份 token 在不同结算批次之间发生转移时，存在被重复计权的风险

## 当前模型的核心问题

问题不在“分批结算”本身，而在“分批结算时使用当前余额”。

举例：

1. 地址 `A` 和 `B` 都已经对同一 full proposal 投票
2. 第一笔 `endFullPropose(...)` 先结算 `A`
3. 结算后 `A` 把 token 转给 `B`
4. 第二笔 `endFullPropose(...)` 再结算 `B`

如果每次都按结算当下余额计票，那么：

1. `A` 会先按自己旧余额被计票
2. `B` 又会按收到 token 后的新余额被再次计票
3. 同一批 token 在一次 proposal 中被重复使用

从治理正确性角度看，这比“投票后中途转走导致票重变化”更关键，因为它会直接破坏“一份 token 在一次 vote 里只能算一次”的基本原则。

## 目标

本议案希望讨论并最终确定以下目标：

1. 保留 full proposal 的分批结算能力
2. 让一次 full proposal 的所有 voter 都按同一个统一时点计权
3. 防止同一批 token 在不同地址和不同 settle batch 之间被重复计算
4. 尽量控制对现有合约、代理升级和日常 transfer gas 成本的影响

## 方案对比

### 方案 A：保持现状

含义：

1. 继续按 `endFullPropose(...)` 执行当下的余额计票
2. 不引入任何快照

优点：

1. 不需要修改 token 合约
2. 不需要新增 checkpoint 存储
3. 兼容性成本最低

问题：

1. 同一批 token 在不同 settle batch 之间可能被重复计权
2. proposal 结果依赖结算顺序和结算时机
3. 治理正确性不可严格保证

结论：

1. 不建议继续长期保留

### 方案 B：按“投票时地址快照”记录票重

含义：

1. 地址投票时立即记录该地址当时的票重
2. 后续结算直接使用该地址已记录的票重

优点：

1. 不再依赖结算时余额
2. `endFullPropose(...)` 的分批结算仍然容易实现

问题：

1. 只能解决“投票后余额变化影响自身票重”的问题
2. 不能解决 token 转手后由另一个新地址继续投票的问题
3. 同一批 token 仍然可能在多个地址之间被重复使用

结论：

1. 不满足“同一批 token 在一次 vote 中只算一次”这个核心目标
2. 不建议作为最终方案

### 方案 C：proposal 级统一快照时点

含义：

1. 为每个 full proposal 固定一个统一计票时点
2. 所有 voter 在 `endFullPropose(...)` 结算时，都按这个固定时点读取历史余额
3. 继续允许分批 settle，但所有 batch 共用同一个快照时点

可选的快照时点：

1. proposal 创建时
2. proposal 截止时 `proposal.expired`

从当前 SourceDAO 语义出发，更推荐：

1. 以 `proposal.expired` 作为统一快照时点

原因：

1. 当前 full proposal 本来就是按截止时间结束投票
2. 在截止前 token 仍可自由流动
3. 用截止时点作为统一计票时点，更符合“截止时谁持仓，谁对最终计票负责”的思路

优点：

1. 分批结算仍然保留
2. 同一 proposal 的所有 batch 都按同一时点计权
3. 同一批 token 在不同地址之间转移后，不会因为不同 settle batch 被重复计权

问题：

1. 需要 token 层支持历史余额查询
2. 需要为 `devRatio` 提供历史读取能力
3. 需要接受日常 token 转账 gas 成本增加

结论：

1. 这是当前最符合治理正确性的方向
2. 推荐作为后续正式方案继续细化

## 推荐方向

推荐采用：`方案 C：proposal 级统一快照时点`

建议语义：

1. full proposal 仍允许任意数量的 `endFullPropose(...)` 批次
2. 但每个 voter 的票重统一按 `proposal.expired` 时刻的历史余额计算
3. `agree / reject / threshold` 全部基于这个统一时点

## 推荐实现草案

### 1. Token 层增加时间戳 checkpoint

在 [contracts/DevToken.sol](../contracts/DevToken.sol) 和 [contracts/NormalToken.sol](../contracts/NormalToken.sol) 中增加：

1. 账户余额的历史 checkpoint
2. `totalSupply` 的历史 checkpoint

建议对外提供：

1. `getPastBalance(address account, uint64 timestamp)`
2. `getPastTotalSupply(uint64 timestamp)`

实现原则：

1. 账户余额变化时写 checkpoint
2. 如果同一 `timestamp` 已有最后一条记录，则覆盖而不是重复 append
3. 只在真实余额变化时写记录

### 2. Committee 层增加 devRatio 历史读取

full proposal 的票重不只是 token 数量，还要考虑 `devRatio`。

因此需要在 [contracts/Committee.sol](../contracts/Committee.sol) 中增加：

1. `devRatio` 的 checkpoint
2. `getPastDevRatio(uint64 timestamp)`

写入时机：

1. `initialize(...)`
2. `setDevRatio(...)`

### 3. Full proposal 在第一次结算时固定快照参数

建议在 [contracts/Committee.sol](../contracts/Committee.sol) 中为每个 full proposal 追加缓存：

1. `snapshotTime`
2. `snapshotRatio`
3. `totalEligibleWeight`

推荐做法：

1. 第一次进入 `endFullPropose(...)` 时初始化
2. 后续 batch 直接复用
3. 不修改现有 `ProposalExtra` 结构体，避免 ABI 和存储布局风险

### 4. full proposal 结算逻辑改为统一快照读取

新的计票逻辑建议为：

1. `snapshotTime = proposal.expired`
2. `snapshotRatio = snapshotTime` 时刻生效的 ratio
3. `voterWeight = normalPastBalance + devPastBalance * snapshotRatio / 100`

`threshold` 所使用的总票基数也按同一快照时点计算。

## finalRatio 的特殊处理

当前 `Committee` 对 full proposal 有一条特殊语义：

1. 如果最终版本已经发布，则 `devRatio` 应锁到 `finalRatio`

在统一快照模型下，推荐语义为：

1. 如果主项目最终版本的发布时间 `<= proposal.expired`
2. 则该 full proposal 的有效 ratio 直接取 `finalRatio`
3. 否则取 `proposal.expired` 时刻生效的历史 `devRatio`

这样可以保证：

1. full proposal 的 ratio 语义也和统一快照时点保持一致

## 升级与兼容性影响

这部分需要明确讨论。

### 正向点

1. 可以保留 `Committee` 的分批结算模式
2. 不需要改变 full proposal 的对外执行入口

### 风险点

1. `DevToken` 和 `NormalToken` 需要新增持久化 checkpoint 存储
2. 每次 token 余额变化的 gas 会增加
3. 需要重新审查 upgradeable proxy 的存储布局追加位置
4. 需要补充 legacy proxy 升级后的兼容测试

## 测试建议

如果后续决定落地，至少应补以下测试：

1. 同一批 token 在两个 voter 之间转移，但分两批结算时只应计一次
2. voter 投票后在截止前转走 token，最终票重应按截止时余额而不是投票时余额
3. voter 投票后在截止前收到 token，最终票重应按截止时余额计算
4. final release 发生在 proposal 生命周期内时，结算应自动按 `finalRatio`
5. token checkpoint 升级后，旧 proxy 的余额和功能不应被破坏
6. finalized 系统中 full proposal 换届、升级、项目治理链路都应继续通过

## 待决议问题

这份草案建议委员会后续重点讨论以下问题：

1. 是否认可“full proposal 的统一计票时点应为 `proposal.expired`”
2. 是否接受 token 层增加 checkpoint 带来的长期 gas 成本
3. 是否接受这次只解决“重复计权”问题，而不同时重做 proposer eligibility 等更大范围机制
4. 是否要把该改动作为单独升级批次，而不是和其它治理变更打包

## 当前建议

在正式决议前，建议把这项问题视为：

1. 已识别的治理正确性问题
2. 不应在没有统一方案的情况下继续零散修补

当前建议动作：

1. 先保留本文档作为待讨论议案
2. 在委员会内部确认是否接受“截止时统一快照”方向
3. 若方向确认，再进一步细化具体状态变量、接口、升级步骤和测试计划
