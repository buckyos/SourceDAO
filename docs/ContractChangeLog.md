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