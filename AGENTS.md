# 当前公网近远端与 MCP 功能复现

本工作分支是 recovery/current-public-relay-mcp，基于已通过 660 秒公网自测的 recovery/current-public-relay-source@22f5614。不得修改或合并 main 或纯源码分支，除非用户明确要求。

连接 Skill、连接辅助程序与操作说明是必要交付物，保留于本分支。不要提交 node_modules、dist、运行包、私钥、连接块、日志或运行状态。讨论应用代码时指向 src/；恢复结果应标注为发布包重建，不冒称原始工程。

连接 Linux/Windows 时读取对应 .agents/skills/connect-*-public-ssh/SKILL.md。技能调用本仓库 src/near.cjs，不能偷偷使用其他目录的旧 bundle。先验证指纹与实际远端身份；云端自测不得冒充用户电脑连接成功。

目标是保留当前公网连接能力，复现稳定版 MCP 的 AI 工具、操作提示和工具链。范围见 docs/MCP-REPRODUCTION.md；未实现的工具不得写成已可用。排除局域网功能；重复或冲突功能须向用户请示。不得修改环境配置或擅自连接用户电脑。
