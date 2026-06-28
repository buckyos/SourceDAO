# Deprecated SourceDAO Scripts

这个目录保存 SourceDAO 历史部署/升级脚本，仅用于追溯早期链上操作方式和硬编码地址来源。不要把这里的脚本作为当前生产、测试网或本地开发入口直接运行。

这些脚本被移出 `scripts/` 根目录，是为了降低误用概率。当前支持入口以根目录 `scripts/README.md` 和 `package.json` 中的 npm scripts 为准。

## Replacement Map

| Deprecated script | Replacement |
| --- | --- |
| `deploy_all.ts` | 当前本地完整部署使用 `deploy_frontend_local.ts`；USDB 冷启动使用 `usdb_bootstrap_full.ts`；既有链升级使用 `upgrade_existing_sourcedao.ts`。 |
| `deploy_all_as_sourcedao.ts` | USDB 内置地址冷启动使用 `usdb_bootstrap_full.ts`；已完成 bootstrap 的复检使用 `usdb_validate_bootstrap.ts`；OP 等既有链模块升级使用 `upgrade_existing_sourcedao.ts`。 |
| `update_committee.ts` | 使用 `upgrade_existing_sourcedao.ts`，`target.module=committee`。 |
| `update_dev.ts` | 旧 Project/Dev 相关升级参考。当前按实际目标模块使用 `upgrade_existing_sourcedao.ts` 的 `project` 或 `devToken` target。 |
| `update_invsement.ts` | 旧 Investment 命名参考。当前模块已是 `Acquired`，使用 `upgrade_existing_sourcedao.ts` 的 `acquired` target。 |

如果确实需要恢复某个历史流程，不要直接修改这里的脚本后运行。应新建参数化脚本或扩展当前支持入口，并至少补齐：

- 配置文件读取，不硬编码生产地址。
- chain ID、code、version、DAO wiring 和接口 smoke 校验。
- 对升级流程输出 implementation、proposal id、proposal params 和 calldata hash。
- fork 或测试链演练记录。
