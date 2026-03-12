# SourceDAO 合约变更记录

这份文档用于记录 SourceDAO 各合约的重要修改，重点说明以下内容：

1. 为什么要改
2. 这次修改解决了什么问题
3. 修改后的行为和边界是什么
4. 是否涉及 ABI、接口调用、代理升级或存储布局兼容性风险
5. 用什么测试验证了修改

这不是简单的“更新日志”，而是一份偏工程审计视角的变更说明。后续如果 `contracts/` 下其它核心合约发生关键修改，也应继续追加到这份文档，而不是分散到临时说明里。

## 记录规则

后续新增记录时，建议每次按下面结构补充：

### 合约

- 合约名
- 修改日期
- 关联测试或提交范围

### 背景

- 原始业务语义是什么
- 旧实现有什么隐患、缺口或错误

### 修改目的

- 这次修改想修复什么
- 想防止什么错误再次出现

### 具体改动

- 逐条说明代码层面的变化
- 明确哪些是逻辑修复，哪些是校验增强，哪些是命名或可维护性整理

### 兼容性影响

- 是否影响外部接口调用
- 是否影响 ABI
- 是否影响代理升级存储布局
- 是否影响已有链上数据解释

### 验证方式

- 新增了哪些测试
- 验证覆盖了哪些正向和反向路径

---

## 2026-03-12 ProjectManagement 变更记录

### 合约

- 合约：`ProjectManagement`
- 文件：[contracts/Project.sol](contracts/Project.sol)
- 相关测试：[test/project.ts](test/project.ts)

### 背景

`ProjectManagement` 是 SourceDAO 当前最关键的业务合约之一，负责以下核心职责：

1. 项目创建与版本推进
2. 项目从 Preparing、Developing、Accepting 到 Finished/Rejected 的状态迁移
3. DevToken 奖励释放
4. extra token 托管、退款与贡献者分发
5. 项目版本发布时间与最新版本记录

这一轮修改不是功能扩展，而是在补齐 Hardhat 3 测试的过程中，由新增测试直接暴露出实现层面的真实风险。也就是说，本次改动的来源不是主观重构，而是测试驱动下对关键业务语义的修正和加固。

### 修改目的

本次 `ProjectManagement` 修改的目标主要有四个：

1. 修复 extra token 退款逻辑中的真实计算错误
2. 防止项目验收时出现无效贡献数据导致结算失真
3. 防止更新贡献数据时写入无效地址或零值数据
4. 统一 `createProject` 的参数命名，降低接口理解成本和后续维护歧义

这些目标里，第一项属于逻辑 bug 修复，第二和第三项属于输入校验补强，第四项属于低风险可维护性改进。

### 具体改动

#### 1. 修复 `coefficient < 100` 时的 extra token 退款计算

