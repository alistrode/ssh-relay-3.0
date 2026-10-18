# 配对式公网 SSH 增强预览版

本版保留 MQTT WSS＋SSH，协议 2；不需要服务账号、付费服务、自建服务器或局域网功能。应用代码在 `src/paired-agent.cjs`、`src/pairing.cjs`、`src/paired-store.cjs`、`src/desktop/`，复用 `src/relay.cjs` 和 `src/remote.cjs`。这是新实现的增强功能，不冒称找回的原始工程。

## 使用

完整解压 `paired-windows-x64.zip` 或 `paired-linux-x64.tar.gz` 到新目录，不覆盖或停止旧连接。Windows 双击 SSH-Relay-Near.lnk / SSH-Relay-Far.lnk；Linux 双击相应无扩展名原生 ELF。近端和远端均可在各自托盘打开面板。

包内有官方 Node 22 首次启动运行时，无需另装 Node/npm。首次启动会在应用目录下载 Electron 44.8.0（Windows 约 152 MiB，Linux 约 118 MiB），优先官方 GitHub、连接失败后使用镜像，按固定的官方 SHA-256 验证后解压。组件自带 Node 24.22.0。下载错误只记录于应用目录 `.runtime-setup-status.json`；重开启动入口重试，不修改系统代理、路由、CA 或全局环境。准备完成后的正常启动不再下载。这个包不是完全离线包。

远端点击生成配对码，近端输入完整的一次性码并配对。码有 128 位随机性，显示为 8 组四位十六进制字符，十分钟过期；不是六位数字密码。配对交换使用认证加密，配对成功后保存可信主机指纹，实际 SSH 执行 whoami/hostname 后才显示已连接。配对码授予访问权限，只交给可信近端。

近端记住多台电脑，选择并连接后保存默认目标；下次启动自动连接。每个远端最多 16 个独立配对链路，避免不同近端互相触发实例重置。远端的多个链路当前共用该远端的 SSH 客户端授权密钥，依靠各自独立且私密的中继会话隔离接入；不声称已经实现按单个近端撤销 SSH 公钥。近端“移除本地记忆”只清理本地；远端“撤销全部配对”停止开发远端的旧链路并轮换身份，所有近端需重新配对。

关闭面板保留托盘；托盘退出会停止本实例的监管和连接。近端可暂停自动连接；网络/中继故障以指数退避和抖动自动恢复，等待最多 60 秒。短暂恢复不会立即清零退避，持续稳定 60 秒后才重置，避免反复崩溃或抖动时高频重启。身份或授权校验失败停止盲目重试并提示；普通网络错误不要求重新配对。已有 shell 断线后不会透明续接，业务操作不会自动重放。

## 自启动与私密状态

两端可切换“用户登录后自动启动”，保存后核对操作系统实际注册结果。Windows 启动项按角色和状态目录独立命名；Linux 使用应用专属 XDG autostart 项，不修改其他应用。开启后下次登录静默进入托盘。它不是登录前运行的系统服务；未实际重启电脑不能宣称通过真正的开机验收。Linux 桌面必须支持系统托盘，未在无桌面的云端冒称托盘实测通过。

默认私密目录为用户目录下 `.ssh-relay-paired/near` 或 `far`。Linux 目录 0700、文件 0600；Windows 只限制本应用的私密目录 ACL 到当前账户和 SYSTEM，不改父目录或全局权限。状态原子写入，重启保留授权。不要把状态、连接报告、配对码或原始日志加入 Git 或交付包。

日志：管理目录中的 `near-manager-events.jsonl` / `far-manager-events.jsonl`，以及远端 `far/far-events.jsonl`，桌面层 `desktop-near-events.jsonl` / `desktop-far-events.jsonl`。桌面异常、后台进程退出和自启动切换同样落盘。每份 2 MiB，3 份备份；界面可打开本地诊断目录。只记录连接元数据，不记录命令、文件内容、配对码、私钥或 token。公共 broker 没有服务可用性保证，日志和一小时实测不能产生 SLA。

## 开发与 MCP

开发用 `npm ci --ignore-scripts`，然后 `npm run paired:near` / `npm run paired:far`；明确隔离实例时传 `--state-dir`。桌面开发需准备 Electron（依赖下载保留正常代理和 TLS 校验），再运行 `npm run desktop:near` 或 `desktop:far`。`--control-file` 仅用于私密验收，不在 GUI 中开放。同一状态目录只能有一个管理实例，回环锁冲突时拒绝启动，不终止其他进程。

近端实际验证身份后生成私密 `connection-private.json`，可供现有 `src/mcp.cjs --connection ...` 使用。进程重启时监听端口可能变化，MCP 读取最新 runtime.json；客户端还须遵守先核对任务结果、再决定下一步的规则。37 个原有工具及其业务依赖范围仍以 MCP-MANUAL.md 和 MCP-VALIDATION.md 为准，本版没有补做数据库业务或系统计划任务验收。

便携增强包交付近远端连接程序和桌面界面；完整 MCP 服务及其依赖清单在仓库或 `source.zip` 中，由 AI 近端按 MCP-MANUAL.md 准备项目依赖。远端使用者运行便携包不需要安装 Node 或 npm。不要在只有便携连接程序的目录里假称已经启动完整 MCP 服务。

## 验收

`npm run test:pairing` 检查认证加密、错误码/篡改/过期拒绝及私密保存；`tests/paired-lifecycle.cjs` 经真实公共 WSS 验证多配对、进程恢复和撤销；`tests/paired-proxy-fault.cjs` 仅切断自身测试近端经原正常代理路径的连接，验证中继断线自动恢复；`tests/paired-soak.cjs` 用实际固定 SSH 身份、长连接和文件往返进行至少 3600 秒验收。这些测试辅助程序不属于应用 `src/`。

最终是否通过以独立验收结果文件为准；中断、旧版本和短时通过不能冒充最终一小时通过。Windows、云端自测、Linux 桌面及真实开机验证分别报告。

`tests/paired-flapping.cjs` 实际连续终止四次本测试远端工作进程，检查短暂 ready 后仍保留指数退避，避免崩溃循环永远每两秒重启。MCP 配对报告回归另行记录实际工具发现和命令/文件往返，不把工具可列出等同于全部业务验证完成。
