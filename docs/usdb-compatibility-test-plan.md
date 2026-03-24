# SourceDAO 与 USDB 链能力对齐测试计划

## 1. 背景

当前 SourceDAO 的主测试体系主要建立在 Hardhat 之上：

- 编译入口见 [hardhat.config.ts](/home/bucky/work/SourceDAO/hardhat.config.ts)
- 测试入口见 [package.json](/home/bucky/work/SourceDAO/package.json)
- 主要测试目录为：
  - [test-hh3](/home/bucky/work/SourceDAO/test-hh3)
  - [test](/home/bucky/work/SourceDAO/test)

这套测试对“合约业务逻辑是否正确”非常有价值，但它本质上验证的是：

- 合约在一个功能较全的本地 EVM/Hardhat 环境中是否正确

而不是：

- 合约是否一定能在当前 USDB 链能力边界下部署和运行

这两者不能等价。

## 2. 问题定义

当前 SourceDAO 与 USDB 链能力之间的主要偏差有：

- Hardhat 测试默认是“能力更强的本地执行环境”，不等于 USDB 的真实执行层能力
- 当前配置没有显式固定 `evmVersion`
- 合约 artifact 可能随着编译器、依赖库升级，逐渐引入 USDB 当前不支持的能力
- 仅靠 Hardhat 通过，无法证明：
  - 在 USDB 链上可部署
  - 在 USDB 链上可初始化
  - 在 USDB 链上可稳定执行 bootstrap / dividend / fee split 相关路径

## 3. 当前 USDB 链能力基线

根据 [usdb-evm-capability-notes.md](/home/bucky/work/go-ethereum/docs/usdb/usdb-evm-capability-notes.md)，当前 USDB `v1` 的建议执行层目标是：

- `LondonBlock = 0`
- `ShanghaiBlock = 0`
- `CancunBlock = nil`

因此，对 SourceDAO 当前阶段更准确的兼容目标应定义为：

- **Shanghai-level compatibility**

而不是：

- latest Ethereum compatibility

## 4. 测试目标

后续测试体系需要同时回答三类问题：

1. 合约逻辑本身是否正确
2. 合约产物是否超出了 USDB 当前链能力
3. 合约是否真的能在 USDB geth 节点上完成部署、初始化和关键交互

因此测试体系不应只保留一条 Hardhat 主线，而应拆成分层结构。

## 5. 建议的测试分层

### 5.1 Layer A: Full Hardhat 逻辑测试

保留现有 Hardhat 主测试体系，用于验证：

- 业务逻辑
- upgrade 流程
- 状态机边界
- fuzz / invariant
- 集成行为

这一层的定位是：

- **逻辑正确性层**

这一层继续保留现有优势，不强行降级到 USDB 的能力边界。

### 5.2 Layer B: USDB capability-floor 编译与产物测试

新增一条专门面向 USDB 的兼容测试 lane，目标不是替代 Full Hardhat，而是保证：

- 编译产物没有超出 USDB 当前执行层能力

这一层建议固定：

- `solc = 0.8.20`
- `evmVersion = "shanghai"`

并对编译后的 runtime bytecode 做静态能力审计。

这层的定位是：

- **能力边界保护层**

### 5.3 Layer C: Real USDB geth 集成测试

增加一条面向真实 USDB geth 节点的最小集成测试。

这一层必须通过本地 USDB 链来验证：

- genesis 预置 code
- bootstrap 初始化
- Dao / Dividend 的真实链上交互
- 后续 fee split / activation block 机制

这层的定位是：

- **真实链兼容性准入层**

## 6. Layer B 的改进建议

### 6.1 显式固定 USDB 编译目标

在 [hardhat.config.ts](/home/bucky/work/SourceDAO/hardhat.config.ts) 中，新增一套面向 USDB 的编译配置。

建议目标：

- `evmVersion = "shanghai"`

并将其与现有默认编译目标区分开。

建议保留两套产物语义：

- 默认产物：继续服务现有 Hardhat/full 逻辑测试
- `USDB` 产物：专门用于链能力兼容检查

### 6.2 增加 bytecode 能力审计

编译成功并不代表产物一定适合 USDB 当前链能力。

建议新增一个 bytecode audit 脚本，对 runtime bytecode 进行静态检查，第一阶段明确禁止依赖以下能力：

- `TLOAD`
- `TSTORE`
- `MCOPY`
- `BLOBHASH`
- `BLOBBASEFEE`
- 任何明确属于 Cancun-only 的执行层痕迹

这一步的目标是尽早发现：

- 编译器升级
- 依赖库升级
- 某个新合约引入更高 fork 依赖

## 7. Layer C 的改进建议

### 7.1 不再只依赖 Hardhat localhost

Hardhat 本地节点不应再被视为 USDB 兼容性的最终验证目标。

建议增加一条新的测试入口，直接连接本地 USDB geth 节点。

### 7.2 第一阶段的最小 smoke

第一批 geth 集成测试不必覆盖所有业务流程，只需要覆盖当前对链集成最关键的路径：

- `Dao.initialize()`
- `Dividend.initialize(...)`
- `Dao.setTokenDividendAddress(...)`
- 向 `Dividend` 发送原生币

如果这条最小 smoke 无法通过，则说明：

- 当前 artifact
- 当前链配置
- 当前 bootstrap 设计

至少有一层仍未对齐。

