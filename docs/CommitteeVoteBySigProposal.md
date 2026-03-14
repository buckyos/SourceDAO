# Committee Vote By Signature Proposal

## 背景

当前 `SourceDaoCommittee` 的投票入口是：

- `support(uint proposalId, bytes32[] memory params)`
- `reject(uint proposalId, bytes32[] memory params)`

这套模型的特点是：

1. 投票人必须直接发送链上交易
2. 私钥必须存在于在线签名环境中，或者至少存在于能直接广播交易的环境中
3. 现有离线投票工具本质上仍然是在离线签“原始交易”

虽然当前已经有 `tools/vote_offline.ts` 支持 `prepare / sign / broadcast` 模式，但它的签名对象仍然是完整交易，而不是高层治理意图。

从长期安全和工具演进角度看，更好的治理交互方式是：

- 投票人离线签一个 EIP-712 typed data
- 任意 relayer 帮助其上链
- 私钥不需要接触在线机器

这就是本提案讨论的方向：为 `Committee` 增加 `supportBySig / rejectBySig`。

---

## 目标

本提案的目标是：

1. 为普通提案和 full proposal 增加“签名投票”入口
2. 保留现有 `support / reject` 逻辑，做到增量兼容
3. 不改变当前 ordinary proposal 和 full proposal 的治理语义
4. 使离线签名工具从“签原始交易”演进为“签治理意图”
5. 在升级已有 proxy 时保持存储布局安全

---

## 非目标

本提案不打算在同一轮解决以下问题：

1. full proposal 当前“按结算时余额计票”的已知问题
2. full proposal 的统一快照计票
3. proposer 相关历史语义中的 `tx.origin` 依赖
4. proposal 参数编码方式的整体重构

也就是说，本提案只处理“投票授权方式”，不处理“投票权计算方式”。

---

## 设计原则

### 1. 对外是增量补充，不替换现有接口

现有接口：

- `support(...)`
- `reject(...)`

应继续保留。

新增接口只作为附加能力：

- `supportBySig(...)`
- `rejectBySig(...)`

这样可以保证：

1. 现有调用方不需要立刻迁移
2. 链上治理语义不被打断
3. 工具层可以逐步从在线投票迁移到签名投票

### 2. 对内统一投票路径

现有实现里，投票逻辑直接使用 `msg.sender` 做资格判断、写入 `proposalVotes`、并写入 `support[] / reject[]`。

一旦支持 relayer，真正的投票人就不再等于 `msg.sender`，而应是签名恢复出来的 signer。

因此应把投票逻辑抽象成统一内部函数，做到：

1. 在线交易路径传入 `msg.sender`
2. 签名路径传入 `ECDSA.recover(...)` 得到的 signer

### 3. 尽量绑定现有 proposal root，而不是重建参数传输模型

当前提案已经通过 `proposal.paramroot` 固化了参数语义。

因此签名消息不应再次要求传入完整参数数组，而是应直接绑定：

- `proposalId`
- `proposalRoot`
- `support/reject`
- `nonce`
- `deadline`

这样可以减少 calldata，也能与当前实现保持一致。

### 4. 升级必须遵守现有存储兼容要求

`Committee` 已经是 upgradeable proxy，并且之前已经处理过普通提案快照引入时的存储布局兼容问题。

因此本提案实现时必须继续遵守：

1. 新状态变量只能追加在现有变量尾部
2. 不得把新变量插入现有变量中间
3. 不应轻率修改继承结构以引入新的带存储父合约

---

## 推荐接口草案

建议新增以下接口：

```solidity
function supportBySig(
    uint256 proposalId,
    uint256 deadline,
    bytes calldata signature
) external returns (bool);

function rejectBySig(
    uint256 proposalId,
    uint256 deadline,
    bytes calldata signature
) external returns (bool);

function voteNonces(address voter) external view returns (uint256);
```

如果未来需要更紧凑的实现，也可以内部统一成：

```solidity
function _voteBySig(
    uint256 proposalId,
    bool isSupport,
    uint256 deadline,
    bytes calldata signature
) internal returns (bool);
```

---

## 推荐签名结构

### EIP-712 域

建议域包含：

- `name`
- `version`
- `chainId`
- `verifyingContract`

推荐值：

- `name`: `SourceDaoCommittee`
- `version`: 当前实现版本，例如 `"2.0.0"` 或单独固定成治理签名版本字符串

### Typed Data 结构

建议签名结构为：

```solidity
CommitteeVote(
    uint256 proposalId,
    bytes32 proposalRoot,
    bool support,
    uint256 nonce,
    uint256 deadline
)
```

### 为什么绑定 `proposalRoot`

因为当前提案参数已经在链上固化为 `proposal.paramroot`。  
如果签名直接绑定这个 root，就已经绑定了提案参数语义，不需要在 `supportBySig / rejectBySig` 中再次上传原始 `params` 数组。

这样有几个好处：

1. relayer 不能替换参数语义
2. calldata 更小
3. 工具层更容易做离线签名
4. 逻辑与现有 proposal 模型保持一致

