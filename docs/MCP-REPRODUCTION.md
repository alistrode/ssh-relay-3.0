# MCP 功能复现范围

本分支先建立复现工作区，尚未宣称已实现 MCP 服务或工具。保留当前公网近远端连接；不以旧连接方式替换它，不引入局域网功能。近远端 src/ 与纯源码分支一致。

功能依据：私有仓库 source/stable-near-far@b724289 的 src/index.js 与 tool-registry.js。这里是功能参照，不向公开 REA 仓库上传项目材料。

## 对 AI 的交付要求

每个移植工具都要提供用途、输入参数、远端副作用说明、适用平台、超时、真实退出码和错误。不得把未执行的命令、PID、端口监听或 success 字段当成执行成功。复用连接身份验证，避免 AI 混用本地与远端目录。

## 分步复现

1. 命令、文件传输、服务器发现与连接状态；连接 Skill 中增加真实工具发现和失败处理。
2. 持久会话、目录和环境上下文、操作历史、日志读取。
3. 部署、别名、分组、批量操作、Profiles 与 Hooks。
4. 监控、备份、数据库及其他高级工具。端口转发与 PTY 需要单独完成服务端支持，不能只注册空工具。

对于与现有连接或权限行为重复、冲突的功能，先向用户报告具体差异再决定。旧版源码中部分工具偏 Linux，不能直接声称适配 Windows。

## 37 个待复现工具

- [ ] `ssh_list_servers`
- [ ] `ssh_execute`
- [ ] `ssh_upload`
- [ ] `ssh_download`
- [ ] `ssh_sync`
- [ ] `ssh_session_start`
- [ ] `ssh_session_send`
- [ ] `ssh_session_list`
- [ ] `ssh_session_close`
- [ ] `ssh_health_check`
- [ ] `ssh_service_status`
- [ ] `ssh_process_manager`
- [ ] `ssh_monitor`
- [ ] `ssh_tail`
- [ ] `ssh_alert_setup`
- [ ] `ssh_backup_create`
- [ ] `ssh_backup_list`
- [ ] `ssh_backup_restore`
- [ ] `ssh_backup_schedule`
- [ ] `ssh_db_dump`
- [ ] `ssh_db_import`
- [ ] `ssh_db_list`
- [ ] `ssh_db_query`
- [ ] `ssh_deploy`
- [ ] `ssh_execute_sudo`
- [ ] `ssh_alias`
- [ ] `ssh_command_alias`
- [ ] `ssh_hooks`
- [ ] `ssh_profile`
- [ ] `ssh_connection_status`
- [ ] `ssh_tunnel_create`
- [ ] `ssh_tunnel_list`
- [ ] `ssh_tunnel_close`
- [ ] `ssh_key_manage`
- [ ] `ssh_execute_group`
- [ ] `ssh_group_manage`
- [ ] `ssh_history`

## 验收

工具必须真实出现在 MCP 工具目录，参数可发现；验证真实 stdout、stderr、退出码和副作用。已完成项附验证依据；未验证平台明确标注。保留当前连接的十分钟公网稳定性要求；工具断线恢复不能伪装成已运行任务可以续接。
