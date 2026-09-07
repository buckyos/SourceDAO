# USDB 测试网 SourceDAO 候选

`sourcedao-bootstrap-final.json` 是工具首次生成的**待审核草稿**，尚未冻结或应用到 release。
它复用 OP 检查点 156576688 的 5 名委员与原始 token 分配，其他字段保留现有测试网模板。
独立 DAO 的名称、项目身份、治理参数、周期和管理员安排仍需审核确定。

只编辑 final；`sourcedao-bootstrap-inputs.json` 固定来源文件及基础 bundle 身份。
来源更新或基础配置变化时，使用新的 `--input-dir` 准备候选，保留本目录的历史记录。
审核后运行 `npm run freeze:bootstrap` 生成本目录下的 `frozen-network-bundle`，
再按 [工具操作说明](../../../docs/usdb-bootstrap-tools.md) 晋升和发布。

该目录只保存公开输入。部署私钥、原始 state 和交易 journal 应保存在仓库外。
