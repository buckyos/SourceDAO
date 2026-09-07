# USDB 初始化工具与验收

工具使用已批准的 USDB DAO 公开配置。代币分配、委员会成员、项目里程碑和密钥托管方案，
需要在准备公开发布的候选网络前单独确定并冻结。部署与验收命令应在受控候选网络上运行，
使用经过审核的 SourceDAO 和 geth 版本。源链导入命令仅读取公开链，不使用签名账户。

## 默认工作流与目录

在 SourceDAO 仓库使用 Node 24.12.0。默认目标网络为 `usdb-testnet-v0`；其他网络通过
`--network <名称>` 或一次设置 `SOURCE_DAO_NETWORK` 选择。该名称必须与 bundle 身份一致，
工具不会根据 RPC 返回结果自动切换网络。内置路径相对于工具仓库或安装目录解析，与当前工作目录无关；
显式传入的相对路径仍相对于当前工作目录。

```bash
npm run import:bootstrap:source
npm run prepare:bootstrap
# 编辑 security/candidate/usdb-testnet-v0/sourcedao-bootstrap-final.json 并完成参数审核
npm run freeze:bootstrap
```

对应目录：

```text
security/
├── usdb-contract-golden.json
├── sources/optimism/
│   ├── sourcedao-opmain-import-source.json
│   └── imports/156576688/
│       ├── sourcedao-bootstrap-imported.json
│       └── sourcedao-bootstrap-source.json
├── candidate/usdb-testnet-v0/
│   ├── sourcedao-bootstrap-final.json
│   ├── sourcedao-bootstrap-inputs.json
│   └── frozen-network-bundle/
└── public/<chainId>/<genesisHash>/<configDigest>/
    ├── sourcedao-bootstrap-public-state.json
    └── sourcedao-bootstrap-validation.json
```

以上都是公开文件，可由 Git 管理。原始 state 与交易 journal 默认保存在仓库外的
`~/.usdb/sourcedao-bootstrap/<chainId>/<genesisHash>/<configDigest>/`，不随 Git 或镜像发布。
准备和冻结只处理本地文件；只有 `bootstrap` 需要私钥并发送交易。

## 导入共享源链数据

默认源配置为
[`security/sources/optimism/sourcedao-opmain-import-source.json`](../security/sources/optimism/sourcedao-opmain-import-source.json)。
原 `tools/config/sourcedao-opmain-import-source.json` 保留为指向它的符号链接，避免维护两份源配置。
其中固定公共 `rpcUrl`、源链 ID、DAO/模块地址、原始部署交易，以及 `blockNumber` 和 `blockHash`。
RPC 优先级为 `--source-rpc-url`、`SOURCE_DAO_SOURCE_RPC_URL`、源配置；带认证信息的端点通过环境变量
或 CLI 提供，不写进公开配置。RPC 地址不会进入导入报告或来源身份摘要。

```bash
npm run import:bootstrap:source
# 特殊目录：两个输出文件使用固定文件名
npm run import:bootstrap:source -- --output-dir /path/to/new-source-import
```

默认输出到源配置所在目录的 `imports/<blockNumber>`。完整且与固定源身份、检查点和摘要相符的
已有结果会原样复用，并明确提示没有进行新的 RPC 审计；文件缺失、内容被改动或身份不符时失败。
需要重新读取同一检查点时，指定新的 `--output-dir`。更换高度必须同时更新区块哈希；CLI 覆盖高度时，
必须配套 `--block-hash`，不接受 `latest` 或 `finalized` 标签。

新导入结果使用 `sourcedao-bootstrap-import:v1`，只包含源链检查点、委员会成员和原始 DevToken 分配，
不包含目标链 ID、初始化管理员、系统合约地址、代币名称或治理参数。来源报告使用
`sourcedao-bootstrap-source:v2`，记录源身份、区块哈希/状态根、部署交易、原始日志、历史合约调用、
代码哈希与 ERC1967 实现地址，并固定导入结果摘要。同一份结果可供测试网和正式网分别使用。

