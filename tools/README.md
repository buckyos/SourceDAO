# Tools

辅助脚本统一放在 `tools/` 目录下。

当前包含：

- `vote.ts`：交互式投票脚本，面向当前 `SourceDAO` 治理流程
- `vote_offline.ts`：离线签名投票辅助脚本，提供 `prepare / sign / broadcast` 三步流程
- `vote.config.example.json`：工具配置文件示例，供 `vote.ts` / `vote_offline.ts` 复用

根目录的 `vote.ts` 仍然保留为兼容入口；后续新增工具应优先放在 `tools/` 下，并在需要时由根目录保留薄兼容入口。
