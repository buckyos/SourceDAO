# USDB 初始化工具与验收

工具使用已批准的 USDB DAO 公开配置。代币分配、委员会成员、项目里程碑和密钥托管方案，
需要在准备公开发布的候选网络前单独确定并冻结。部署与验收命令应在受控候选网络上运行，
使用经过审核的 SourceDAO 和 geth 版本。源链导入命令仅读取公开链，不使用签名账户。

## 从已有 DAO 导入测试网初始分配

`usdb_import_bootstrap_source.ts` 根据源链的固定区块生成一份新的候选配置和配套来源报告。
当前支持的口径是：**委员会使用该区块的成员列表，代币使用各自部署交易中的原始铸币分配**。
它不枚举当前持仓，也不迁移源链的资产、锁仓权益、分红记录或治理历史。

`tools/config/sourcedao-opmain-import-source.json` 固定源链 ID、主合约、7 个模块地址和两笔代币
部署交易。该组地址位于 **Optimism，chain ID 10**；不要使用 X Layer RPC。
工具会读取主合约绑定并逐项核对，不会直接信任配置里填写的模块地址。

```bash
node --import tsx scripts/usdb_import_bootstrap_source.ts \
  --source-rpc-url "$SOURCE_RPC_URL" \
  --source-config tools/config/sourcedao-opmain-import-source.json \
  --block 156576688 \
  --config ../usdb/docker/networks/testnet-v0/artifacts/sourcedao-bootstrap-config.json \
  --output /secure/candidate/sourcedao-bootstrap-config.json \
  --report /secure/candidate/sourcedao-bootstrap-source.json
```

`SOURCE_RPC_URL` 指向具备历史状态和交易回执查询能力的源链 RPC。`--block` 必须是明确的区块高度，
不接受 `latest` 或 `finalized` 标签。示例高度用于重现本次读取；重新获取委员会时，应选择并核对新的
稳定高度。工具在结束前复查检查点和两个部署区块的哈希，发生重组或历史数据不可用时直接失败。
固定高度本身不构成最终性证明，运营者仍需按源链规则选择检查点。

工具仅替换以下配置字段：

- `committee.initialMembers`：委员会成员的钱包地址，不是源链 Committee 合约地址。
- `devToken.totalSupply`、`devToken.initAddresses`、`devToken.initAmounts`：部署交易中原始铸币的
  总量和分配；代币代理自持部分记作储备，不把旧代理地址写入新链分配表。

USDB 的链 ID、初始化管理员、系统合约地址、代币名称、项目身份、治理倍率、业务计数器及分红周期
都从基础配置保留。原始 NormalToken 总量必须为 0；源链后续通过兑换产生的 BDT 不会导入。
金额全程使用整数最小单位，避免浮点数舍入。若初始分配或委员会成员使用合约钱包，工具会要求先定义
目标链地址映射，不会把源链合约地址直接复制过去。

当前实现要求代币代理在一笔直接 CREATE 交易中部署并初始化。它核对成功回执、初始化事件、全部原始
`Transfer(0x0, ...)` 事件，以及部署区块的总量、逐地址余额和储备。工厂部署、部署后另行初始化、
或部署区块内又发生余额变动的情况会报错，需要扩展对应的取证路径。

输出文件必须不存在，工具拒绝覆盖基础配置或已有导入结果。来源报告记录源配置、区块哈希/状态根、
部署交易、原始日志、合约调用、代码哈希与 ERC1967 实现地址，以及基础和输出配置的语义摘要。
这是一份可重复读取的 RPC 来源记录，不代表源合约通过当前 USDB golden 审核，也不能代替目标链部署后的
strict 验证和初始化验收。

本次已生成的候选配置为
[`usdb-testnet-v0.opmain-156576688.json`](../tools/config/imported/usdb-testnet-v0.opmain-156576688.json)，
来源报告为同目录的
[`usdb-testnet-v0.opmain-156576688.source.json`](../tools/config/imported/usdb-testnet-v0.opmain-156576688.source.json)。
结果是 5 名委员、10 个分配地址，DevToken 初始总量 21 亿；初始分配表与旧本地配置一致，委员会由 3 人
更新为 5 人。其余基础参数仍需按 USDB 独立 DAO 方案确定。候选文件没有替换已经发布的 bundle；
采用候选配置时，应通过 release 构建流程更新配置摘要和发布清单，不能单独修改已签名 node-kit 内的文件。
同一个部署恢复日志也不能中途更换配置。

