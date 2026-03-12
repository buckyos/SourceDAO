# SourceDAO 核心合约接口说明

这份文档面向开发者阅读，按当前主实现梳理各核心合约的职责、关键外部接口、典型调用方和常见调用顺序。

建议先阅读 Architecture.md，再阅读本文。

## 1. 总览

当前主实现可分为四层：

- 主控层：Dao.sol，SourceDaoUpgradeable.sol
- 治理层：Committee.sol
- 生产层：Project.sol
- 资产层：DevToken.sol，NormalToken.sol，TokenLockup.sol，Dividend.sol，Acquired.sol

接口定义主要集中在 contracts/Interface.sol。

## 2. Dao.sol

### 职责

Dao.sol 是全系统的模块注册表。它本身不负责具体业务，而是作为其他模块查找彼此地址的统一入口。

### 关键外部接口

- initialize()
  - 初始化主合约。
  - 当前实现不带参数。

- setDevTokenAddress(address)
- setNormalTokenAddress(address)
- setCommitteeAddress(address)
- setProjectAddress(address)
- setTokenLockupAddress(address)
- setTokenDividendAddress(address)
- setAcquiredAddress(address)
  - 用于注册各模块地址。
  - 所有地址都只能设置一次。

- devToken()
- normalToken()
- committee()
- project()
- lockup()
- dividend()
- acquired()
  - 返回各模块实例。

- isDAOContract(address)
  - 判断某个地址是否为 DAO 内部模块。
  - 治理模块依赖这个接口限制只有内部模块才能发起某些提案。

### 典型调用方

- 部署脚本
- 其他主模块
- 链下读取脚本

### 开发注意点

- 这是一个只注册一次的总线，不是可随意替换地址的控制台。
- 模块初始化顺序会影响后续模块间调用是否可用。

## 3. SourceDaoUpgradeable.sol

### 职责

这是所有主模块共享的升级基类，负责保存主合约地址，并把 UUPS 升级授权接到委员会治理上。

### 关键接口与行为

- setMainContractAddress(address)
  - 主合约地址只允许设置一次。

- version()
  - 返回当前实现版本。

- 升级授权逻辑
  - 内部会调用委员会的 verifyContractUpgrade(newImplementation)。
  - 也就是升级不由 owner 或单点管理员决定，而由治理结果决定。

### 典型调用方

- 各 UUPS 代理合约本身
- 委员会升级提案流程

## 4. Committee.sol

### 职责

Committee.sol 是治理核心，负责：

- 普通提案
- 全员提案
- 委员会成员变更
- DevToken 权重调整
- 合约升级提案

### 提案相关接口

- propose(duration, params)
  - 发起普通提案。
  - 只能由 DAO 内部模块调用。
  - 典型调用者是 Project.sol。

- fullPropose(duration, params, threshold)
  - 发起全员提案。
  - 也是内部模块调用。
  - 适合需要全体 Token 持有人参与的治理动作。

- support(proposalId, params)
- reject(proposalId, params)
  - 对提案投票。
  - 会校验参数 Merkle 根是否一致。

- settleProposal(proposalId)
  - 主动结算普通提案。

- takeResult(proposalId, params)
  - 读取提案结果，同时在必要时触发结算。
  - 业务合约在执行提案结果时通常走这个入口。

- proposalOf(proposalId)
- proposalExtraOf(proposalId)
  - 查询提案基础信息和全员提案扩展信息。

- setProposalExecuted(proposalId)
  - 在业务动作已经执行完毕后，把提案标记为 Executed。

### 全员提案结算接口

- endFullPropose(proposalId, voters)
  - 用于分批结算全员提案。
  - 由于全员投票可能涉及很多地址，当前设计允许分多次把 voter 列表提交进来累计结算。

### 委员会管理接口

- prepareAddMember(address)
- addCommitteeMember(address, proposalId)
- prepareRemoveMember(address)
- removeCommitteeMember(address, proposalId)
- prepareSetCommittees(address[], isFullProposal)
- setCommittees(address[], proposalId)
  - 这些接口全部遵循先提案、后执行的两阶段模式。

### 参数权重接口

- prepareSetDevRatio(newDevRatio)
- setDevRatio(newDevRatio, proposalId)
  - 调整 DevToken 在全员投票中的权重。
  - 正式版发布后不能再调整。

### 升级治理接口

- prepareContractUpgrade(proxy, newImplementation)
  - 发起某个代理合约的升级提案。

