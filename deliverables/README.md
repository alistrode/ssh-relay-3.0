# 最小可用包与源码

- **near-far-minimal.zip**：近远端最小运行包，解压后 Windows 双击 START-REMOTE.cmd；Linux 执行 sh START-REMOTE.sh。需要已有 Node.js 22+，无需 npm 安装。含连接 Skill 和辅助程序；不含 Node 本体、不含 MCP 服务依赖、不含任何私钥或连接块。
- **source.zip**：对应完整工程源码，包含 MCP、提示词、Profiles、连接 Skill、说明和验证辅助代码。解压后 npm ci --ignore-scripts，按根 README 和 docs/MCP-MANUAL.md 启动。
- **SHA256SUMS**：两个文件的 SHA-256 校验值。

应用代码基于已通过 660 秒公网验收的 4853832；运行包为构建产物，不冒称原始源码。两端都更新并确认协议 2，才能启用这次稳定性修复。首次启动会在本地生成私密 data/，不要上传。只更新工作分支，不向 main 推送。

重新生成：在源码工程安装依赖后执行 python3 scripts/package-minimal.py。