## 构建与前置检查

使用 Node 24.12.0，执行 `npm ci` 和 `npm run test:usdb:fast`。检查内容包括合约测试、
Shanghai 目标构建、操作码扫描、合约审核基准（golden）比对，以及初始化工具回归测试。
golden 包含 8 个 SourceDAO 合约、ERC1967Proxy，以及实现合约中 immutable 变量的字节码偏移。
本次工具改进未改变 Solidity 合约的运行时代码。

公开 JSON 配置可以省略 `rpcUrl` 和 `artifactsDir`。RPC 地址的优先级依次为 `--rpc-url`、
`SOURCE_DAO_USDB_RPC_URL`、JSON 配置；构建产物默认从当前检出的仓库目录下的
`artifacts-usdb` 读取。工具会拒绝重复 JSON 字段和未知命令参数。

写入部署状态前，工具会检查链 ID、签名者、经过审核的构建产物、DAO/Dividend 预部署合约的
运行时代码，以及已有恢复日志中的创世区块和配置标识。每笔交易都会检查签名账户余额是否足以
支付其最大 gas 成本。签名账户不能存在与本次初始化无关的待确认交易。

配置中的初始化管理员账户必须有足够资金，候选网络必须保持隔离，并且必须在网络的费用分配
激活高度之前完成 `Dividend.finalizeBootstrap()`。逐笔 gas 检查无法保证整个初始化流程都能
在剩余区块窗口和资金预算内完成；操作前仍需核对这两项预算。

## 执行与恢复

```bash
node --import tsx scripts/usdb_bootstrap_full.ts \
  --config /secure/release/sourcedao-bootstrap-config.json \
  --rpc-url http://127.0.0.1:8545 \
  --state-file /secure/release/sourcedao-bootstrap-state.json
```

通过运维环境的密钥注入机制设置 `SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY`。`--state-file` 为必填参数。
以下文件需要配套保存：

- `sourcedao-bootstrap-state.json`：公开交易证据和最终模块绑定关系。
- `sourcedao-bootstrap-state.json.transactions.json`：恢复日志，记录已签名交易字节、固定 nonce、
  预期 CREATE 地址和主链回执标识。该文件不包含私钥，但其中的已签名交易可以被重新广播，
  应按运维恢复文件妥善保管。
- 本次使用的、经过审核的公开配置和合约 golden 原件。

写入使用独占锁、原子替换，以及文件和目录的 fsync。已签名交易会在**广播之前**持久化。
重试同一条命令时，工具会恢复相同的交易哈希和 nonce，并复用已完成的实现合约及代理部署。
交易回执响应丢失或进程重启不会丢失成功交易的证据。

对于已经完成的状态文件，重复执行会保持其字节内容完全不变，避免使已通过验收的状态文件摘要失效。

强制终止进程可能遗留 `<state-file>.lock`。检查其中的 PID，确认写入进程已停止后，才可移除
该锁文件；不要删除状态文件或交易恢复日志。发现未知的 nonce 替换、配置/创世区块/签名者变化，
或已确认交易回执发生重组时，工具会报错并停止恢复。此时需要核对候选网络状态和原交易记录，
不能通过换一个状态文件名绕过检查。对于已经初始化但缺少恢复日志的旧部署，工具会拒绝接管，
不会自行推断其部署历史。

## 固定并验证检查点

```bash
node --import tsx scripts/usdb_validate_bootstrap.ts \
  --config /secure/release/sourcedao-bootstrap-config.json \
  --rpc-url http://127.0.0.1:8545 \
  --state-file /secure/release/sourcedao-bootstrap-state.json \
  --strict --output /secure/release/validation.json
```