- verifyContractUpgrade(newImplementation)
  - 被代理合约在执行升级时调用。
  - 只有匹配的升级提案被通过后，才返回 true。

- cancelContractUpgrade(proxy)
- getContractUpgradeProposal(proxy)
  - 用于取消或查询升级提案。

### 典型调用顺序

普通提案：

1. 业务合约调用 propose。
2. 成员调用 support 或 reject。
3. 业务合约调用 takeResult。
4. 如果结果为 Accept，业务合约执行动作。
5. 业务合约调用 setProposalExecuted。

全员提案：

1. 业务合约调用 fullPropose。
2. 持有人调用 support 或 reject。
3. 截止后分批调用 endFullPropose。
4. 提案最终变为 Accept、Reject 或 Expired。

### 开发注意点

- 参数校验依赖 Merkle 根，执行动作时必须传入与提案一致的参数数组。
- setProposalExecuted 不只是状态美化，它是防止已通过提案被重复利用的重要步骤。

## 5. Project.sol

### 职责

Project.sol 负责把一个开源项目从立项推进到结项，并把结项奖励按贡献比例发放给参与者。

### 核心状态

- Preparing：等待立项提案
- Developing：开发中
- Accepting：等待验收提案
- Finished：已完成
- Rejected：失败或被拒绝

### 关键外部接口

- createProject(budget, name, version, startDate, endDate, extraTokens, extraTokenAmounts)
  - 创建项目。
  - 自动生成立项提案。
  - 预算受 DevToken 总量上限约束。

- cancelProject(projectId)
  - 当对应提案失败或过期时取消项目。
  - 如果项目附带了额外 Token，会退回给项目经理。

- promoteProject(projectId)
  - 在提案通过后推进项目状态。
  - Preparing 进入 Developing。
  - Accepting 进入 Finished，并执行奖励结算逻辑。

- acceptProject(projectId, result, contributions)
  - 由项目经理提交项目结果与贡献列表。
  - 自动发起验收提案。

- updateContribute(projectId, contribution)
  - 在验收投票阶段修改或补充贡献值。

- withdrawContributions(projectIds)
  - 贡献者提取其在已完成项目中的奖励。
  - 同时处理额外 Token 的分配。

- projectOf(projectId)
- projectDetailOf(projectId)
- contributionOf(projectId, who)
- latestProjectVersion(projectName)
- versionReleasedTime(projectName, version)
  - 提供项目状态、贡献、版本发布信息查询。

### 典型调用顺序

1. 项目经理调用 createProject。
2. 委员会对立项提案投票。
3. 项目经理调用 promoteProject，把项目推进到 Developing。
4. 项目经理调用 acceptProject，提交结果和贡献列表。
5. 委员会对验收提案投票。
6. 项目经理再次调用 promoteProject，触发奖励发放逻辑。
7. 贡献者调用 withdrawContributions 领取奖励。

### 开发注意点

- 项目创建和项目验收都不是一步完成，而是两次提案驱动的状态机。
- latestProjectVersion 和 versionReleasedTime 不只是查询接口，还被锁仓和治理逻辑引用。

## 6. DevToken.sol

### 职责

DevToken 是贡献权益 Token，不是自由流通 Token。

### 关键外部接口

- initialize(name, symbol, totalSupply, initAddress, initAmount, mainAddr)
  - 初始化总量和预分配。

- mintDevToken(amount)
  - 只能由 Project.sol 调用。
  - 本质上是从合约自身库存把奖励拨给项目模块。

- dev2normal(amount)
  - 把 DevToken 1:1 转换为 NormalToken。

- totalReleased()
  - 返回已释放总量。

### 特殊行为

- 转账逻辑被限制在少数合法路径上。
- 合法路径包括项目奖励、锁仓转换、分红质押等。

### 开发注意点

- 不要把 DevToken 按普通 ERC20 理解。
- 它更像一种受制度约束的贡献权益凭证。

## 7. NormalToken.sol

### 职责

NormalToken 是可流通 Token，用于转账、交易、投票计权和被收购。

### 关键外部接口

- initialize(name, symbol, mainAddr)
- mintNormalToken(to, amount)
  - 只能由 DevToken.sol 调用。

### 开发注意点

- 当前 NormalToken 的增发入口只来自 DevToken 转换。
- 这保证流通权益的来源仍然受贡献权益约束。

## 8. TokenLockup.sol

### 职责

TokenLockup.sol 用于处理前期投资、资本合作或特殊分配所需的锁仓逻辑。

### 关键外部接口