### 7.3 与 go-ethereum 侧的关系

目前在 [usdb_dividend_bootstrap_test.go](/home/bucky/work/go-ethereum/core/usdb_dividend_bootstrap_test.go) 中，已经有一条基于真实 SourceDAO artifact 的 go 侧集成测试思路。

后续可以采用双轨方式：

- go-ethereum 侧保留链实现视角的 bootstrap 集成测试
- SourceDAO 侧补一条合约仓库视角的 geth 兼容测试入口

这样两边各自负责：

- 链实现是否可支撑
- 合约产物是否持续兼容

## 8. 推荐的准入规则

后续建议把 SourceDAO 的测试准入规则拆成三层：

- `Full Hardhat pass`
  - 表示合约业务逻辑正确
- `USDB capability-floor pass`
  - 表示当前 artifact 没越过 USDB 执行层边界
- `USDB geth integration pass`
  - 表示当前合约确实能在真实 USDB 链环境中运行

关键原则是：

- **Hardhat full pass != USDB 可部署**
- **USDB geth integration pass 才表示当前链兼容性真正成立**

## 9. 建议的实施顺序

### Phase 1

先做最小但收益最高的两件事：

- 给 Hardhat 增加 `USDB / Shanghai` 编译 profile
- 增加 bytecode capability audit

### Phase 2

增加最小 USDB geth smoke：

- 启本地 USDB 节点
- 部署或接入预置合约
- 完成 bootstrap
- 验证 `Dividend` 收款路径

当前已落地的 Phase 2 前两项是：

- `tools/config/usdb-local.json`
  - 本地 USDB smoke 所需的最小 manifest
  - 固定：
    - `chainId`
    - `rpcUrl`
    - `daoAddress`
    - `dividendAddress`
    - `bootstrapAdminPrivateKey`
    - `cycleMinLength`
    - `nativeDepositWei`
- `npm run test:usdb:smoke`
  - 通过 [scripts/usdb_bootstrap_smoke.ts](/home/bucky/work/SourceDAO/scripts/usdb_bootstrap_smoke.ts) 执行最小 geth smoke
  - 主要覆盖：
    - 检查 DAO / Dividend 地址上已有 code
    - `Dao.initialize()`
    - `Dividend.initialize(...)`
    - `Dao.setTokenDividendAddress(...)`
    - 向 `Dividend` 发送原生币
    - 读回 bootstrap 后的关键链上状态

说明：

- 这条 smoke 预期运行在**新鲜的本地 USDB 链**上
- 如果链已经做过 bootstrap，脚本会尽量按当前状态继续校验，但它的设计目标仍然是本地 bring-up 验证
- `go-ethereum` 侧现在已提供一条配套启动入口：
  - [run_local_bootstrap_smoke.sh](/home/bucky/work/go-ethereum/scripts/usdb/run_local_bootstrap_smoke.sh)
  - 它会自动：
    - 生成 bootstrap genesis
    - 启动单节点 USDB geth
    - 再调用 `npm run test:usdb:smoke`
  - 对于本地双节点简单组网，还可以使用：
    - [run_local_two_node_network.sh](/home/bucky/work/go-ethereum/scripts/usdb/run_local_two_node_network.sh)
    - 用同一份 bootstrap genesis 起两节点，并用 `admin_addPeer` 建立最小网络

### Phase 3

等 fee split 真正接入链执行层后，再扩到：

- 激活前/激活后行为
- 重启一致性
- 节点升级/链配置变化后的兼容性验证

## 10. 第一阶段建议落地项

建议先新增以下内容：

- `compile:usdb`
  - 专门编译 `Shanghai` 目标 artifact
- `test:usdb:audit`
  - 对 runtime bytecode 做能力扫描
- `test:usdb:smoke`
  - 连接本地 USDB geth 节点执行最小 bootstrap 测试

当前 Phase 1 已经落下来的入口是：

- `npm run build:usdb`
  - 使用 Hardhat `build profile: usdb`
  - 当前固定：
    - `solc = 0.8.20`
    - `evmVersion = "shanghai"`
  - 默认输出到：
    - `artifacts-usdb/`
    - `cache-usdb/`
- `npm run test:usdb:audit`
  - 对 `artifacts-usdb` 下的 runtime bytecode 做 opcode 级审计
  - 当前明确禁止：
    - `TLOAD`
    - `TSTORE`
    - `MCOPY`
    - `BLOBHASH`
    - `BLOBBASEFEE`
- `npm run test:usdb:compile-and-audit`
  - 串联执行上述两步

说明：

- 当前仓库使用 Hardhat `3.x`
- 在本地运行 `build:usdb` 需要 `Node 22+`
- 这属于当前 Hardhat 工具链前提，不是 USDB profile 额外引入的新限制

## 11. 结论

SourceDAO 当前不应再把 Hardhat 测试看作“对 USDB 的最终兼容证明”。

更合理的做法是：

- 保留 Full Hardhat 作为逻辑层
- 增加 Shanghai-level capability-floor 测试作为边界层
- 增加真实 USDB geth 集成测试作为最终准入层

这三层组合起来，才能把“合约逻辑正确”和“链能力兼容”真正区分开，并避免后续在：

- 编译器升级
- 依赖库升级
- SourceDAO 合约继续演进
- USDB 链功能接入

这些过程中逐步漂移而不自知。
