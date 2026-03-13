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

---

## 2026-03-12 DividendContract 变更记录

### 合约

- 合约：`DividendContract`
- 文件：[contracts/Dividend.sol](contracts/Dividend.sol)
- 相关测试：[test/dividend.ts](test/dividend.ts)

### 背景

`DividendContract` 负责记录 `NormalToken` / `DevToken` 质押、按周期累计奖励、并在后续周期中按持仓比例分红。

这个合约的风险不在于简单的 access control，而在于：

1. 周期边界上的 stake / unstake 是否会污染上一轮已经形成的奖励基线
2. 跨周期追加另一种质押资产时，是否会保留原有的另一侧持仓
3. `estimateDividends` / `withdrawDividends` 使用的历史快照，是否真的和“上一完整周期”的业务语义一致

这一轮并不是先主动重构，而是先用新的高风险测试去验证两个怀疑点，随后由失败用例确认了真实实现问题。

### 修改目的

本次 `DividendContract` 修改的目标主要有四个：

1. 保证 stake / unstake 在跨过周期边界后，不会回写并污染上一轮奖励快照
2. 保证用户跨周期混合持有 `normalAmount` 和 `devAmount` 时，不会因为只追加一种资产而丢失另一种资产的历史持仓
3. 让 `updateTokenBalance` 和 `deposit` 在 DAO 自身 token 的限制语义上保持一致
4. 在不破坏历史快照的前提下，压缩同一周期内往返操作产生的冗余 `StakeRecord`

前两项属于结算语义修复，第三项属于约束收口，第四项属于存储增长控制。

### 具体改动

#### 1. 在质押和解押入口先执行周期推进

