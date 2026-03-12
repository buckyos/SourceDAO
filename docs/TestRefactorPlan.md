# SourceDAO 测试重构计划

这份计划基于当前仓库的主实现和现有 test 目录的静态审查结果，目标是把现有测试体系从“新旧路径混杂、覆盖失真、难以维护”重构为一套围绕当前 contracts 主实现的可运行、可扩展、可定位问题的测试系统。

## 1. 重构目标

测试重构的目标不是简单“补几条用例”，而是完成以下四件事：

1. 让测试集与当前主实现对齐
2. 让测试结果能够真实反映系统状态
3. 让关键治理和资产逻辑具备可回归验证能力
4. 让后续新增功能有明确的测试落点和组织方式

## 2. 当前问题归纳

现有测试问题可以分为四类：

### 2.1 历史遗留测试混入主测试目录

以下文件依赖已经不存在或已经脱离当前 contracts 主路径的合约/接口，不能再视为当前系统测试：

- test/dev.ts
- test/investment.ts
- test/fix_price_investment.ts
- test/marketing.ts
- test/multi_sig_wallet.ts
- test/two_step_investment.ts
- test/token.ts
- test/test_net.ts
- test/MyToken_test.sol

这些测试要么引用旧命名，如 SourceDaoToken、Investment、MarketingContract、MultiSigWallet，要么依赖链上地址或旧部署方式。

### 2.2 仍有参考价值但需要重写的测试

以下文件和当前主实现还有一定对应关系，但测试组织方式、初始化参数和断言范围已经不足：

- test/committee.ts
- test/upgrade.ts
- test/lockup.ts

### 2.3 关键模块存在测试空白

以下当前主模块缺少对应的现行测试：

- DividendContract
- Acquired
- Dao 注册与模块接线逻辑
- DevToken 和 NormalToken 的受限流转约束
- Project 的完整反向路径和边界条件

### 2.4 测试组织方式不稳定

当前部分测试存在以下结构性问题：

- 依赖 before 共享状态，导致用例顺序耦合
- 混用新旧 ethers/hardhat API 风格
- 部分测试更像脚本，不像单元或集成测试
- 缺少对 revert reason、事件、状态迁移和会计一致性的系统断言

## 3. 重构原则

### 3.1 以当前 contracts 目录为唯一主路径

重构后所有主测试必须围绕以下现行模块展开：

- Dao.sol
- Committee.sol
- Project.sol
- DevToken.sol
- NormalToken.sol
- TokenLockup.sol
- Dividend.sol
- Acquired.sol

### 3.2 先建立最小可信测试集，再扩展覆盖面

不要一开始就试图修好所有历史测试。先建立一套最小但可信的主路径测试，再决定哪些历史用例值得迁移。

### 3.3 每个测试文件只对应一个模块或一条业务主线

避免一个测试文件同时承担部署校验、治理校验、资产校验和集成脚本职责。

### 3.4 默认使用 fixture 隔离测试状态

优先用 loadFixture 建立可复用但隔离的初始状态，不再依赖 before 共享状态推进整组测试。

### 3.5 断言必须覆盖四类信息

每个关键测试至少关注其中两到四类：

- revert reason
- event
- state transition
- balance or accounting change

## 4. 测试目录重组建议

建议把测试重构成下面这种结构：

- test/core/
  - dao.ts
  - committee.ts
  - upgrade.ts
- test/project/
  - project.lifecycle.ts
  - project.edge-cases.ts
- test/token/
  - dev-token.ts
  - normal-token.ts
  - lockup.ts
  - dividend.ts
- test/asset/
  - acquired.ts
- test/integration/
  - project-release-flow.ts
  - governance-upgrade-flow.ts
- test/legacy/
  - dev.legacy.ts
  - investment.legacy.ts
  - marketing.legacy.ts
  - multi-sig-wallet.legacy.ts
  - token.legacy.ts
  - test-net.legacy.ts