委员会读取指定检查点的成员钱包；token 读取最初部署交易的铸币分配，不复制当前持仓。
源代理自持部分记录为储备，不把旧代理地址写进新链分配表。原始 NormalToken 总量必须为 0，
后续兑换产生的 BDT 不导入。金额使用整数最小单位；委员会或分配地址属于合约钱包时，需要另外定义
目标链地址映射，当前工具直接拒绝自动复制。

取证要求代币代理在一笔直接 CREATE 交易中部署并初始化，核对初始化事件、全部原始 mint、部署区块
总量/余额/储备，并在结束前复查检查点及部署区块哈希。工厂部署、另行初始化、同块余额变动、
历史状态不可用或读取期间重组均失败。固定高度和来源报告不代替源链最终性判断或目标链 golden 验收。

仓库中的 `imports/156576688` 从此前保存的 OP 取证报告转换而来，保留原始观察记录，未重新查询 RPC：
5 名委员、10 个初始分配地址、DevToken 原始总量 21 亿。旧的
`tools/config/imported/usdb-testnet-v0.opmain-156576688.*.json` 保留作历史证据，不再作为默认输入。
显式 `--config --output --report` 的旧调用仍支持，但输出带目标网络参数，不能作为跨网络共享配置。

## 生成候选、审核与冻结

`npm run prepare:bootstrap` 等价于 USDB 的 `freeze_sourcedao_bootstrap.py --prepare`。
默认基础 bundle 是相邻 USDB 仓库的 `docker/networks/testnet-v0`，其他目标默认使用
`docker/networks/<network>`；自定义位置用 `--bundle-dir`。目标目录可通过 `--input-dir` 指定。

prepare 将共享导入结果的四个字段应用到网络模板：`committee.initialMembers`、
`devToken.totalSupply`、`devToken.initAddresses`、`devToken.initAmounts`。其余字段保留网络模板值。
首次生成 final 和 `sourcedao-bootstrap-inputs.json`，后者用相对路径和文件摘要固定来源，并绑定
基础网络的 chain ID、genesis 和配置摘要。需要更换源链导入结果时，用新 `--input-dir` 准备候选；
工具拒绝覆盖已编辑的 final。更新公共源配置的检查点不会改变已有候选的来源。

```bash
# 可选：将某次共享导入应用到指定网络候选目录
npm run prepare:bootstrap -- --source-dir /path/to/source-import --input-dir /path/to/candidate
# 修改该目录的 sourcedao-bootstrap-final.json 后冻结
npm run freeze:bootstrap -- --input-dir /path/to/candidate
```

freeze 默认读取上述 final 和来源引用，golden 使用 `security/usdb-contract-golden.json`，输出到
候选目录下的 `frozen-network-bundle`。也可用 `--input-dir` 对接放有 final/imported/source 三个
固定文件名的旧式候选目录。显式 `--config`、`--imported-config`、`--source-report`、
`--contract-golden`、`--output-dir` 保留；两份显式来源文件必须成对指定。

工具核对导入结果与报告一致，记录相对导入结果的全部手工调整，拒绝重复 JSON 字段、运行时字段、
无效分配，以及与 genesis 不一致的链 ID、管理员或系统地址。输出固定最终配置、来源、golden 和
`artifacts/sourcedao-bootstrap-freeze.json`，同步更新 genesis manifest 与 network.json 中的摘要，
并验证完整 bundle。golden 默认路径固定，其内容仍随经过审核的合约版本更新。

冻结目录必须不存在，不能覆盖既有冻结结果。审核后执行 `npm run freeze:bootstrap -- --apply`，
将同一候选的公开文件晋升到基础 bundle 的 Git 工作区，再审核、提交、打 tag 并走既有 release 流程。
`--apply` 保留同级 `.sourcedao-freeze-backup-*` 回滚副本，最后替换 network.json；普通写入异常会恢复
原文件，进程被强杀时按 `rollback.json` 核对恢复。不要对已安装 node-kit 使用 `--apply`。

正式部署只依赖已发布的冻结 bundle，不再导入 OP 或修改 final。本流程不自动签名、推送或安装 release，
也不会改变现有链的 genesis。node-kit 仅复制声明过的公开文件，不打包原始 state、journal 或日志。

## 构建与前置检查

