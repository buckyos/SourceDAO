# Project / Version 管理指南

这份文档面向网页使用者，介绍 SourceDAO 中 `Project` 和 `Version` 的含义、常见流程，以及在页面上操作时需要注意的条件。

更底层的合约接口和状态机说明，可参考：
- [ContractInterfaces.md](./ContractInterfaces.md)
- [Architecture.md](./Architecture.md)

## 1. 两层结构：Project Profile 与 Version

当前系统里的项目管理分成两层：

### Project Profile

这是项目的顶层资料，主要用于展示和组织版本历史。  
它由 backend 管理，典型字段包括：

- 项目名称
- GitHub 链接
- 项目描述
- owner / updated by / updated at

网页上的 `/projects` 列表页和项目详情页顶部看到的就是这一层。

### Version

这是链上的治理和结算单元。  
每个 version 都会带有：

- `project name`
- `version`
- `budget`
- `start / end date`
- `manager`
- `proposal id`
- `state`

一个项目可以有多个 version。  
Version 的创建、投票、结算和奖励提取都依赖链上合约。

## 2. 谁可以做什么

### 创建空 Project Profile

网页入口：`/projects` -> `Create project`

要求：
- 已登录 backend
- 已绑定钱包

创建后会得到一个空的项目资料页，后续 version 在项目详情页内部继续创建。

### 修改 Project Profile

网页入口：项目详情页顶部 `Edit profile`

允许的角色：
- 该 project profile 的 owner
- committee 成员

当前第一阶段只允许修改：
- GitHub URL
- Description

项目名称暂不在网页上开放修改，避免影响兼容中的 `project_id / name` 关联关系。

### 创建 Version

网页入口：项目详情页 -> `create version`

要求：
- 已登录 backend
- 已连接钱包
- 使用发起该 version 的 manager 钱包

创建 version 后，会自动在链上生成一条对应的 proposal。  
这时 version 还没有正式进入开发，必须等待 proposal 通过。

### 创建 Settlement Proposal

网页入口：Version 详情页 -> `Create settlement proposal`

要求：
- 当前 version 状态已经进入 `Developing`
- 当前连接的钱包必须是该 version 的 `manager`
- 至少提交 1 个 contributor
- contributor 地址必须唯一
- contribution value 必须大于 0

这一步提交后，会自动生成结算 proposal，等待 committee 投票。

### 提取贡献奖励

网页入口：Version 结算页中的 `withdraw`

要求：
- settlement proposal 已通过并执行
- version 已正式进入 `Finished`
- 当前地址在贡献列表中且尚未领取

## 3. 网页上的典型流程

### 流程 A：创建一个新项目并发起首个版本

1. 在 `/projects` 创建空的 project profile
2. 进入项目详情页
3. 点击 `create version`
4. 填写版本号、预算、时间范围、issue link、描述
5. 使用 manager 钱包发起链上交易
6. 等待 committee 对该 version proposal 投票
7. proposal 通过后，version 进入 `Developing`

### 流程 B：项目开发完成后发起结算

1. 打开对应 version 详情页
2. 确认 version state 已经是 `Developing`
3. 使用 manager 钱包点击 `Create settlement proposal`
4. 填写验收评级和 contributor points
5. 等待 committee 对 settlement proposal 投票
6. proposal 通过并执行后，version 进入结算完成状态
7. contributor 再分别执行 `withdraw`

## 4. 常见注意事项

### 1. 创建 Version 不等于立即进入开发

`create version` 只是在链上创建 version 并生成 proposal。  
proposal 通过前，version 仍处于待治理状态。

### 2. 只有 manager 钱包才能发起 settlement proposal

哪怕你已经登录了同一个 GitHub 账号，如果当前浏览器连接的钱包不是 version 的 manager，链上也会拒绝。

### 3. settlement proposal 不是任何时候都能发起

只有 version 已经进入 `Developing` 才允许发起。  
如果 version 还在 `Waiting vote`，说明初始化 proposal 还没通过。

### 4. contributor 列表必须干净

当前合约会拒绝这些情况：
- 空 contributor 列表
- 重复地址
- 贡献值 `<= 0`
- 零地址

### 5. Project Profile 和 Version 是两层数据

修改 project profile 的描述或 GitHub 链接，不会改变已经创建好的链上 version。  
同样，创建 version 也不会自动替换顶层 profile 描述。

## 5. 页面上如何判断当前能不能继续

### 在项目列表 / 项目详情页

- 看 `Owner / Updated by / Updated`
- 看自己是否有 `Edit profile` 按钮

### 在 version 列表 / version 详情页

- 看 `manager`
- 看 `version state`
- 看是否已经存在 settlement proposal

## 6. 遇到问题先检查什么

如果网页操作失败，优先检查：

1. 当前是否真的处于登录状态
2. 当前连接的钱包是否是目标 version 的 manager
3. 当前 version state 是否已经允许下一步
4. MetaMask 当前网络是否是本地 Hardhat 或目标链
5. proposal / version 是否已经存在，避免重复发起

对于本地开发环境，还可以结合：
- [LocalFullStackDev.md](./LocalFullStackDev.md)
- [VoteGuide.md](./VoteGuide.md)

