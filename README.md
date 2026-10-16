# 当前公网近远端：MCP 功能复现工作分支

分支：`recovery/current-public-relay-mcp`。以 `22f5614` 的五个近远端应用模块为基础，保留必要的连接 Skill、辅助程序与说明。主分支和纯源码分支保持不变。

## 当前可用

- 远端命令、非 PTY shell、基础 SFTP、公网中继及固定 SSH 主机指纹。
- Linux / Windows 连接 Skill，接收完整 SSH_RELAY_CONNECT 连接块、检查指纹并验证实际远端身份。
- 本分支尚未移植 37 个 MCP 工具。后续目标见 [功能复现清单](docs/MCP-REPRODUCTION.md)。

## 运行远端

需要 Node.js 22+ 与 npm。在完整仓库根目录执行：

```sh
npm ci --ignore-scripts
npm start
```

首次运行在 `data/` 生成私密状态，并打印连接块。窗口必须保持运行。不要上传或公开 data/、连接块或私钥。

## AI 连接近端

近端需要完整仓库、Node.js 22+、Python 3.10+ 和 OpenSSH。在近端仓库根目录执行 `npm ci --ignore-scripts`，然后根据目标读取以下 Skill：

- [Linux](.agents/skills/connect-linux-public-ssh/SKILL.md)
- [Windows 10](.agents/skills/connect-win10-public-ssh/SKILL.md)

导入完整连接块后，必须校验指纹与实际电脑身份，再执行任务。Skill 直接使用 src/near.cjs，不需要提交打包 bundle。操作命令示例与失败处理在 Skill 中；[连接排查](docs/troubleshooting.md) 提供补充说明。

`npm run build` 可在 dist/ 生成派生文件；不将其当作独立原始工程或提交到本分支。

## 已有验证

继承的应用源码通过云端 Linux 公网 660 秒测试：33 次 SSH 命令、11 次 64 KiB SFTP 往返、持续输出及空闲长连接正常结束。测试走公共 broker，没有直接绕过中继。没有 Windows 实机和旧网络路径的对照测试，不宣称哪条公网路径更稳定。

## 本机与远程权限

Windows 新增启动令牌检查与 START-REMOTE.cmd 正常桌面启动入口。使用 npm run permissions 采集上下文；实际对照与验收见 [权限说明](docs/PERMISSIONS.md)。这不会自动提权，尚待目标 Windows 实机验证。
