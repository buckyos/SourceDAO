# Vote Guide

## 目的

这份文档是面向 proposal 页面用户的简洁投票引导。

如果你只想知道：

- 什么时候可以直接在网页上投票
- 什么时候应该使用本地 `Vote Tool`
- 什么时候应该走离线签名

先看这份文档即可。

更完整的脚本说明见：

- [VoteTool.md](VoteTool.md)
- [VoteOffline.md](VoteOffline.md)

## 先判断用哪种方式

### 1. 网页上已经出现 `Support / Reject`

优先使用网页投票。

适合场景：

- 当前 proposal 类型已经被网页端支持
- 你使用的是浏览器热钱包
- 你只需要正常完成一次链上投票

网页投票前，请确认：

- 当前连接的是正确网络
- 当前钱包地址是你预期要投票的地址
- 提案标题、描述、参数摘要都与你的预期一致

### 2. 网页没有投票按钮，或者按钮是灰色

这时先判断原因：

- 你没有投票资格
- 当前 proposal 类型网页端还没支持
- proposal metadata 不完整，网页端主动禁用了投票

如果你确认自己有资格，只是网页端没有覆盖这种 proposal 类型，请使用：

- [VoteTool.md](VoteTool.md)

### 3. 你不希望在联网机器上直接使用私钥

请使用离线签名流程：

- [VoteOffline.md](VoteOffline.md)

## 投票前的最小检查清单

无论你用网页、命令行还是离线签名，都建议先检查：

1. proposal id 是否正确
2. 网络是否正确
3. DAO 地址是否正确
4. 当前钱包地址是否正确
5. proposal 的关键参数是否与预期一致
6. 当前 proposal 仍处于可投票状态

## 网页投票

网页投票是最简单的路径：

1. 打开 proposal 详情页
2. 检查 proposal 要点
3. 点击 `Support` 或 `Reject`
4. 在确认弹框中再次核对提案关键信息
5. 钱包确认交易
6. 等待链上确认

网页投票的限制：

- 不是所有 proposal 类型都已经支持
- 如果 proposal 只有链上状态、缺少 backend metadata，网页端会禁用投票
- 如果当前钱包没有投票资格，按钮会直接不可用

## 命令行投票

当网页端不适合时，使用：

```bash
npx hardhat run tools/vote.ts --network opmain
```

命令行工具适合：

- 网页端还没覆盖的 proposal 类型
- 需要更明确地检查 proposal 参数
- 需要把投票流程纳入运维操作

详细配置和限制说明见：

- [VoteTool.md](VoteTool.md)

## 离线签名投票

当你需要冷钱包/隔离环境时，使用三步流程：

1. 在线机器 `prepare`
2. 离线机器 `sign`
3. 在线机器 `broadcast`

入口见：

```bash
npx hardhat run tools/vote_offline.ts --network opmain
```

详细流程见：

- [VoteOffline.md](VoteOffline.md)

## 常见建议

### proposal 页面上有网页投票按钮，还需要看文档吗？

一般不需要。

文档主要在以下情况有用：

- 你想确认投票资格和边界
- 你想改用 CLI
- 你想使用冷钱包/离线签名

### 网页投票失败了怎么办？

先看错误是否属于以下几类：

- 网络不正确
- 钱包地址不正确
- 已经投过票
- 当前地址没有票权
- proposal 参数与链上 root 不一致

如果网页端无法继续处理，建议切换到：

- [VoteTool.md](VoteTool.md)

### 为什么 proposal 页面还保留 `How to vote?`

因为网页投票只覆盖一部分场景。

治理操作仍然需要保留：

- CLI 投票
- 离线签名
- 更详细的参数核对流程