如果短期内不想大改目录，至少也要先把 legacy 文件移出默认测试入口。

## 5. 文件分类计划

### 5.1 保留并重写

- test/committee.ts
- test/upgrade.ts
- test/lockup.ts

这三份文件建议保留主题，但按当前合约接口和 fixture 模式重写。

### 5.2 归档为 legacy

- test/dev.ts
- test/investment.ts
- test/fix_price_investment.ts
- test/marketing.ts
- test/multi_sig_wallet.ts
- test/two_step_investment.ts
- test/token.ts
- test/test_net.ts
- test/MyToken_test.sol

这些文件不建议继续直接维护成当前主测试。应该先迁到 legacy 目录，避免污染回归结果。

### 5.3 新建

- test/core/dao.ts
- test/token/dev-token.ts
- test/token/normal-token.ts
- test/token/dividend.ts
- test/asset/acquired.ts
- test/project/project.lifecycle.ts
- test/project/project.edge-cases.ts
- test/integration/project-release-flow.ts

## 6. 分阶段实施计划

### Phase 0: 环境修复

目标：先让测试具备最基本的可执行条件。

任务：

1. 确认本地依赖安装完整，保证 hardhat 使用本地版本
2. 增加可执行的测试脚本，例如 npm test 或 npx hardhat test
3. 明确哪些测试默认执行，哪些归档或跳过

验收标准：

- 能在本地跑出最小测试集
- 不再因为调用非本地 hardhat 直接失败

### Phase 1: 测试集去噪

目标：把当前测试集中的噪音先分离出去。

任务：

1. 将 legacy 测试迁移到单独目录
2. 从默认测试命令中排除链上脚本式测试
3. 删除或归档不存在合约对应的 Solidity 测试

验收标准：

- 默认测试目录只包含当前主实现相关文件
- 团队不再误以为旧测试代表当前覆盖率

### Phase 2: 建立最小可信主测试集

目标：覆盖当前系统最核心的业务闭环。

必须优先完成的模块：

1. Committee
2. Project
3. DevToken / NormalToken
4. TokenLockup
5. Upgrade

验收标准：

- 当前主治理和项目主流程都有可执行测试
- 任一核心模块出现明显回归时，测试会失败且定位清晰

### Phase 3: 补齐高风险未覆盖模块

目标：覆盖当前最危险的空白区。

优先模块：

1. Dividend
2. Acquired
3. Dao 模块接线与只允许设置一次的约束

验收标准：

- 所有核心现行合约至少有一组模块级测试
- 资产与收益路径不再处于完全无测试状态

### Phase 4: 增加集成场景和回归防护

目标：验证多模块联动，而不是只测孤立函数。

优先集成场景：

1. 项目从立项到验收到领取奖励
2. 正式版发布后锁仓释放与 devRatio 收敛
3. 升级提案通过后执行 upgradeTo

验收标准：

- 关键业务闭环至少各有一条完整集成用例
- 模块间接口变更能被集成测试及时发现

## 7. 每个核心模块建议补充的测试项

### 7.1 Dao

至少补这些：

- 各模块地址只能设置一次
- 各 getter 返回正确地址
- isDAOContract 只对白名单模块返回 true
- 未注册模块不能被视为 DAO 内部模块

### 7.2 Committee

至少补这些：

- 普通提案只能由 DAO 内部模块发起
- support 和 reject 参数不匹配时失败
- 非成员对普通治理结算不产生影响
- proposal 过期后状态正确
- setProposalExecuted 只能在 Accepted 且匹配调用方时执行
- prepareAddMember / removeMember / setCommittees 的完整两阶段流程
- prepareSetDevRatio 和 setDevRatio 的上下界限制
- 正式版发布后 devRatio 不可再修改
- fullPropose 的 threshold 生效
- endFullPropose 支持分批结算
- verifyContractUpgrade 在 proposal 通过与不通过时的两条路径
- cancelContractUpgrade 的边界行为