验证器会在读取合约前确定一个区块。v2 证据包含该区块的高度、哈希和状态根，以及创世区块哈希、
公开配置语义摘要、golden 摘要、代码哈希、存储槽值和合约调用结果。所有读取均使用这个高度，
完成后再次检查该区块是否仍在主链上。

严格检查覆盖每个 DevToken 初始持有者的余额、合约自持储备和代币精度，委员会配置，模块反向
DAO 绑定，Project/Acquired 计数器，锁仓状态，以及初始化完成标记。比对 UUPS 运行时代码时，
只对经过审核的、保存实现合约自身地址的 immutable 位置填入实际地址。

默认的 `latest` 只在开始时选定一次检查点，不会将后续区块状态混入报告。
记录 `H = evidence.checkpoint.number`，等待发布方案规定的非零确认深度后，再创建验收文件。
在重启后的节点或新加入节点上重现报告时，添加 `--block H`。节点必须能够读取该高度的历史状态；
遇到历史状态已被剪枝的错误，工具不会改为读取最新状态。宽松验证模式用于后续运维检查，
不能用于创建初始化验收文件。

## 创建验收文件与独立重放

```bash
geth usdb-bootstrap-acceptance create \
  --rpc-url http://127.0.0.1:8545 \
  --genesis /secure/release/genesis.json \
  --bootstrap-config /secure/release/sourcedao-bootstrap-config.json \
  --bootstrap-state /secure/release/sourcedao-bootstrap-state.json \
  --validation /secure/release/validation.json \
  --contract-golden /path/to/reviewed/SourceDAO/security/usdb-contract-golden.json \
  --checkpoint-block "$H" --min-confirmations "$CONFIRMATIONS" \
  --artifact /secure/release/acceptance.json
```

`CONFIRMATIONS` 由发布方案确定，本次工具改进不为其指定新的默认值。
省略 `--checkpoint-block` 时，使用验证报告中的检查点。`verify` 使用相同的输入文件、RPC 地址和
`--contract-golden`，并读取指定的验收文件；区块高度和确认深度以验收文件中固定的值为准。

Go 命令行工具会独立比对已部署代码与**本地经过审核的 golden**，检查 ERC1967 实现地址和
UUPS 自身地址 immutable，重放报告记录的全部合约调用及存储读取，并核对精确的初始化交易历史
以及检查点是否仍在主链上。

golden 的受信版本必须来自发布审核流程，不能采信未经信任的 RPC 响应所提供的版本。
其摘要会写入 `uip-0010-bootstrap-acceptance:v2`。旧版 v1 仅记录地址和版本的验收文件需要
重新生成，不能只修改版本标签。验收文件随后通过现有发布流程纳入签名的公开发布清单。

## 回归测试覆盖与适用范围

`npm run test:usdb:tools` 使用临时的本机回环地址 Hardhat 链，覆盖：

- 初始化、实现合约部署、代理部署、模块绑定、最终确认这 5 个交易广播后的进程中断点。
- 22 笔交易的幂等执行，以及连接错误链时对原状态文件的保护。
- 初始分配变化、历史状态重放和错误运行时代码。
- 广播前持久化、未知交易替换和已确认回执重组。
- 源链导入：在发生 DevToken 到 NormalToken 的兑换之后仍恢复原始分配，保留目标 DAO 参数，
  并拒绝错误源链、模块/部署交易不匹配、历史状态不可用、读取期间重组及覆盖既有导入文件。

操作码测试覆盖两种构建产物格式、PUSH 指令数据、CBOR 元数据、无效字节码，以及生产合约
运行时代码缺失的情况。

Go 验收测试覆盖旧版或缺失证据、配置/golden/检查点绑定、RPC 重放结果被篡改，以及历史状态
不可用的情况。配套 geth 双节点生命周期测试要求两个测试节点都保留 archive 历史状态，
每次重启或新节点加入后的验证都固定在已接受的区块上；测试幂等重跑时同时复制状态文件和恢复日志。

这些测试用于验证工具和验收流程。Committee 或 Project 的独立治理问题、USDB 经济参数确定，
以及公开网络激活仍需分别处理。隔离环境中的 fake-PoW 演练也不能作为真实矿工性能的验收依据。