使用 Node 24.12.0，执行 `npm ci` 和 `npm run test:usdb:fast`。检查内容包括合约测试、
Shanghai 目标构建、操作码扫描、合约审核基准（golden）比对，以及初始化工具回归测试。
golden 包含 8 个 SourceDAO 合约、ERC1967Proxy，以及实现合约中 immutable 变量的字节码偏移。
本次工具改进未改变 Solidity 合约的运行时代码。

冻结的公开 JSON 配置不得包含 `rpcUrl`、`artifactsDir`、`outputPath` 或私钥。
开发用 `--config` 模式保留原有运行时字段支持。RPC 地址的优先级依次为 `--rpc-url`、
`SOURCE_DAO_USDB_RPC_URL`、开发 JSON 配置、`http://127.0.0.1:8545`；构建产物默认从工具仓库目录下的
`artifacts-usdb` 读取。工具会拒绝重复 JSON 字段和未知命令参数。

写入部署状态前，工具会检查链 ID、签名者、经过审核的构建产物、DAO/Dividend 预部署合约的
运行时代码，以及已有恢复日志中的创世区块和配置标识。每笔交易都会检查签名账户余额是否足以
支付其最大 gas 成本。签名账户不能存在与本次初始化无关的待确认交易。

配置中的初始化管理员账户必须有足够资金，候选网络必须保持隔离，并且必须在网络的费用分配
激活高度之前完成 `Dividend.finalizeBootstrap()`。逐笔 gas 检查无法保证整个初始化流程都能
在剩余区块窗口和资金预算内完成；操作前仍需核对这两项预算。

## 执行与恢复

开发环境不指定路径时使用选定网络的 `security/candidate/<network>/frozen-network-bundle`。
安装环境一次设置 `SOURCE_DAO_RELEASE_DIR` 指向已验证的当前 node-kit 根目录，工具使用其
`docker/networks/<network>`；也可通过 `SOURCE_DAO_BUNDLE_DIR` 固定到某一 bundle。
CLI `--bundle-dir` 优先，显式开发 `--config` 模式保留。没有冻结记录或摘要不符时直接失败，不回退到示例配置。
实际 RPC 的 chain ID、genesis 和工具 golden 必须与 bundle 一致；摘要核对不代替安装阶段的发布来源验证。

```bash
# 安装环境仅需配置一次；使用开发目录中的冻结 bundle 时省略
export SOURCE_DAO_RELEASE_DIR=/path/to/installed/node-kit
# 通过受保护环境注入 SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY 或 SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY_FILE
npm run bootstrap:full
npm run export:bootstrap:state
npm run validate:bootstrap
```

默认私有 state 使用链 ID、genesis 和配置摘要组成的目录；变更 RPC URL 不会产生新的恢复目录。
`SOURCE_DAO_BOOTSTRAP_PRIVATE_DIR` 可覆盖私有存储根，`SOURCE_DAO_BOOTSTRAP_PUBLIC_DIR` 可覆盖公开存储根。
`--state-file` 和原有 `SOURCE_DAO_USDB_STATE_FILE` 仍支持，迁移已有部署时应显式指向原 state，
不能通过切换目录绕过恢复日志检查。私钥环境变量与私钥文件来源不能同时设置。

可无 RPC、无私钥查看后续验收所需的实际文件位置：

```bash
node --import tsx scripts/usdb_bootstrap_tools.ts paths
```

以下文件需要配套保存：

- `state.json`：私有恢复状态，包含交易证据、模块绑定、RPC URL 和本地诊断信息。
- `state.json.transactions.json`：恢复日志，记录已签名交易字节、固定 nonce、
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

## 工具镜像

SourceDAO 仓库提供独立构建目标，镜像包含工具、依赖、USDB 合约构建产物与经过校验的 golden，
不包含网络参数、私钥或部署状态：

```bash
docker build -f Dockerfile.usdb-tools -t sourcedao-bootstrap-tools:candidate .
```

构建过程执行 USDB 构建、opcode audit、golden 对照和工具类型检查。正式运维时使用发布流程记录的
镜像 digest，不使用可变的 `latest` 标签。本次提供构建目标，没有自动上传镜像或改变现有 CI 的发布权限。
`TOOLS_IMAGE`、`BUNDLE_DIR` 和 `PRIVATE_DIR` 由该次运维环境指定，两个目录使用绝对路径：

