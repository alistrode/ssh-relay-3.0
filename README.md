# 当前公网近远端与 MCP

私有工作分支 `recovery/current-public-relay-mcp`，主分支与纯源码分支未改。保留当前 MQTT 公网连接，复现稳定版 MCP SSH Manager 的全部 37 个工具，补齐提示词、连接 Skill 和操作说明；不引入局域网功能。

## 运行

需要 Node.js 22+。完整仓库根目录：

```sh
npm ci --ignore-scripts
npm start
```

Windows 也可使用 `START-REMOTE.cmd`。远端保持运行，将打印的完整私密连接块交给可信 AI，按 [Windows Skill](.agents/skills/connect-win10-public-ssh/SKILL.md) 或 [Linux Skill](.agents/skills/connect-linux-public-ssh/SKILL.md) 导入。连接块、data/ 和私钥不可上传。

导入得到已核验的私密 connection.json 后，在近端启动 MCP：

```sh
node /absolute/repo/src/mcp.cjs --connection /private/connection.json \
  --name remote --state-dir /private/mcp-state
```

默认提供全部 37 个工具、5 个 prompts 和手册资源，使用 stdio，不自动改客户端配置。多目标、工具选择和客户端配置示例见 [完整操作手册](docs/MCP-MANUAL.md) 与 examples/。

## 功能

命令执行、双向文件传输和同步、持久会话、日志、监控、服务和进程操作、备份还原与计划、三种数据库、部署、提权执行、别名、Profiles、Hooks、分组批量、连接管理、固定指纹、历史及回环端口转发。各平台依赖与行为差异必须按 [功能清单](docs/MCP-REPRODUCTION.md) 和手册判断，不能从工具名称推断可用权限。

远程命令继承远端进程权限，Windows 管理员启动可传递提升令牌，不能突破所有系统文件保护。详见 [权限说明](docs/PERMISSIONS.md)。当前远端新增 SFTP 属性修复、进程树终止和回环转发；旧远端仍可提供原有命令/SFTP，但新增能力需停止旧实例后启动新版。

## 来源与验证

源代码来源见 [来源清单](docs/MCP-SOURCE-PROVENANCE.json)，稳定版辅助模块按 MIT 许可保留。当前实现和旧连接层分别处理，不将重建或新适配代码冒称原始工程。

验证结果与明确限制见 [验证说明](docs/MCP-VALIDATION.md)。`npm run build` 只生成被忽略的派生 dist/，不提交运行包、依赖目录、测试状态或凭据。