修改位置：[contracts/Project.sol](contracts/Project.sol#L163)

旧逻辑在项目结算结果为 `Normal` 时，会进入 `coefficient < 100` 分支，将未分配的 extra token 退回给项目 manager。这里原本的计算方向写反了：

- 旧表达式本质上是 `project.extraTokenAmounts[i] * (coefficient - 100) / 100`
- 当 `coefficient = 80` 时，这个值会变成负方向表达，在 Solidity 0.8 下直接触发下溢并回退

这意味着：

1. `Normal` 结果项目在带 extra token 的情况下，理论上应该允许完成并退回未分配部分
2. 旧实现却会在 promote 阶段因为下溢直接失败
3. 这会让项目无法正常完成，属于真实业务错误，而不是“边缘输入”

修复后的逻辑改为：

- 退回比例 = `(100 - coefficient) / 100`

对应行为变成：

1. `Good` 结果：不退款，100% 分发给贡献者
2. `Excellent` 结果：extra token 仍然只按 100% 分发，不会因为 dev reward 是 120% 而超发 extra token
3. `Normal` 结果：未分配的 20% 退回 manager，其余 80% 按贡献分配
4. `Failed` / `Expired`：项目完成时不向贡献者分配 extra token，之前托管的部分通过现有路径回到 manager

这是本轮最关键的一项合约修复。

#### 2. 为 `createProject` 增加 extra token 参数长度一致性检查

修改位置：[contracts/Project.sol](contracts/Project.sol#L75)

新增校验：

- `require(extraTokens.length == extraTokenAmounts.length, "extra token length mismatch")`

目的很直接：

1. 阻止 token 地址数组和数量数组错位
2. 避免后续 `transferFrom` 和项目托管数据写入之间发生语义不一致
3. 防止“看起来创建成功，但托管/分发对象和数量不对应”的错误状态进入链上

这类校验属于典型的“越早失败越好”。如果不在入口拒绝，后面的所有会计逻辑都会建立在不可靠输入之上。

#### 3. 为 `acceptProject` 增加贡献列表有效性检查

修改位置：[contracts/Project.sol](contracts/Project.sol#L183)

新增了以下约束：

1. 贡献列表不能为空
2. 贡献者地址不能是零地址
3. 贡献值必须大于零
4. 同一个贡献者在同一批验收数据中不能重复出现

新增原因：

1. 空贡献列表会导致项目进入 Accepting/Finished 路径后没有可信的结算基础
2. 零地址会把奖励或 extra token 的归属语义变得不明确
3. 零值贡献会制造无效条目，污染数据结构
4. 重复贡献者会直接影响 `totalContribution` 和单人份额计算，导致结算比例失真

尤其是重复贡献者这一点，如果不在入口拦截，后续 `withdrawContributions` 的分母和分子都可能被错误放大或重复记账。这种错误不一定每次都显性回退，但会悄悄破坏结算正确性。

#### 4. 为 `updateContribute` 增加无效输入拦截

修改位置：[contracts/Project.sol](contracts/Project.sol#L212)

新增校验：

1. 贡献者地址不能为零地址
2. 贡献值必须大于零

原因与 `acceptProject` 一致，只是这里作用于项目已经进入 Accepting 状态后的增量修改路径。因为 `updateContribute` 会直接影响最终分配结果，所以它不能成为绕过入口校验的后门。

换句话说，这次修改保证了：

1. 初次提交贡献数据是干净的
2. 后续更新贡献数据也仍然必须保持干净

#### 5. 统一 `createProject` 的参数命名

修改位置：[contracts/Project.sol](contracts/Project.sol#L73)

这次把 `extraTokenAmunts` 改成了 `extraTokenAmounts`，目的不是功能变更，而是命名一致性修正。

原因：

1. 原命名存在明显拼写错误
2. `Interface.sol` 中已经使用了正确命名
3. 在实现和接口之间保留两种拼写，会增加阅读和排错成本

这项改动本身不改变运行逻辑，只是降低维护歧义。

### 本次修改没有做的事

为了控制风险，这一轮没有主动改动以下内容：

1. 没有重排任何状态变量
2. 没有改变 `ProjectBrief`、`ProjectDetail`、`ContributionInfo` 的存储结构
3. 没有改动 `withdrawContributions` 的基础分配算法
4. 没有改动版本发布语义本身，只是用测试把当前语义固定下来

这意味着这次改动是“修正和加固现有语义”，不是重新设计项目结算系统。

### 兼容性影响评估

#### ABI / 接口调用兼容性

本次最容易被误解的一点，是 `createProject` 的参数名从 `extraTokenAmunts` 改成了 `extraTokenAmounts`。

这里需要明确：

1. EVM 函数选择器只由函数名和参数类型序列决定
2. 参数名不参与 calldata 编码
3. 本次没有改函数名、参数顺序、参数类型

因此：

- 不影响已有调用方按相同参数类型发起调用
- 不影响 ABI 层的函数签名匹配
- 不会改变链上调用数据解释方式

#### 代理升级与存储布局兼容性

本次对 `ProjectManagement` 的修改没有新增、删除、重排状态变量，也没有修改已有状态变量的类型。

因此：

1. 不改变 storage slot 布局
2. 不影响已有代理合约中的历史存储数据解释
3. 不引入因为布局变化导致的升级风险

这也是为什么本轮可以把命名修正和逻辑修复放在同一批次里处理：逻辑虽然关键，但布局层面是安全的。

### 行为语义补充说明

为了避免后续再重复踩坑，本轮测试已经把 `ProjectManagement` 的几个关键语义固定下来：

1. `committee.support()` 之后，提案不会立刻在 `proposalOf` 中表现为 `Executed`
2. 提案是在后续 `takeResult` / `promoteProject` 路径中真正结算并进入 `Executed`
3. `latestProjectFinishTime` 只会在项目真正完成时推进，不会因为取消、拒绝或准备阶段被污染
4. `latestProjectVersion` 表示的是“当前已发布的最高版本”，不是“最后完成的那个版本”
5. 较老版本即使更晚完成，也不能覆盖更高版本的已发布时间记录
6. 多项目批量提取时，每个项目的舍入残值是独立保留的，不会互相吞并
7. 不同 `ProjectResult`、不同 `projectName`、不同 extra token 集合在一次批量提取中也必须彼此隔离，不能串账
8. `Expired` 和 `Failed` 项目在批量提取里必须保持“零奖励、manager 退款”的独立语义，不能污染同批次其它项目的正常分发
9. 即使同时存在三人贡献、双 extra token、跨项目名、混合 `ProjectResult`，批量提取后的余额、退款和残值也必须仍然按项目独立结算
10. `acceptProject` 只能在 `Developing` 状态调用，项目尚未进入开发、已进入 `Accepting`、已 `Finished` 或已 `Rejected` 时都必须拒绝重复或越界验收
11. `updateContribute` 只能在 `Accepting` 状态调用，不能在 `Developing`、`Finished`、`Rejected` 等非验收窗口中修改结算数据
12. `promoteProject` / `cancelProject` / `acceptProject` 这些生命周期入口在提案已执行或项目已进入终态后，必须稳定返回状态错误，避免重复推进状态机

这些语义本轮主要通过测试显式化，并未引入新的合约设计。

### 验证方式

本次修改不是只改了合约然后“顺便跑一下测试”，而是围绕风险点系统补充了 `ProjectManagement` 的行为回归测试。

验证重点包括：

1. 无效输入拒绝
2. 提案执行状态
3. 退款与分发的数值正确性
4. 多项目批量提取
5. 多 token 场景
6. 多项目名场景
7. 版本交错完成
8. 舍入残值保留
9. `Normal / Good / Excellent / Failed / Expired` 的组合结算行为
10. `Expired / Failed` 在三人贡献、双 token、跨项目名混合批量提取下的隔离性
11. `acceptProject` 在 `Preparing / Accepting / Finished / Rejected` 状态下的错误路径和重复调用保护
12. `updateContribute` 在非 `Accepting` 状态下的错误路径和重复调用保护
13. `promoteProject / cancelProject / acceptProject` 在提案已执行或项目终态后的状态机幂等保护

验证结果：

- `npm test -- --grep "project"` 通过
- `npm test` 全量通过
- 当前全量回归结果：`88 passing`

### 为什么必须留下这份记录

`ProjectManagement` 的修改和普通业务代码不一样，它涉及：

1. 资产托管
2. 奖励释放
3. 状态迁移
4. 版本发布语义
5. DAO 治理提案联动

这类改动如果只存在于 diff 和测试里，几周之后很容易忘记“为什么要这样改”。一旦后续有人继续调整 `Committee`、`Dividend`、`Acquired`、`Lockup` 或其它核心合约，没有这份记录，就很难判断某些行为是“偶然如此”，还是“故意设计并已被验证”的。

所以从这次开始，凡是核心合约的关键修改，都应该继续追加到这份文档中。

---

## 后续追加建议

后续如果修改以下合约，建议继续在本文件新增章节：

1. `Committee.sol`
2. `Dao.sol`
3. `Dividend.sol`
4. `Acquired.sol`
5. `TokenLockup.sol`
6. `DevToken.sol`
7. `NormalToken.sol`

建议每次追加时都尽量回答两个问题：

1. 如果不改，会出什么业务问题或安全问题？
2. 改完之后，哪些测试可以证明这个行为已经被固定住？