```bash
docker run --rm --network host --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$BUNDLE_DIR,dst=/release,readonly" \
  --mount "type=bind,src=$PRIVATE_DIR,dst=/private" \
  --mount "type=bind,src=$KEY_FILE,dst=/run/secrets/bootstrap-key,readonly" \
  -e SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY_FILE=/run/secrets/bootstrap-key \
  "$TOOLS_IMAGE" bootstrap
```

在受控运维机通过 SSH tunnel 使用 loopback RPC 时，以上 Linux host 网络模式可复用该 tunnel。
镜像默认 bundle 为 `/release`，私有根为 `/private`，公开根为 `/public`，RPC 为 localhost。
导出和验证时另挂载持久公开目录到 `/public`。网络为正式网时需设置对应 `SOURCE_DAO_NETWORK`。
镜像另有 `paths`、`export-state`、`validate` 和 `import-source` 子命令；通过 `<子命令> --help` 查看参数。
导出时保留私有目录的写权限以创建独占锁，并另挂载公开输出目录；导出及验证不需要挂载私钥。
`prepare`/`freeze` 用于维护者的相邻 SourceDAO/USDB checkout，不在运行时镜像中执行。镜像内重新导入源链时，
通过 `--output-dir` 指向另行挂载的输出目录。

## 导出公开部署记录

部署完成后，先导出公开记录，再执行严格验证和 acceptance：

```bash
npm run export:bootstrap:state
```

默认从私有目录导出到同一链身份下的公开目录，路径可由 `paths` 查询。导出工具不需要私钥或 RPC。它在私有 state 的独占锁下核对全部已完成操作、日志中的签名者/链 ID、
交易哈希和连续 nonce，再按字段白名单生成 `sourcedao-bootstrap-public-state:v1` 记录。
公开记录只包含链/配置/golden 身份、系统与模块地址、已完成操作的名称、交易哈希及高度。
RPC URL、路径、任意错误文本、附加运行信息和已签名交易字节均不导出。

相同输入重复导出保持相同字节；已有输出内容不同则失败。原私有 state 和 journal 不被修改。
公开记录只能用于验证，bootstrap 会拒绝把它当作恢复 state。

| 文件 | 管理方式 |
| --- | --- |
| 最终配置、导入来源、冻结记录、golden | 公开 Git 与 release |
| 原始 state、`.transactions.json`、运行日志 | 私有目录及备份 |
| 导出的公开 state、strict validation、acceptance | 完成验收后随 release 发布 |
| 管理员私钥 | 独立密钥管理，不进入 Git、镜像或恢复记录 |

## 固定并验证检查点

```bash
npm run validate:bootstrap
```

验证器会在读取合约前确定一个区块。v2 证据包含该区块的高度、哈希和状态根，以及创世区块哈希、
公开配置语义摘要、golden 摘要、代码哈希、存储槽值和合约调用结果。所有读取均使用这个高度，
完成后再次检查该区块是否仍在主链上。
验证报告不再记录 RPC URL 或构建产物的本地路径，可与公开 state 配套用于发布验收。

严格检查覆盖每个 DevToken 初始持有者的余额、合约自持储备和代币精度，委员会配置，模块反向
DAO 绑定，Project/Acquired 计数器，锁仓状态，以及初始化完成标记。比对 UUPS 运行时代码时，
只对经过审核的、保存实现合约自身地址的 immutable 位置填入实际地址。

bundle 模式默认启用 strict，并使用导出的公开 state。首次默认输出不存在时，在开始选定一次 `latest` 检查点；
默认报告已存在时复用其检查点，重新验证且保留相同字节，不随链增长覆盖报告。要生成其他检查点的报告，
显式指定 `--block H --output /path/to/new-validation.json`。显式输出保留原有覆盖语义，勿指向已发布的验收原件。
记录 `H = evidence.checkpoint.number`，等待发布方案规定的非零确认深度后，再创建验收文件。
在重启后的节点或新加入节点上重现报告时，添加 `--block H`。节点必须能够读取该高度的历史状态；
遇到历史状态已被剪枝的错误，工具不会改为读取最新状态。显式开发 `--config` 的宽松验证模式用于后续运维检查，
不能用于创建初始化验收文件。

