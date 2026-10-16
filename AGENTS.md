# 当前公网近远端与 MCP 功能复现

本工作分支是 recovery/current-public-relay-mcp，基于已通过 660 秒公网自测的 recovery/current-public-relay-source@22f5614。不得修改或合并 main 或纯源码分支，除非用户明确要求。

连接 Skill、连接辅助程序与操作说明是必要交付物，保留于本分支。不要提交 node_modules、dist、运行包、私钥、连接块、日志或运行状态。讨论应用代码时指向 src/；恢复结果应标注为发布包重建，不冒称原始工程。

连接 Linux/Windows 时读取对应 .agents/skills/connect-*-public-ssh/SKILL.md。技能调用本仓库 src/near.cjs，不能偷偷使用其他目录的旧 bundle。先验证指纹与实际远端身份；云端自测不得冒充用户电脑连接成功。

配对式增强版保留当前 MQTT WSS＋SSH，不要求账号、付费或自建服务器。用户提供一次性配对码时，按对应连接 Skill 的增强版流程启动 src/paired-agent.cjs，读取实际核验后的私密 connection-private.json；不要把配对码当旧打印块解析。每次配对有独立中继会话，调试不争用现有会话。登录自启不能冒称登录前系统服务，源码实现和实际桌面/开机验收必须区分。原始日志、配对码及运行状态仍不提交。

目标是保留当前公网连接能力，复现稳定版 MCP 的 AI 工具、操作提示和工具链。范围见 docs/MCP-REPRODUCTION.md；未实现的工具不得写成已可用。排除局域网功能；重复或冲突功能须向用户请示。不得修改环境配置或擅自连接用户电脑。

稳定性修复与证据见 docs/MCP-STABILITY-RESULTS.json、docs/MCP-VALIDATION.md。历史单轮通过不能代替新验收；环境中断或不完整记录不算通过。两端均更新并协商 relayProtocol=2 才具备接收端 ACK/重传能力，不能把协议 1 兼容连接说成已修复。near-events.jsonl / far-events.jsonl 仅留私密运行目录，不提交；元数据按 cid/seq 对照，PUBACK 不是接收端交付凭证。

用户最新明确要求交付最小可用包：允许 deliverables/ 下提交脱敏运行 ZIP、源码 ZIP 和校验文件。此例外不允许提交 data/、私钥、连接块、原始日志、node_modules 或散装 dist/。

当前已授权连接断开时，必须执行对应连接 Skill 的“强制重连纪律”：先自行实际重连三次，失败后按 2、4、8、16、30、60 秒指数退避继续恢复，不因普通超时索要密码、新连接块或用户确认。复用已保存身份并严格验证目标；仅重连与只读核验，不重放用户有副作用的操作。