- initialize(unlockProjectName, unlockVersion, mainAddr)
  - 设置锁仓释放所绑定的项目名与版本号。

- transferAndLock(to[], amount[])
  - 直接转入 NormalToken 并锁定给一组地址。

- convertAndLock(to[], amount[])
  - 先把 DevToken 转为 NormalToken，再锁定给一组地址。

- claimTokens(amount)
  - 当目标版本正式发布后，按 6 个月线性释放规则提取已解锁额度。

- getCanClaimTokens()
- totalAssigned(owner)
- totalClaimed(owner)
  - 查询可领取额度、累计分配和累计领取。

### 开发注意点

- 一旦解锁开始，就不再适合继续接收新的锁仓批次。
- 解锁不是提案手动逐笔发放，而是绑定目标版本发布时间自动生效。

## 9. Dividend.sol

### 职责

Dividend.sol 是收益池与质押池，允许外部收益注入，再按各周期质押份额分配给参与者。

### 关键外部接口

- initialize(cycleMinLength, mainAddr)
  - 设置最短分红周期长度。

- deposit(amount, token)
- receive()
- updateTokenBalance(token)
  - 向分红池注入外部资产。
  - 支持原生代币和非 DAO Token 的 ERC20。

- stakeNormal(amount)
- stakeDev(amount)
- unstakeNormal(amount)
- unstakeDev(amount)
  - 质押和解除质押两类 Token。

- tryNewCycle()
  - 手动推动进入新周期。

- getCurrentCycleIndex()
- getCurrentCycle()
- getCycleInfos(start, end)
- getTotalStaked(cycleIndex)
- getDepositTokenBalance(token)
- getStakeAmount(cycleIndex)
  - 查询周期和质押信息。

- isDividendWithdrawed(cycleIndex, token)
- estimateDividends(cycleIndexes, tokens)
- withdrawDividends(cycleIndexes, tokens)
  - 估算并提取某些周期中的分红。

### 开发注意点

- 当前设计明确禁止把 DAO 自己的两类 Token作为分红池充值资产。
- 质押份额是按周期快照思路计算，而不是实时按块结算。

## 10. Acquired.sol

### 职责

Acquired.sol 提供一种外部资产收购 NormalToken 的机制，支持白名单和两阶段额度控制。

### 关键外部接口

- initialize(initInvestmentCount, mainAddr)

- startInvestment(param)
  - 发起一笔收购。
  - 可使用原生币或 ERC20 作为支付资产。
  - 支持白名单与第一阶段额度比例。

- invest(investmentId, amount)
  - 白名单地址按照规则用 NormalToken 购买外部资产。

- endInvestment(investmentId)
  - 发起人结束收购，拿回已收到的 NormalToken 和剩余未售资产。

- getInvestmentInfo(investmentId)
- isInWhiteList(investmentId, addr)
- getAddressPercent(investmentId, addr)
- getAddressInvestedAmount(investmentId, addr)
- getAddressLeftAmount(investmentId, addr)
  - 查询收购信息、白名单配额和个人可用额度。

### 开发注意点

- 这个模块的资产方向和项目奖励方向不同，它更接近二级分配和外部资产换入机制。
- 收购目标是 NormalToken，而不是 DevToken。

## 11. 常见跨合约调用路径

### 项目立项与结项

- Project.sol 调用 Committee.sol 发起提案。
- Committee.sol 给出结果。
- Project.sol 推进状态并调用 DevToken.sol 发放奖励。

### DevToken 转流通 Token

- 用户持有 DevToken。
- 用户调用 dev2normal。
- DevToken.sol 销毁自身额度。
- NormalToken.sol 铸造对应数量的流通 Token。

### 锁仓释放

- 某个版本正式发布。
- TokenLockup.sol 通过 Project.sol 的 versionReleasedTime 判断释放是否开始。
- 用户调用 claimTokens 按线性进度领取。

### 合约升级

- 委员会成员发起升级提案。
- 委员会投票通过后，代理合约在升级时调用 verifyContractUpgrade。
- 验证通过才允许完成升级。

## 12. 阅读顺序建议

如果目标是读懂接口和调用关系，建议按下面顺序继续看代码：

1. contracts/Interface.sol
2. contracts/Dao.sol
3. contracts/Committee.sol
4. contracts/Project.sol
5. contracts/DevToken.sol
6. contracts/NormalToken.sol
7. contracts/TokenLockup.sol
8. contracts/Dividend.sol
9. contracts/Acquired.sol

如果后续还要补文档，最自然的下一步是给每个合约补一张状态机图或权限矩阵。