### 7.3 Project

至少补这些：

- budget 超过 DevToken 总量 2.5% 时拒绝
- version 不递增时拒绝
- createProject 后 proposalId 正确写入
- 提案通过后 Preparing -> Developing
- 提案拒绝或过期后 cancelProject 可执行
- 只有 manager 能 promote 和 accept
- Accepting -> Finished 时会 mint 对应奖励
- 不同 result 下 reward coefficient 正确
- latestProjectVersion 更新逻辑正确
- 结项间隔不足 7 天时拒绝
- extraTokens 在 reject 或低评级时返还逻辑正确
- withdrawContributions 不会重复领取
- 重复 contributor、零贡献和总贡献边界场景

### 7.4 DevToken

至少补这些：

- 非 project 不能 mintDevToken
- 非合法路径不能 transfer
- dev2normal 后 DevToken 减少且 NormalToken 增加
- totalReleased 计算正确

### 7.5 NormalToken

至少补这些：

- 只有 DevToken 可以 mintNormalToken
- 普通转账路径工作正常

### 7.6 TokenLockup

至少补这些：

- transferAndLock 和 convertAndLock 数组长度不匹配时拒绝
- release 开始前 claim 失败
- 目标版本发布后 claim 按线性规则放开
- 部分领取后剩余额度正确
- 解锁开始后不能继续锁仓
- totalAssigned 和 totalClaimed 的总账一致性
- 多地址混合锁仓与领取场景

### 7.7 Dividend

至少补这些：

- 不允许把 DAO 自己的两种 Token 作为分红充值资产
- deposit 和 receive 正确记录奖励
- updateTokenBalance 能识别直接转入的余额变化
- stakeNormal 和 stakeDev 正确更新份额
- unstakeNormal 和 unstakeDev 正确回退份额
- tryNewCycle 在周期边界时正确切换
- estimateDividends 返回值正确
- withdrawDividends 防止重复领取
- 原生币和 ERC20 分红路径都覆盖

### 7.8 Acquired

至少补这些：

- whitelist 和 firstPercent 长度校验
- totalPercents 上限校验
- 不能使用 DAO NormalToken 作为被收购资产
- ERC20 和原生币两条 startInvestment 路径
- 第一阶段额度限制
- 第二阶段放开后继续购买
- 非白名单无法参与
- 未到期且未卖完时不能提前结束
- 达到条件后 endInvestment 正确返还资产和 DAO Token
- end 后不能继续 invest

## 8. 推荐优先级

如果要按性价比排序，我建议这样做：

### 第一优先级

- Committee
- Project
- TokenLockup
- Upgrade

原因：这四块直接决定治理是否正确、项目是否能正确推进、锁仓是否安全释放、升级是否可控。

### 第二优先级

- DevToken
- NormalToken
- Dao

原因：这些是基础模块，复杂度相对低，但属于所有业务的底层依赖。

### 第三优先级

- Dividend
- Acquired

原因：这两块当前覆盖空白更大，但重构时可以在主路径稳定后单独推进。

## 9. 交付方式建议

建议不要一次性重写整个 test 目录，而是按下面方式逐步交付：

1. 先提交测试目录分层和 legacy 归档
2. 再补 Committee + Project + Lockup 三组新测试
3. 再补 Upgrade + Token 基础测试
4. 最后补 Dividend、Acquired 和集成测试

每一轮都应满足：

- 默认测试可以执行
- 新测试围绕当前主实现
- review 时可以明确看见新增覆盖面

## 10. 建议的下一步

如果继续推进，最合适的下一步是：

1. 先输出一份测试文件迁移清单，逐个标记 keep / rewrite / archive
2. 然后从 Committee、Project、Lockup 三组测试开始重写

这三组完成后，整个仓库的测试可信度会有明显提升。