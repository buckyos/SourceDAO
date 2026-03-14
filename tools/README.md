# Tools

辅助脚本统一放在 `tools/` 目录下。

当前包含：

- `vote.ts`：交互式投票脚本，面向当前 `SourceDAO` 治理流程
- `vote_offline.ts`：离线签名投票辅助脚本，提供 `prepare / sign / broadcast` 三步流程
- `dao_status.ts`：读取 `SourceDao` 和各模块的只读状态
- `committee_status.ts`：读取当前委员会治理参数、成员和可选观察地址的投票资格
- `project_status.ts`：读取项目生命周期、关联提案、贡献列表和可选观察地址的贡献状态
- `proposal_status.ts`：读取单个 ordinary/full proposal 的只读状态
- `config/profiles/opmain.json`：共享部署配置示例
- `config/local.example.json`：本地操作者配置示例

根目录的 `vote.ts` 仍然保留为兼容入口；后续新增工具应优先放在 `tools/` 下，并在需要时由根目录保留薄兼容入口。