## 创建验收文件与独立重放

从 `paths` 输出取得 bundle/config/genesis/golden/publicState/validation 的实际路径，设置下例的
`BUNDLE_DIR`、`PUBLIC_STATE` 和 `VALIDATION`。geth 验收命令继续要求明确的确认深度和产物位置。

```bash
geth usdb-bootstrap-acceptance create \
  --rpc-url http://127.0.0.1:8545 \
  --genesis "$BUNDLE_DIR/artifacts/usdb-genesis.json" \
  --bootstrap-config "$BUNDLE_DIR/artifacts/sourcedao-bootstrap-config.json" \
  --bootstrap-state "$PUBLIC_STATE" \
  --validation "$VALIDATION" \
  --contract-golden "$BUNDLE_DIR/artifacts/sourcedao-contract-golden.json" \
  --checkpoint-block "$H" --min-confirmations "$CONFIRMATIONS" \
  --artifact /secure/bootstrap-public/acceptance.json
```

`CONFIRMATIONS` 由发布方案确定，本次工具改进不为其指定新的默认值。
省略 `--checkpoint-block` 时，使用验证报告中的检查点。`verify` 使用相同的输入文件、RPC 地址和
`--contract-golden`，并读取指定的验收文件；区块高度和确认深度以验收文件中固定的值为准。

Go 命令行工具会独立比对已部署代码与**本地经过审核的 golden**，检查 ERC1967 实现地址和
UUPS 自身地址 immutable，重放报告记录的全部合约调用及存储读取，并核对精确的初始化交易历史
以及检查点是否仍在主链上。
公开 state 的未知字段会被拒绝，其 ceremony 身份必须与配置和验证证据一致。acceptance 绑定的是
**导出后公开 state 的精确文件摘要**；发布后不得再删改、格式化该文件。私有原件继续独立用于恢复。

golden 的受信版本必须来自发布审核流程，不能采信未经信任的 RPC 响应所提供的版本。
其摘要会写入 `uip-0010-bootstrap-acceptance:v2`。旧版 v1 仅记录地址和版本的验收文件需要
重新生成，不能只修改版本标签。验收文件随后通过现有发布流程纳入签名的公开发布清单。

## 回归测试覆盖与适用范围

`npm run test:usdb:tools` 使用临时的本机回环地址 Hardhat 链，覆盖：

- 初始化、实现合约部署、代理部署、模块绑定、最终确认这 5 个交易广播后的进程中断点。
- 22 笔交易的幂等执行，以及连接错误链时对原状态文件的保护。
- 初始分配变化、历史状态重放和错误运行时代码。
- 广播前持久化、未知交易替换和已确认回执重组。
- 从冻结 bundle 以默认路径执行、密钥文件注入、公开记录脱敏及幂等导出、私有日志恢复、公开记录历史验证。
- 跨工作目录调用、错误网络拒绝、私有目录按链身份隔离、默认验证报告的检查点和字节保持不变。
- 源链导入：在发生 DevToken 到 NormalToken 的兑换之后仍恢复原始分配，保留目标 DAO 参数，
  并拒绝错误源链、模块/部署交易不匹配、错误固定区块哈希、历史状态不可用、读取期间重组及改动既有导入。
- 共享结果跨目标网络复用；Python 验证 prepare/freeze 的固定文件名、来源/基础配置摘要、手工修改保留和回滚。

操作码测试覆盖两种构建产物格式、PUSH 指令数据、CBOR 元数据、无效字节码，以及生产合约
运行时代码缺失的情况。

Go 验收测试覆盖旧版或缺失证据、配置/golden/检查点绑定、RPC 重放结果被篡改，以及历史状态
不可用的情况。配套 geth 双节点生命周期测试要求两个测试节点都保留 archive 历史状态，
每次重启或新节点加入后的验证都固定在已接受的区块上；测试幂等重跑时同时复制状态文件和恢复日志。

这些测试用于验证工具和验收流程。Committee 或 Project 的独立治理问题、USDB 经济参数确定，
以及公开网络激活仍需分别处理。隔离环境中的 fake-PoW 演练也不能作为真实矿工性能的验收依据。