---

## 内部实现建议

### 1. 抽象统一投票流程

建议把现有 `support / reject` 内部逻辑改为：

```solidity
function _castVote(
    address voter,
    uint256 proposalId,
    bool isSupport
) internal returns (bool);
```

然后把资格校验拆成独立逻辑：

```solidity
function _validateVoteEligibility(
    address voter,
    uint256 proposalId
) internal view;
```

这层校验应继续沿用当前语义：

- proposal 必须处于 `InProgress`
- proposal 未过期
- 该 voter 尚未投票
- ordinary proposal：必须属于该 proposal 的委员会快照
- full proposal：当前票权必须大于 0

### 2. 在线路径保持不变

现有：

- `support(...)`
- `reject(...)`

仍然保留 params / root 校验，然后把 `msg.sender` 传入 `_castVote(...)`。

### 3. 签名路径只负责恢复 signer

新增：

- `supportBySig(...)`
- `rejectBySig(...)`

流程建议是：

1. 读取 proposal
2. 读取 `proposal.paramroot`
3. 构造 EIP-712 digest
4. `recover` signer
5. 校验 `deadline`
6. 校验 `nonce`
7. 递增 `voteNonces[signer]`
8. 调用 `_castVote(signer, proposalId, isSupport)`

### 4. 事件记录 signer，而不是 relayer

当前事件：

```solidity
emit ProposalVoted(msg.sender, proposalId, true/false);
```

在签名路径下，事件里的地址必须是 signer，即真正投票人，而不是 relayer。

因此在 `_castVote(...)` 中发事件更合理。

---

## 升级兼容性

### 1. 存储布局

建议只在 `Committee` 现有状态变量末尾追加：

```solidity
mapping(address => uint256) public voteNonces;
```

如果后续还需要记录签名域版本或其他治理签名元数据，也应继续尾部追加。

### 2. 不建议直接引入 `EIP712Upgradeable`

虽然 OpenZeppelin 提供了 `EIP712Upgradeable`，但对当前 `Committee` 来说，直接通过继承新增一个带存储的父合约，需要非常谨慎。

风险在于：

1. 继承顺序变化可能影响存储布局
2. 升级后的 proxy 需要更严格的布局校验
3. 对已有 `Committee` proxy 来说，这类改动比单纯尾部追加变量风险更高

因此更稳的实现方式是：

1. 保持当前继承结构不变
2. 在 `Committee.sol` 内部手写 EIP-712 digest 计算逻辑
3. 只尾部追加 `voteNonces`

### 3. ABI 兼容性

这是 ABI 扩展，不是 ABI 破坏：

- 现有 `support / reject` 不变
- 新增 `supportBySig / rejectBySig / voteNonces`

因此现有调用方不会被打断。

---

## 工具层影响

如果链上增加 `vote by signature`，工具层可以逐步从“签原始交易”升级到“签治理意图”。

推荐后续工具演进方向：

1. `tools/vote_offline.ts`
   - 增加 `typed-data prepare`
   - 增加 `typed-data sign`
   - 增加 `relay`

2. 在线投票工具
   - 继续保留原始交易路径
   - 后续可以加 `--by-sig` 模式

3. 状态工具
   - 增加 nonce 查询展示
   - 可选展示签名投票支持状态

---

## 测试建议

至少应补以下测试：

### 普通提案

1. 委员会成员 `supportBySig` 成功
2. 委员会成员 `rejectBySig` 成功
3. 非委员 `supportBySig` 失败
4. 错 proposalId / 错 proposalRoot 的签名失败

### Full proposal

1. 有票权 holder `supportBySig` 成功
2. 有票权 holder `rejectBySig` 成功
3. 无票权地址 `supportBySig` 失败

### 签名安全

1. nonce 重放失败
2. deadline 过期失败
3. 错 chainId / 错 verifying contract 失败
4. relayer 地址与 signer 不同时，事件中记录 signer

### 回归

1. 原有 `support / reject` 行为不变
2. ordinary proposal 快照治理不变
3. full proposal 当前票权规则不变

### 升级

1. legacy committee proxy 升级后旧状态仍正常
2. 新增 `voteNonces` 在升级后可正常工作
3. 不破坏现有 proposal / proposalExtra / proposalVotes 存储解释

---

## 当前推荐结论

这项改动的定位应是：

- 对外：增量补充
- 对内：统一投票逻辑重构
- 升级上：尾部追加 nonce 存储，谨慎处理 EIP-712 实现方式

它不会改变当前 ordinary proposal 与 full proposal 的核心治理语义，只是把“谁来广播交易”和“谁真正投票”解耦。

如果委员会接受这个方向，推荐下一步先做一版最小实现：

1. `supportBySig / rejectBySig`
2. `voteNonces`
3. `Committee` 内部 `_castVote(...)` 抽象
4. 最小工具和测试补齐

而 full proposal 的统一快照计票问题，应继续作为独立议题处理，不建议在同一轮合并。