修改位置：[contracts/Dividend.sol](contracts/Dividend.sol#L236)、[contracts/Dividend.sol](contracts/Dividend.sol#L267)、[contracts/Dividend.sol](contracts/Dividend.sol#L301)、[contracts/Dividend.sol](contracts/Dividend.sol#L334)

本次在以下四个入口开头统一加入了 `_tryNewCycle()`：

1. `stakeNormal`
2. `stakeDev`
3. `unstakeNormal`
4. `unstakeDev`

修复原因：

旧实现只有 `deposit`、`receive`、`updateTokenBalance` 会尝试推进周期，而 stake / unstake 不会。

这会导致一种错误语义：

1. 周期实际上已经过期
2. 但还没有任何操作触发 cycle rollover
3. 用户此时执行 stake / unstake
4. 这笔本应属于“新周期”的变更，却被写进了“旧周期”的快照基础里

后果就是上一轮已经形成的分红基线被晚到的操作污染。

修复后，stake / unstake 会先根据时间推进到正确周期，再写入新的变更。

#### 2. 修复跨周期追加另一种质押资产时丢失另一侧余额的问题

修改位置：[contracts/Dividend.sol](contracts/Dividend.sol#L249)、[contracts/Dividend.sol](contracts/Dividend.sol#L280)

旧实现里：

1. 如果用户上一周期有 `normalAmount`，下一周期执行 `stakeDev`，新 `StakeRecord` 会把 `normalAmount` 重置为 0
2. 如果用户上一周期有 `devAmount`，下一周期执行 `stakeNormal`，新 `StakeRecord` 会把 `devAmount` 重置为 0

这意味着跨周期混合持仓会被错误截断，后续：

1. `getStakeAmount`
2. `estimateDividends`
3. `withdrawDividends`
4. 以及后续再发生的 unstake

都可能基于错误余额继续运作。

修复后：

1. `stakeNormal` 在跨周期创建新记录时，会保留上一条记录里的 `devAmount`
2. `stakeDev` 在跨周期创建新记录时，会保留上一条记录里的 `normalAmount`

也就是说，新的 `StakeRecord` 表示“本周期开始生效的总持仓”，而不是“只保留本次修改的那一侧”。

#### 3. 修复跨周期 unstake 会回写旧快照的问题

修改位置：[contracts/Dividend.sol](contracts/Dividend.sol#L301)、[contracts/Dividend.sol](contracts/Dividend.sol#L334)

旧实现的另一个更隐蔽问题是：

1. 当用户已经跨入新周期
2. 但最近一条 `StakeRecord` 还属于上一周期
3. 此时执行 `unstakeNormal` 或 `unstakeDev`

旧代码会直接修改那条旧记录本身。

这会造成：

1. 上一周期本应固定的奖励基线被 retroactive 改写
2. `estimateDividends(cycleIndex)` 中用到的 `_getStakeAmount(cycleIndex - 1)` 也被一起污染

修复后改为：

1. 如果当前周期已经有记录，就只更新当前周期记录
2. 如果当前周期还没有记录，就基于上一条记录复制一份新的当前周期记录，并在这份新记录上扣减对应资产

这样可以保证：

1. 历史周期记录保持不可变
2. 当前周期之后的有效持仓仍然被正确更新
3. `totalStaked` 会继续反映当前生效的总持仓，而历史奖励快照不会被回写

#### 4. 收紧 `updateTokenBalance` 对 DAO 自身 token 的处理

修改位置：[contracts/Dividend.sol](contracts/Dividend.sol#L173)

旧实现里：

1. `deposit` 明确拒绝把 DAO 的 `normalToken` / `devToken` 当作奖励 token
2. 但 `updateTokenBalance` 没有同样的限制

这意味着用户如果先把 DAO 自身 token 直接转到分红合约，再调用 `updateTokenBalance`，就能绕过 `deposit` 的限制语义。

本次修复后，`updateTokenBalance` 也会显式拒绝：

1. DAO normal token
2. DAO dev token

这样 `deposit` 和 `updateTokenBalance` 对“哪些 token 可以作为 reward”保持一致。

#### 5. 为分红查询和提取增加重复输入保护

修改位置：[contracts/Dividend.sol](contracts/Dividend.sol#L194)、[contracts/Dividend.sol](contracts/Dividend.sol#L453)、[contracts/Dividend.sol](contracts/Dividend.sol#L524)

旧实现允许调用方把重复的 `cycleIndex` 或重复的 `token` 传入：

1. `estimateDividends` 会出现重复估算
2. `withdrawDividends` 会在同一笔调用里因为重复键走到 `Already claimed`

这不一定会直接损失资金，但接口语义非常脆弱，前端或脚本稍有疏忽就会触发不稳定行为。

本次新增 `_validateDividendInputs`，在两个入口统一拒绝：

1. 重复 `cycleIndex`
2. 重复 `token`

#### 6. 增加最小安全的 `StakeRecord` 压缩

修改位置：[contracts/Dividend.sol](contracts/Dividend.sol#L209)、[contracts/Dividend.sol](contracts/Dividend.sol#L297)、[contracts/Dividend.sol](contracts/Dividend.sol#L329)、[contracts/Dividend.sol](contracts/Dividend.sol#L360)、[contracts/Dividend.sol](contracts/Dividend.sol#L393)

在修复跨周期快照问题之后，`StakeRecord` 的增长模式会更接近 checkpoint 模型：

1. 每次发生跨周期持仓变化，都可能新增一条新的有效记录
2. 这些记录不能随意删除，因为它们可能仍然承担历史收益查询的语义

这意味着历史记录必须保留，但同一周期里“先改再改回去”的冗余 checkpoint 其实可以安全回收。

本次新增 `_compactStakeRecords`，只做最小安全压缩：

1. 如果唯一那条记录被同周期往返操作压回 `0 / 0`，则直接 `pop`
2. 如果最后一条记录和前一条记录的 `normalAmount` / `devAmount` 完全一致，则说明这条当前周期 checkpoint 不再提供新的历史信息，可以 `pop`

这不会删除仍承担历史语义的 checkpoint，但可以避免同一周期来回操作导致的无意义增长。

### 兼容性影响评估

#### ABI / 接口调用兼容性

本次修改没有改变任何外部函数的：

1. 函数名
2. 参数顺序
3. 参数类型
4. 返回值类型

因此：

- 不影响 ABI 编码
- 不影响现有调用方集成
- 不影响代理后的函数选择器匹配

#### 代理升级与存储布局兼容性

本次没有新增、删除或重排状态变量，也没有修改 `StakeRecord`、`CycleInfo`、`RewardInfo` 的存储字段定义。

因此：

1. storage layout 不变
2. 不影响代理合约已有存储解释
3. 风险集中在运行时行为修复，而不是升级布局风险

### 行为语义补充说明

这轮修复和测试把 `DividendContract` 的几个关键语义固定了下来：

1. 周期边界之后才发生的 stake / unstake，必须先滚动到新周期，再影响新的有效持仓
2. 上一完整周期已经形成的分红基线，不能被晚到的 stake / unstake retroactive 改写
3. 用户的 `normalAmount` 和 `devAmount` 是同一份持仓快照的两个维度，跨周期修改任意一侧都不能丢掉另一侧
4. `updateTokenBalance` 仍然可以把直接转入的普通 ERC20 / 原生币纳入当期奖励池，但不再允许把 DAO 自身的 normal/dev token 作为 reward 同步进来
5. 零质押周期里的 reward 会被后续空周期继续 carry-over，但只有在后面出现有效 stake 并完整结算一个可领取周期后，才会真正被提取
6. 空周期里的 carry-over reward 不会因为连续复制到多个 cycleInfo 就被重复兑现，实际仍只受 `tokenBalances[token]` 和单次 withdraw 状态控制
7. `StakeRecord` 不是“每个周期一份全量快照”，而是“只在持仓变化时写入的 checkpoint”；因此历史上承担收益查询语义的检查点必须保留，但同周期往返产生的冗余 checkpoint 可以安全压缩

### 验证方式

本次围绕高风险路径补充了 `DividendContract` 的专项回归，重点覆盖：

1. `stakeDev` 与 `stakeNormal` 的联合计权
2. `updateTokenBalance` 对直接转入 ERC20 和原生币奖励的同步
3. `updateTokenBalance` 拒绝把 DAO 自身 normal/dev token 同步为 reward
4. 跨周期 `unstakeNormal` / `unstakeDev` 对当前有效持仓的影响
5. late `normal` / `dev` stake 不得污染上一轮奖励基线
6. late `normal` / `dev` unstake 不得污染上一轮奖励基线
7. `normal -> dev` 跨周期追加质押时保留原有 `normalAmount`
8. `dev -> normal` 跨周期追加质押时保留原有 `devAmount`
9. 重复 `cycleIndex` / `token` 输入在 `estimateDividends` 和 `withdrawDividends` 中被显式拒绝
10. 同一 reward token 在同一周期内多次 deposit 的累计行为
11. 零质押周期 reward carry-over 的延后领取语义
12. 空周期里的 carried reward 保持不可提取
13. carried reward 在多个空周期复制后仍只会被兑现一次
14. 同周期往返操作触发的冗余 checkpoint 压缩

验证结果：

- `npm test -- --grep "dividend"` 通过
- `npm test` 全量通过
- 当前全量回归结果：`128 passing`

### 2026-03-12 当日晚些时候的测试扩展补充

在上面的合约修复完成并稳定之后，这一轮又继续沿着高风险路径补充了更强的 `DividendContract` 回归，重点不是再改 Solidity，而是继续证明当前 checkpoint 与 carry-over 语义在更长路径下依然成立。

本次新增测试重点覆盖了以下几类组合场景：

1. 四个参与者在三个 reward cycle 中交错进行 `normal` / `dev` stake、partial unstake、full exit、late entry 和再次变更时，历史分红份额不会串账
2. 多用户在多个周期里交替执行“只提 ERC20 reward”与“只提原生币 reward”时，`user x cycle x token` 维度的领取状态保持隔离
3. 更长路径下的部分领取、后续再领取、以及不同领取顺序，不会破坏已经完成或尚未完成的 claim 标记
4. 四人混合分配下最后留在合约里的少量余额，仍然可以被明确解释为整数除法舍入残值，而不是重复领取或漏记账

这一批测试本身也经历了修正，暴露出的都是测试预期问题而不是新的合约逻辑 bug，主要包括：

1. 奖励 token allowance 低于场景中三次 deposit 的总和
2. 四人三周期场景里对分母变化后的 reward split 手工计算有误
3. 交替提取场景里对最终 remainder 的预期高估了 `1`

这些问题修正后，最终结论是：当前 `Dividend.sol` 在这批更极端的状态机式路径下仍然保持行为稳定，无需追加新的合约逻辑修改。

本次补充后，新增被固定下来的行为包括：

1. 四用户跨三周期的混合 stake 转移不会让较晚加入者分享不属于其历史周期的奖励
2. 一部分用户先提 token、另一部分用户先提 native，不会导致其它 token/cycle 的领取状态被误标为已领取
3. 在复杂路径下保留下来的少量 reward token 与 native 余额，仍然只来自确定性的整数除法舍入

对应新增测试位于：[test/dividend.ts](test/dividend.ts)

---

## 2026-03-12 Acquired 变更记录

### 合约

- 合约：`Acquired`
- 文件：[contracts/Acquired.sol](contracts/Acquired.sol)
- 相关测试：[test/acquired.ts](test/acquired.ts)

### 背景

`Acquired` 负责把外部资产销售给白名单用户，并按约定比例回收 DAO `NormalToken`。

它的核心风险点不在于复杂状态机数量，而在于“同一个 investment 是否会被重复结算”以及“ERC20 与原生币两条资产路径是否保持一致”。

这轮工作最初是继续补测试，但新增用例直接暴露出一个真实缺陷：`endInvestment` 缺少已结束状态保护。

### 修改目的

本次修改目标有三个：

1. 补齐 `Acquired` 在原生币销售路径上的回归覆盖
2. 固定 `canEndEarly` 为 `true` 时的部分销售提前结束语义
3. 阻止同一笔 investment 被重复执行 `endInvestment`

在继续补边界测试之后，本次目标又补充了第四项：

4. 让 `getAddressLeftAmount` 在 `step1` 精确截止时刻与 `invest` 的阶段判断保持一致

### 具体改动

#### 1. 为 `endInvestment` 增加重复结束保护

修改位置：[contracts/Acquired.sol](contracts/Acquired.sol)

本次在 `endInvestment` 入口新增：

1. `require(investment.end == false, "investment end")`

修复前的问题是：

1. 第一次 `endInvestment` 会把本次投资积累的 DAO Token 和未售出的资产返还给投资发起人
2. 但合约没有阻止第二次再次调用同一个 `investmentId`
3. 第二次调用不一定立刻因为业务状态被拒绝，而是可能在后续资产转账处基于“当前合约还剩多少余额”表现为偶然成功或偶然失败

这意味着如果合约里后来又装入了其它 investment 的库存或 DAO Token，旧 investment 就存在复用新资金池余额再次结算的风险。

修复后，同一笔 investment 在第一次结束后会被显式拒绝再次结束，而不是依赖后续资产余额偶然挡住。

#### 2. 修复 `step1` 精确截止时刻的额度查询语义

修改位置：[contracts/Acquired.sol](contracts/Acquired.sol)

后续新增边界测试又暴露出另一个真实问题：

1. `invest` 在 `block.timestamp == step1EndTime` 时，已经因为 `block.timestamp < investment.step1EndTime` 不成立而按 `step2` 语义执行
2. 但 `getAddressLeftAmount` 之前只有在 `block.timestamp > investment.step1EndTime` 时才返回 `0`

这会导致同一时刻出现读写不一致：

1. 写路径已经视为 `step2`
2. 读路径却还在返回 `step1` 剩余额度

本次将 `getAddressLeftAmount` 的判断改为 `block.timestamp >= investment.step1EndTime` 时返回 `0`，使它与 `invest` 的阶段切换边界保持一致。

### 新增测试覆盖

这轮对 `Acquired` 重点新增了以下测试：

1. 非法配置补充校验：总白名单百分比超过 100%、`tokenAmount == 0`、`tokenRatio` 非法
2. `canEndEarly == true` 时，投资人在 step2 结束前也可以对部分已售 investment 提前结算
3. 原生币销售路径：`tokenAddress == address(0)` 时，买家能收到原生币，投资人结算时能取回未售出的原生币和已回收的 DAO Token
4. 重复调用 `endInvestment` 必须直接以 `investment end` 被拒绝

继续补充之后，又新增固定了以下边界：

5. `startInvestment` 显式拒绝把 DAO `normalToken` 作为销售资产
6. 原生币销售启动时，`msg.value` 必须与 `tokenAmount` 精确一致，少 1 或多 1 都会被拒绝
7. 外部销售 token 的精度高于 DAO token 时，启动阶段直接拒绝
8. `block.timestamp == step1EndTime` 时，`getAddressLeftAmount` 必须返回 `0`，并且同一时刻的 `invest` 必须按 `step2` 执行
9. `block.timestamp == step2EndTime` 时允许最后一笔投资，之后 1 秒必须稳定拒绝
10. 过小的 DAO token 投入如果因为整数除法会换算成 `0` 个 sale token，必须显式返回 `invalid amount`
11. 库存只差 1 个 sale token 不足时，必须稳定返回 `not enough token`

### 风险说明

这次修复的是一个资产结算类真实缺陷，而不是单纯的输入校验增强。

如果不修：

1. 同一个 `investmentId` 的结束动作可能复用后续新 investment 留在合约里的余额
2. 问题表面上会看起来像“ERC20 余额不够”或“偶发失败”，但根因其实是缺少业务状态保护
3. 在多轮连续开售的场景里，这种问题比单次测试更危险，因为它可能跨投资实例串账

### 验证结果

- `npm test -- --grep "acquired"` 通过
- `npm test` 全量通过
- 当前全量回归结果：`135 passing`

---

## 2026-03-12 SourceTokenLockup 变更记录

### 合约

- 合约：`SourceTokenLockup`
- 文件：[contracts/TokenLockup.sol](contracts/TokenLockup.sol)
- 相关测试：[test/lockup.ts](test/lockup.ts)

### 背景

`SourceTokenLockup` 的职责相对集中：在指定项目版本正式发布前接收锁仓分配，发布后按 180 天线性释放。

它的高风险点主要不在复杂算术，而在于两个时间语义：

1. 解锁是否从正确的发布时间开始生效
2. 一旦进入解锁期，是否还能继续写入新的锁仓

这一轮继续补边界测试后，暴露出一个真实缺陷：如果主项目版本已经 release，但还没有任何地址第一次调用 `claimTokens` 把 `unlockTime` 持久化，两个锁仓入口仍然允许继续写入新锁仓。

### 修改目的

本次修改目标有两个：

1. 固定 `SourceTokenLockup` 在输入长度、解锁起点、部分领取后的剩余额度这些边界行为
2. 阻止合约在项目版本已经发布后继续接受新的锁仓写入

### 具体改动

#### 1. 为锁仓入口增加“已进入解锁期”的统一判断

修改位置：[contracts/TokenLockup.sol](contracts/TokenLockup.sol)

本次新增内部函数 `_isUnlocked()`，并让以下两个入口统一使用它：

1. `transferAndLock`
2. `convertAndLock`

修复前的问题是：

1. 两个入口只检查 `unlockTime == 0`
2. 但 `unlockTime` 只有在第一次 `claimTokens` 时才会从 `versionReleasedTime(...)` 持久化进状态变量
3. 因此如果版本已经 release、只是还没人 claim，合约仍会错误地认为“尚未解锁”，继续接受新的锁仓

这与合约和文档里的业务语义不一致，因为发布后的线性释放期已经开始，不应再让新的历史锁仓混入同一释放轨道。

修复后：

1. 只要 `unlockTime > 0`，视为已进入解锁期
2. 或者即使 `unlockTime == 0`，只要 `project.versionReleasedTime(unlockProjectName, unlockProjectVersion) > 0`，也同样视为已进入解锁期

这样即使首个 claim 还没发生，只要目标版本已经正式发布，新的锁仓写入就会被稳定拒绝。

### 新增测试覆盖

这轮对 `SourceTokenLockup` 重点新增了以下测试：

1. `convertAndLock` / `transferAndLock` 输入数组长度不一致时必须拒绝
2. 在精确的 release timestamp 上，可领取数量仍然应为 `0`
3. 30 天部分解锁后，把当前可领取额度全部提完，再继续领取 1 个单位必须拒绝
4. 项目版本已经 release 但首个 claim 还未发生时，两个锁仓入口都必须直接返回 `already Unlocked`

### 风险说明

这次修复的是真实业务状态缺陷，而不是纯测试补洞。

如果不修：

1. 发布后的新锁仓会混入一个已经开始线性释放的池子
2. 后续用户看到的 `totalAssigned`、`getCanClaimTokens` 和实际释放节奏会偏离“发布前一次性锁定，发布后逐步释放”的原始语义
3. 这种问题不会在简单 happy path 中立即暴露，但会在发布后补录锁仓、或运营流程滞后于链上 release 时引入账务和预期不一致

### 验证结果

- `npm test -- --grep "Lockup"` 通过
- `npm test` 全量通过
- 当前全量回归结果：`138 passing`

---

## 2026-03-12 Committee 变更记录

### 合约

- 合约：`SourceDaoCommittee`
- 文件：[contracts/Committee.sol](contracts/Committee.sol)
- 相关测试：[test/committee.ts](test/committee.ts)、[test/upgrade.ts](test/upgrade.ts)

### 背景

`SourceDaoCommittee` 是整个 DAO 的治理入口，负责成员变更、委员会整体替换、参数治理，以及 UUPS 升级提案验证。

此前测试只覆盖了最基础的增删成员 happy path，缺少以下几类高价值治理边界：

1. 整组委员会替换之后，旧成员权限是否被立刻撤销
2. 升级提案在参数不匹配或过期后，队列状态是否能正确保留或清理
3. “移除成员”提案在目标地址已经不再是委员会成员时，是否还能被空执行
4. `setDevRatio` 在最终版本发布前后的执行边界是否一致
5. `fullPropose` 是否真的按 token 权重、投票参与率和同意/反对票差额结算

继续补测试后，除了第三类路径暴露出真实语义缺口外，又进一步发现另一处治理漏洞：如果 `setDevRatio` 提案在最终版本发布前已经通过，但执行发生在发布之后，旧实现仍会把 `devRatio` 改成一个非 `finalRatio` 的值，违背“正式版发布后固定为 finalRatio”的语义。

### 修改目的

本次修改目标有五个：

1. 固定委员会整组替换后的权限切换语义
2. 固定升级提案在错误实现地址和过期取消场景下的队列行为
3. 阻止对已经不是委员会成员的地址继续执行旧的移除提案
4. 阻止最终版本发布后的旧 `setDevRatio` 提案把比例改回非最终值
5. 固定 full proposal 的加权投票结算语义

### 具体改动

#### 1. 为移除成员提案增加目标成员存在性校验

修改位置：[contracts/Committee.sol](contracts/Committee.sol)

本次在两个位置补上了 `member not found` 校验：

1. `prepareRemoveMember` 提案创建阶段
2. `removeCommitteeMember` 执行阶段

修复前的问题是：

1. 可以为一个当前并不在委员会中的地址创建移除提案
2. 更隐蔽的是，即使提案创建时目标地址确实是成员，只要它在执行前已经被其它治理动作移除，旧提案仍会继续走到 `_setProposalExecuted` 并发出 `MemberRemoved`
3. 这样链上状态虽然不会真的再删除一次地址，但事件与业务语义已经不一致

修复后：

1. 非成员地址不能再进入移除提案流程
2. 已通过但过时的移除提案，也不能在执行阶段对一个已不再属于委员会的地址“空执行”

#### 2. 补齐整组换届的治理回归覆盖

新增测试固定了 `prepareSetCommittees(..., false)` / `setCommittees(...)` 的关键行为：

1. 非委员会成员不能发起普通换届提案
2. 过半支持后可以整体替换委员会成员列表
3. 换届完成后，旧成员必须立即失去 `prepareAddMember` 等治理权限

这类测试不是修合约 bug，而是把当前设计中的“权限立即切换”显式固定下来，避免以后改治理逻辑时悄悄退化。

#### 3. 补齐升级提案的队列保留与过期清理路径

新增测试固定了两个容易漏掉的 UUPS 治理边界：

1. 当提案通过后，若代理升级时传入的实现地址与提案参数不匹配，`verifyContractUpgrade` 必须返回失败，同时保留原升级提案，不得误清队列
2. 当升级提案过期后，委员会成员调用 `cancelContractUpgrade` 必须清空 `contractUpgradeProposals` 中的挂起记录，并允许同一个代理重新发起升级提案

这两条路径能保证升级治理既不会因为一次错误实现地址调用把合法提案清掉，也不会让过期提案永久占住升级槽位。

#### 4. 修复最终版本发布后旧 `setDevRatio` 提案仍可覆盖 `finalRatio` 的问题

修改位置：[contracts/Committee.sol](contracts/Committee.sol)

本次在 `setDevRatio(...)` 执行路径中增加了最终版本已发布时的特殊处理：

1. 如果主项目 `mainProjectName/finalVersion` 已经有 `versionReleasedTime`
2. 那么即使当前提案在发布前已经通过，也不会再把 `devRatio` 设成提案中的旧值
3. 相反，合约会把 `devRatio` 同步到 `finalRatio`，并把该提案标记为已执行

修复前的问题是：

1. `prepareSetDevRatio` 只在提案创建时阻止“发布后再创建新提案”
2. 但对“发布前已通过、发布后才执行”的旧提案没有保护
3. 结果是 `devRatio` 可以在最终版本发布后被重新写成 `180` 之类的非最终值

修复后，正式版发布后任何对这类旧提案的执行都会收敛到 `finalRatio`，不再让历史提案破坏最终治理参数。

#### 5. 补齐 full proposal 的 token 加权结算覆盖

新增测试固定了 `fullPropose(...)` / `endFullPropose(...)` 的关键行为：

1. 只有 DAO 模块地址才能发起 full proposal，EOA 直接调用必须拒绝
2. full proposal 的投票权重来自 `normalToken.balance + devToken.balance * devRatio / 100`
3. 若总参与权重未达到门槛，即使存在支持票，也必须进入 `Expired`
4. 只有在参与权重过门槛且 `agree > reject` 时，提案才应进入 `Accepted`

继续补充之后，又把以下更低频但容易被重构破坏的细边界固定了下来：

5. `endFullPropose(...)` 可以分批结算，不会重复统计已经处理过的 voter
6. 同一个 voter 即使被重复传入后续结算批次，也不能二次计票
7. 当参与权重已经过门槛但加权结果形成平票或支持票不占优时，提案必须进入 `Rejected`
8. 如果最终版本已经发布，则 full proposal 结算前要先把 `devRatio` 收敛到 `finalRatio`，并按最终权重计算 `agree`、`reject` 与 `totalReleasedToken`

这批测试把 full proposal 和普通 committee 多数票提案的差异明确固定了下来，避免以后把两套结算语义混淆。

### 风险说明

这次修复的是治理语义错误，而不是单纯测试补洞。

如果不修：

1. 旧的移除提案可能在目标成员已经被换届移出后仍然被执行并发出 `MemberRemoved`
2. 链上事件会向外部索引器和运维工具暴露错误信号，造成“这次移除是由哪笔提案完成”的审计混淆
3. 治理状态机会出现“提案是旧的，但执行看起来仍然有效”的假象
4. 正式版发布后，历史 `setDevRatio` 提案仍可能把治理参数改回非 `finalRatio`，破坏最终版本参数冻结语义
5. full proposal 的 token 加权门槛如果没有测试固定，后续重构时很容易被误改成普通人数多数票逻辑
6. full proposal 的分批结算如果没有覆盖，后续优化时很容易引入重复计票或批次间状态污染

### 验证结果

- `npm test -- --grep "Committee|upgrade"` 通过
- `npm test` 全量通过
- 当前全量回归结果：`156 passing`

---

## 2026-03-12 SourceDao 变更记录

### 合约

- 合约：`SourceDao`
- 文件：[contracts/Dao.sol](contracts/Dao.sol)
- 相关测试：[test/dao.ts](test/dao.ts)

### 背景

`SourceDao` 本身逻辑不复杂，核心职责是保存各模块地址，并作为其它模块判断“谁属于 DAO 白名单”的路由中心。

这一轮继续补 Dao wiring 的低频边界时，暴露出一个之前测试没有覆盖到的真实配置缺口：所有模块地址 setter 都允许传入零地址。

这个问题表面上看像“部署时多传了一个无效值”，但实际会破坏 `onlySetOnce` 的核心语义，因为：

1. 当前 slot 初始值本来就是 `address(0)`
2. 如果第一次调用把它再次设成 `address(0)`，状态不会发生任何变化
3. 后续仍然可以继续调用同一个 setter，把该模块地址改成任意非零地址

也就是说，零地址写入虽然看起来像一次配置，实际上不会消耗掉“一次性设置”的机会。

### 修改目的

本次修改目标有两个：

1. 阻止所有模块地址 slot 接受零地址配置
2. 固定“被拒绝的零地址尝试不能破坏后续一次性配置语义”

### 具体改动

#### 1. 为所有模块地址 setter 增加统一零地址校验

修改位置：[contracts/Dao.sol](contracts/Dao.sol)

本次新增内部函数 `_requireValidAddress(address)`，并在以下入口统一调用：

1. `setDevTokenAddress`
2. `setNormalTokenAddress`
3. `setCommitteeAddress`
4. `setProjectAddress`
5. `setTokenLockupAddress`
6. `setTokenDividendAddress`
7. `setAcquiredAddress`

所有这些入口现在都会对 `address(0)` 直接返回 `invalid address`。

修复前的问题是：

1. 零地址写入会“看起来调用成功”，但实际上 slot 仍保持在默认零值
2. `onlySetOnce` 因为检查的是“当前值是否为零”，所以下一次调用仍然不会被阻止
3. 这让部署或运维流程中的一次无效写入悄悄绕过了一次性配置的设计初衷

修复后，模块地址 slot 必须第一次就写入有效非零地址，失败的零地址尝试不会污染状态，也不会改变后续一次性配置语义。

#### 2. 补齐 Dao wiring 的零地址回归覆盖

新增测试固定了两类以前没被钉住的边界：

1. 所有模块地址 setter 对零地址都必须稳定拒绝
2. 一次被拒绝的零地址尝试之后，后续第一次有效配置仍然必须成功，而且第二次有效配置仍必须因 `can set once` 被拒绝

这批测试把“输入校验”和“一次性配置语义”绑定在一起，避免以后只看 getter happy path 时遗漏这类部署期漏洞。

### 风险说明

这次修复的是一个真实配置漏洞，而不是低价值的校验美化。

如果不修：

1. 任何模块 slot 都可以先被写成零地址，再在后续重新写入另一个地址
2. `onlySetOnce` 名义上存在，但零地址路径会让它失去“首次写入即锁定”的实际含义
3. 部署脚本、手工运维或错误交易都可能在不显眼的情况下留下可重写配置窗口

### 验证结果

- `npm test -- --grep "dao"` 通过
- `npm test` 全量通过
- 当前全量回归结果：`158 passing`

---

## 2026-03-12 SourceDao 初始化与 Token 路由补充记录

### 合约

- 合约：`SourceDao`、`DevToken`、`NormalToken`
- 文件：[contracts/Dao.sol](contracts/Dao.sol)、[contracts/DevToken.sol](contracts/DevToken.sol)、[contracts/NormalToken.sol](contracts/NormalToken.sol)
- 相关测试：[test/upgrade.ts](test/upgrade.ts)、[test/dev.ts](test/dev.ts)、[test/token.ts](test/token.ts)

### 背景

继续往底层初始化和权限边界推进时，这一轮暴露出两个更靠近根因的问题：

1. `SourceDao.initialize()` 没有把 `mainContractAddress` 绑定到代理自身
2. `SourceDao.version()` 没有声明成 `virtual`，导致 DAO 自身升级 mock 甚至无法构造

第一个问题不是测试洁癖，而是实质性的升级授权漏洞。因为 `SourceDaoContractUpgradeable._authorizeUpgrade()` 依赖 `getMainContractAddress().committee()`，如果 DAO 自己没有在初始化时把 `mainContractAddress` 指向自己，那么：

1. DAO 代理的升级授权链会落到零地址调用
2. 任意地址还可以抢先调用一次 `setMainContractAddress(...)`，把 DAO 主地址绑定到错误目标

此外，这一轮也顺手补齐了 `DevToken` 和 `NormalToken` 先前没被固定的几条路由与初始化边界。

### 修改目的

本次修改目标有三个：

1. 让 `SourceDao` 在初始化后立刻拥有正确且不可抢占的主合约绑定
2. 让 DAO 自身的 UUPS 升级路径可以被真实测试和验证
3. 固定 `DevToken` / `NormalToken` 的初始化、转换和路由边界

### 具体改动

#### 1. 修复 `SourceDao` 初始化时未自绑定主合约地址的问题

修改位置：[contracts/Dao.sol](contracts/Dao.sol)

本次把：

1. `__SourceDaoContractUpgradable_init(address(0))`

改成：

2. `__SourceDaoContractUpgradable_init(address(this))`

修复前的问题是：

1. `mainContractAddress` 在 DAO 代理初始化后仍为零地址
2. DAO 自身调用 `_authorizeUpgrade()` 时无法通过正确的 committee 路径完成验证
3. 因为 `setMainContractAddress` 仍处于“可首次设置”状态，外部地址理论上还能抢先把它绑定到错误目标

修复后，DAO 代理一部署完成就会把主地址固定到自己，升级授权链和后续模块路由都使用一致的根地址。

#### 2. 为 `SourceDao.version()` 增加 `virtual`

修改位置：[contracts/Dao.sol](contracts/Dao.sol)

这项改动本身不改变运行时逻辑，但它修复了一个真实的可升级性缺口：此前 DAO 自身的 V2 mock 无法覆盖 `version()`，意味着我们连最基本的“DAO 代理自身能否升级”都无法通过继承 mock 进行回归验证。

加上 `virtual` 之后，DAO 自身升级路径终于可以像其它 UUPS 合约一样被直接测试。

#### 3. 补齐 `DevToken` / `NormalToken` 的初始化与路由测试

新增测试固定了以下边界：

1. `DevToken.initialize(...)` 在地址数组和金额数组长度不一致时必须拒绝
2. `DevToken.initialize(...)` 在初始分配总额超过总供应量时必须拒绝
3. `project` 地址领取到的 DevToken 可以继续向贡献者分发
4. `lockup` 路由只能接收 DevToken，不能再向外普通转出
5. `dividend` 路由既可以接收，也可以按当前设计继续向外转出
6. `dev2normal` 在余额不足时必须稳定失败

这些测试没有引出新的 token 合约逻辑 bug，但把此前只靠代码阅读推断的行为正式固定了下来。

### 风险说明

这次 `SourceDao` 的初始化修复属于高价值根因修复。

如果不修：

1. DAO 自身升级授权链从初始化开始就是断的
2. `setMainContractAddress(...)` 会在 DAO 代理上留下一个可被外部首次写入的抢占窗口
3. 后续即使 committee 和 upgrade proposal 逻辑本身正确，DAO 代理也可能因为主地址根配置错误而无法安全升级

### 验证结果

- `npm test -- --grep "upgrade"` 通过
- `npm test -- --grep "token|dev"` 通过
- `npm test` 全量通过
- 当前全量回归结果：`162 passing`

---

## 2026-03-13 SourceDaoUpgradeable 与根配置边界补充记录

### 合约

- 合约：`SourceDaoUpgradeable`、`SourceDaoCommittee`、`DividendContract`、`SourceTokenLockup`
- 文件：[contracts/SourceDaoUpgradeable.sol](contracts/SourceDaoUpgradeable.sol)、[contracts/Committee.sol](contracts/Committee.sol)、[contracts/Dividend.sol](contracts/Dividend.sol)、[contracts/TokenLockup.sol](contracts/TokenLockup.sol)
- 相关测试：[test/source_dao_upgradeable.ts](test/source_dao_upgradeable.ts)、[test-hh3/source_dao_upgradeable.ts](test-hh3/source_dao_upgradeable.ts)、[test/committee.ts](test/committee.ts)、[test/dividend.ts](test/dividend.ts)、[test/lockup.ts](test/lockup.ts)

### 背景

在把 `SourceDao` 自绑定和 DAO 自升级路径补齐之后，剩下的高价值风险基本都集中在“根配置是否允许进入无意义或可劫持状态”这一层。

这一轮继续往下看时，发现还有几类输入虽然不常走到，但一旦写入就会直接污染系统根状态：

1. `SourceDaoUpgradeable` 允许以零地址初始化，未初始化代理还允许把主地址晚绑定到 EOA
2. `Committee.initialize(...)` 允许 `initProposalId == 0`，而 0 又是升级 proposal 内部状态的哨兵值
3. committee 成员列表在初始化和替换路径里都没有拒绝空列表、零地址或重复成员
4. `Dividend.initialize(...)` 允许 `cycleMinLength == 0`
5. `TokenLockup.initialize(...)` 允许空项目名和 `unlockVersion == 0`

这些都不是表面的参数洁癖，而是会把治理、周期推进或解锁语义直接带入错误初始状态的根配置缺口。

### 修改目的

本次修改目标有四个：

1. 把 `mainContractAddress` 绑定规则收紧到“初始化即有效，晚绑定只能指向真实合约”
2. 消除 committee 初始化和成员替换中的无效治理配置
3. 拒绝会破坏周期语义和解锁语义的无效初始化参数
4. 通过独立回归测试把这些基础层边界长期固定下来

### 具体改动

#### 1. 收紧 `SourceDaoUpgradeable` 的主地址绑定规则

修改位置：[contracts/SourceDaoUpgradeable.sol](contracts/SourceDaoUpgradeable.sol)

本次修改后：

1. `__SourceDaoContractUpgradable_init(address mainAddr)` 必须接收非零主地址
2. `setMainContractAddress(address newAddr)` 只能把未绑定代理晚绑定到非零且带代码的合约地址

这意味着：

1. 初始化阶段不能再留下“主地址为空”的半配置状态
2. 晚绑定路径不能再把根路由指向 EOA 或零地址
3. 一次性绑定语义终于和“绑定的是有效 DAO 合约”这件事绑定在一起

同时新增了专门的 `SourceDaoUpgradeableMock` 与独立 HH3 测试入口，直接覆盖：

1. 零地址初始化拒绝
2. 已初始化代理不可重绑
3. 未初始化代理只能晚绑定到真实合约

#### 2. 补齐 `Committee` 的根配置校验

修改位置：[contracts/Committee.sol](contracts/Committee.sol)

本次新增了 `_validateCommitteeList(...)`，并把它接入：

1. `initialize(...)`
2. `prepareSetCommittees(...)`
3. `setCommittees(...)`

新的约束是：

1. committee 列表不能为空
2. 不能包含零地址成员
3. 不能包含重复成员
4. `initProposalId` 必须大于 0

这里的核心点不只是“成员列表更整洁”，而是避免系统在初始化后就进入：

1. 没有任何 committee 的不可治理状态
2. 含零地址成员的错误投票集合
3. 重复成员导致的计票/语义混乱
4. 与 proposal 哨兵值冲突的初始 proposal 编号

#### 3. 拒绝 `Dividend` 的零周期长度配置

修改位置：[contracts/Dividend.sol](contracts/Dividend.sol)

`cycleMinLength` 现在必须大于 0。

如果允许为 0，那么 dividend 的“新周期是否应该开启”判断会在每次交互时都具备立即滚动条件，整个周期模型会退化成无稳定边界的状态机。

#### 4. 拒绝 `TokenLockup` 的无效跟踪解锁配置

修改位置：[contracts/TokenLockup.sol](contracts/TokenLockup.sol)

现在要求：

1. `unlockProjectName` 不能是空 `bytes32`
2. `unlockVersion` 必须大于 0

此前如果接受这些值，Lockup 就可能从部署开始就跟踪一个不存在、无意义、或者永远不可能正确匹配的 release 目标。

### 风险说明

这一轮修复的共同特点是：它们都位于“系统还没真正运行起来之前”的根配置层。

如果不修：

1. 某些模块会在初始化后立刻处于不可授权或可误绑定状态
2. committee 可能以无成员、脏成员或哨兵 proposal id 启动
3. dividend 周期边界会退化
4. lockup 解锁条件可能从部署时起就是伪配置

这类问题平时不一定频繁触发，但一旦写入链上状态，后果通常比普通业务分支 bug 更难纠正。

### 验证结果

- `npx hardhat test test-hh3/source_dao_upgradeable.ts` 通过
- `npm test -- --grep "Committee|dividend"` 通过
- `npm test -- --grep "Committee|Lockup"` 通过
- `npm test` 全量通过
- 当前全量回归结果：`169 passing`

---

## 2026-03-13 ERC20 转账风险收口记录

### 合约

- 合约：`ProjectManagement`、`DividendContract`、`Acquired`、`SourceTokenLockup`
- 文件：[contracts/Project.sol](contracts/Project.sol)、[contracts/Dividend.sol](contracts/Dividend.sol)、[contracts/Acquired.sol](contracts/Acquired.sol)、[contracts/TokenLockup.sol](contracts/TokenLockup.sol)
- 测试与 mock：[test/project.ts](test/project.ts)、[test/dividend.ts](test/dividend.ts)、[test/acquired.ts](test/acquired.ts)、[contracts/mocks/FalseReturnToken.sol](contracts/mocks/FalseReturnToken.sol)、[contracts/mocks/ConfigurableReturnToken.sol](contracts/mocks/ConfigurableReturnToken.sol)

### 背景

这一轮从 `Project` 的额外代币托管路径开始，向仓库里所有 ERC20 转账入口做了同类风险复查。

复查结果表明，仓库里原先默认依赖了一个并不可靠的前提：只要 ERC20 转账失败，它就会 `revert`。但现实里存在另一类合法实现：

1. `transferFrom(...)` 返回 `false`，但不回滚
2. `transfer(...)` 返回 `false`，但不回滚

在这种 token 语义下，如果合约没有检查返回值，就会出现“业务状态已经推进，但真实资产并没有完成转移”的账实分叉问题。

### 修改目的

本次修改目标有三个：

1. 修复 `Project`、`Dividend`、`Acquired` 中对任意外部 ERC20 的高风险静默失败路径
2. 用专门的 false-return mock 把这些边界固定为长期回归
3. 顺手把 `TokenLockup` 与 `Dividend` 中 DAO 自有 token 的转账语义也统一到 `SafeERC20`

### 具体改动

#### 1. 修复 `Project` 的额外代币托管与分发静默失败问题

修改位置：[contracts/Project.sol](contracts/Project.sol)

`Project` 现在使用 `SafeERC20` 处理：

1. `createProject(...)` 中的额外代币托管
2. `cancelProject(...)` 中的额外代币退回
3. `promoteProject(...)` 中低评分项目的未分配额外代币返还
4. `withdrawContributions(...)` 中的额外代币和 DevToken 发放

修复前，如果额外代币 `transferFrom(...)` 返回 `false`，项目仍可能被创建成功，但合约并没有真正托管对应资产。

#### 2. 修复 `Dividend` 的奖励代币入账与提现静默失败问题

修改位置：[contracts/Dividend.sol](contracts/Dividend.sol)

高风险点主要有两处：

1. `deposit(...)` 过去会在 `transferFrom(...)` 未真正成功时仍把奖励记入 cycle 和 `tokenBalances`
2. `withdrawDividends(...)` 过去会在 ERC20 `transfer(...)` 返回 `false` 时仍走后续状态路径，造成“已领取状态”和真实到账脱节的风险

现在这两条外部奖励 token 路径都改为 `SafeERC20`。

另外，这一轮也把以下 DAO 内部 token 路径统一成了 `SafeERC20`：

1. `stakeNormal(...)`
2. `stakeDev(...)`
3. `unstakeNormal(...)`
4. `unstakeDev(...)`

这部分不是新发现的高危漏洞，而是为了把仓库内 ERC20 交互语义收敛成一致实现。

#### 3. 修复 `Acquired` 的标的托管与发放静默失败问题

修改位置：[contracts/Acquired.sol](contracts/Acquired.sol)

`Acquired` 中的以下路径现在都改为 `SafeERC20`：

1. `startInvestment(...)` 托管外部标的 token
2. `invest(...)` 收取 DAO normal token
3. `invest(...)` 向买方发放外部标的 token
4. `endInvestment(...)` 向投资人结算 DAO normal token 和剩余外部标的 token

修复前，如果标的 token 在托管或发放阶段返回 `false`，投资轮仍可能被创建或推进，但真实资产并未同步完成移动。

#### 4. 统一 `TokenLockup` 的 DAO 内部 token 转账语义

修改位置：[contracts/TokenLockup.sol](contracts/TokenLockup.sol)

这一轮把以下路径统一成 `SafeERC20`：

1. `transferAndLock(...)`
2. `convertAndLock(...)`
3. `claimTokens(...)`

这里主要是工程一致性收口。因为这些路径操作的是 DAO 自有 token，现实风险低于任意外部 ERC20 输入面，但统一后能减少未来继续演化时的语义分叉。

### 测试补充

新增两个专用 mock：

1. `FalseReturnToken`：`transfer` / `transferFrom` 恒定返回 `false`
2. `ConfigurableReturnToken`：可按测试场景切换 `transfer` 或 `transferFrom` 返回 `false`

基于这两个 mock，本次补了以下关键回归：

1. `Project.createProject(...)` 在额外代币 escrow `transferFrom` 返回 `false` 时必须拒绝
2. `Dividend.deposit(...)` 在奖励 token `transferFrom` 返回 `false` 时必须拒绝
3. `Dividend.withdrawDividends(...)` 在奖励 token `transfer` 返回 `false` 时必须整体回滚，并保持 claim 状态与余额不变
4. `Acquired.startInvestment(...)` 在标的 token escrow `transferFrom` 返回 `false` 时必须拒绝
5. `Acquired.invest(...)` 在标的 token payout `transfer` 返回 `false` 时必须整体回滚，并保持 investment 统计不变

### 风险说明

这轮收口修复的是典型的“账实分叉型”基础资产路径问题。

如果不修：

1. 项目可能在没有真实托管额外代币的情况下创建成功
2. 分红池可能记录了从未真正到账的奖励
3. 用户分红可能在未真正收到代币时被错误视为已领取
4. 投资轮可能在没有真实托管或没有真实发放标的资产的情况下推进状态

和普通业务分支 bug 相比，这类问题更接近资金记账层错误，一旦进入链上状态，后续排查和补救都更困难。

### 验证结果

- `npm test -- --grep "project"` 通过
- `npm test -- --grep "dividend|acquired"` 通过
- `npm test -- --grep "dividend|Lockup|lockup"` 通过
- `npm test` 全量通过
- 当前全量回归结果：`174 passing`

---

## 2026-03-13 Acquired / Dividend 原生币发送修正记录

### 合约

- 合约：`Acquired`、`DividendContract`
- 文件：[contracts/Acquired.sol](contracts/Acquired.sol)、[contracts/Dividend.sol](contracts/Dividend.sol)
- 测试与 mock：[test/acquired.ts](test/acquired.ts)、[test/dividend.ts](test/dividend.ts)、[contracts/mocks/NativeReceiverMock.sol](contracts/mocks/NativeReceiverMock.sol)

### 背景

这一轮修改来自原生币发送路径的兼容性复查。

旧实现中，`Acquired` 和 `Dividend` 在向用户发送链上原生币时使用的是 Solidity 自带的 `transfer(...)`。这种写法依赖一个较强的前提：

1. 接收方地址是 EOA，或者
2. 接收方是合约，但其 `receive` / `fallback` 逻辑能在 `transfer` 提供的 gas stipend 内完成

这个前提在现实里并不稳固。只要接收方合约的收款逻辑稍微复杂一些，例如记录计数、更新统计、触发简单的状态写入，`transfer(...)` 就可能因为 gas 不足而直接回滚。

这会带来两个实际问题：

1. `Acquired` 中以原生币作为标的资产的投资轮，可能无法向合约买家发放标的，或者无法把剩余库存退回给合约投资人
2. `Dividend` 中以原生币作为奖励的分红，可能无法发放给合约类型的领取者

换句话说，旧实现不是“逻辑错误”，而是原生币发送方式过于保守，导致对合约接收方兼容性不足。

### 修改目的

本次修改目标有三个：

1. 让 `Acquired` 支持向需要更多 gas 的合约接收方发送原生币
2. 让 `Dividend` 支持向需要更多 gas 的合约领取者发送原生币
3. 用专门的合约接收方 mock 把这类回归固定下来，避免未来又退回到 `transfer(...)`

### 具体改动

#### 1. 为 `Acquired` 增加统一的原生币发送辅助函数

修改位置：[contracts/Acquired.sol](contracts/Acquired.sol)

新增内部函数：

- `_sendNative(address to, uint256 amount)`

实现改为：

- `payable(to).call{value: amount}("")`
- 若发送失败，显式 `revert("native transfer failed")`

并将以下原先使用 `transfer(...)` 的路径统一切换到 `_sendNative(...)`：

1. `invest(...)` 中向买方发送原生币标的
2. `endInvestment(...)` 中向投资人退回未售出的原生币库存

#### 2. 为 `Dividend` 增加统一的原生币发送辅助函数

修改位置：[contracts/Dividend.sol](contracts/Dividend.sol)

同样新增：

- `_sendNative(address to, uint256 amount)`

并将 `withdrawDividends(...)` 中原先使用 `transfer(...)` 的原生币发放路径切换为 `_sendNative(...)`。

#### 3. 保持重入边界不变

虽然本次从 `transfer(...)` 改成了低级 `call(...)`，但本轮没有放宽重入保护：

1. `Acquired.invest(...)`
2. `Acquired.endInvestment(...)`
3. `Dividend.withdrawDividends(...)`

这些函数本身仍然处于 `nonReentrant` 保护下，因此兼容性提高的同时，没有额外打开新的原生币重入入口。

#### 4. 进一步把关键路径收紧到更接近 CEI

在引入 `call(...)` 之后，又补了一轮状态落点梳理，避免安全性主要依赖 `nonReentrant`：

1. `Acquired.endInvestment(...)` 现在会先把 `investment.end` 置为 `true`，再执行对外转账
2. `Dividend.withdrawDividends(...)` 现在会先扣减 `tokenBalances[token]`，再执行原生币或 ERC20 发放

这两处修改不会改变最终成功路径的业务结果，但会让实现更接近“检查 - 生效 - 交互”的推荐结构。

同时，因为 EVM 在 `revert` 时会回滚整笔交易状态：

1. 如果 `call(...)` 或代币发送失败，提前写入的状态不会残留
2. 失败时仍然保持原子性，不会出现“状态已更新但资产未发出”的半完成状态

### 兼容性影响

#### ABI / 外部接口

本次修改没有新增、删除或重排外部函数参数。

因此：

1. 不影响 ABI
2. 不影响已有前端或脚本的 calldata 编码
3. 不改变代理合约的外部调用方式

#### 存储布局

本次只新增了内部函数，没有新增状态变量，也没有调整现有状态变量顺序。

因此：

1. 不影响 UUPS 代理的存储布局
2. 不影响已有链上状态解释
3. 不引入代理升级布局风险

#### 行为语义

本次行为变化只体现在一处：

1. 过去某些“合约接收方”在收原生币时会因为 `transfer(...)` 的 gas 限制而失败
2. 现在这些接收方在收原生币时可以正常完成接收逻辑

也就是说，这是一项兼容性修复，不是资产记账规则或业务状态机的变更。

### 验证方式

新增专用 mock：

1. `NativeReceiverMock`：在 `receive()` 中执行状态写入，用来模拟需要超过 `transfer(...)` stipend 的合约接收方

基于这个 mock，本次补了以下关键回归：

1. `Acquired` 支持向合约买家发放原生币标的
2. `Acquired` 支持向合约投资人退回未售出的原生币库存
3. `Dividend` 支持向合约领取者发放原生币分红
4. `Acquired` 在合约投资人主动拒收原生币时，`endInvestment(...)` 必须整体回滚，不能提前把 `end` 状态写死
5. `Dividend` 在合约领取者主动拒收原生币时，`withdrawDividends(...)` 必须整体回滚，不能提前扣减余额或污染领取状态

### 验证结果

- `bash -lc 'source "$HOME/.nvm/nvm.sh" && npm test -- --grep "acquired|dividend"'` 通过
- `bash -lc 'source "$HOME/.nvm/nvm.sh" && npm test'` 全量通过
- 当前全量回归结果：`177 passing`
