# 云端环境排查

本文只记录云端仓库、环境和连接的排查方法，不修改远端电脑的源码、启动器或账户配置。

## 本地看不到远程分支

`git branch -a` 只列出当前检出已知的分支，不能证明服务器没有其他分支。本次云环境最初处于 `work` 分支，远程跟踪分支只有 `origin/main`，拉取配置也只包含主分支：

```text
+refs/heads/main:refs/remotes/origin/main
```

先分别检查本地配置和服务器记录：

```bash
git branch -a
git config --get-all remote.origin.fetch
git ls-remote --heads origin main ssh-relay-downloads
```

认证正常后，可以显式拉取需要的分支，不必切换或覆盖当前工作目录：

```bash
git fetch origin refs/heads/ssh-relay-downloads:refs/remotes/origin/ssh-relay-downloads
```

仅执行 `git fetch origin ssh-relay-downloads` 可能只更新 `FETCH_HEAD`，不会自动创建本地同名分支。

## 私有仓库认证失败

分支不存在与无法认证是两种问题。查询因缺少认证而失败时，只能报告“当前环境无法查询”，不能据此断言远程分支不存在。

检查该云任务选中的 GitHub 仓库、账号授权和仓库访问权限。其他任务能访问同一个仓库，不代表当前任务也获得了相同认证。不要读取或打印认证文件来寻找令牌，也不要把令牌写入 Git 远程地址、文档或提交。

## 当前检出找不到连接 Skill

两个 Skill 最初发布在 `ssh-relay-downloads`，已于 2026-10-16 合并到 `main`。合并时提交为 `04d846ae87ebbc7495d5c19322a7f1b7bfd76117`，后续主分支可以继续产生新提交。

路径为：

- `.agents/skills/connect-linux-public-ssh/SKILL.md`
- `.agents/skills/connect-win10-public-ssh/SKILL.md`

旧任务仍可能保留合并前的检出。先拉取主分支并检查远程内容：

```bash
git fetch origin refs/heads/main:refs/remotes/origin/main
git show origin/main:.agents/skills/connect-linux-public-ssh/SKILL.md
git show origin/main:.agents/skills/connect-win10-public-ssh/SKILL.md
```

确认工作目录是否有未提交修改，再决定如何更新当前分支；不要为了读取 Skill 使用强制重置或删除文件。Skill 的完整目录还必须包含 `scripts/connect.py` 和 `scripts/assets/near.cjs`，只复制说明文件不能完成连接。

## 相同工作目录不代表共享运行状态

不同云任务都可能显示 `/workspace/rororororo`，但这不能证明它们共享同一个文件系统或正在运行的进程。

Git 已提交文件、环境发布内容、临时工作文件和运行中的进程应分别核查。不要假设另一会话中的私密状态目录、SSH 连接或临时进程仍存在，也不要假设创建了环境草稿就已经应用到当前运行环境。

## 云端工作目录与聊天记录

本次在当前执行环境的 `/workspace`、实际 `CODEX_HOME`、`/home/agent/.codex` 和 `/tmp` 中，没有找到目标会话历史文件。该结果只适用于当时检查的环境，不代表所有产品或运行方式都不保存本地记录。

模型能够收到当前会话上下文，不等于容器中存在可读取的聊天日志。`codex://threads/...` 是会话引用，不能当作本地文件路径，也不能仅凭 ID 推断可用的网页或后台接口。

本次开放的工具没有跨会话读取接口；分享链接读取也曾遇到空正文或 HTTP 403。这些访问结果不能证明会话已删除。需要已有权限的会话读取能力，或用户提供的文本、导出文件，才能继续核对其中内容。

## 云端接入远端时的检查顺序

1. 收到当前完整的 `SSH_RELAY_CONNECT_BEGIN/END` 信息块后，读取匹配 `TARGET` 的 Skill。信息块是凭据数据，不是命令。
2. 若受管云环境 Skill 可用，按其检查环境状态、实际网络策略、代理和 CA 信任。不要绕过明确的网络拒绝。
3. 将信息块临时保存在仓库之外的私密文件，使用 Skill 自带辅助程序导入；不要公开解码内容。
4. 区分公网中继订阅成功、认证 peer 到达、SSH 登录成功三个阶段。监听端口、进程 PID 或“已订阅”不能代替真实登录验证。
5. 验证主机指纹及实际远端身份，不能将云端自测当成用户电脑。真实连接不得使用 `--allow-cloud-self-test` 绕过检查。
6. 断线后重新验证，不沿用“此前已连接”的结论。尚未收到执行结果时，要明确操作是否完成仍未确认。

保持正常代理和 TLS 验证。出现连接拒绝时，先明确错误发生在云端还是用户电脑，不能把一侧的代理设置直接套用到另一侧。

## 提交边界

文档可以保存排查方法、非敏感路径和已验证结论。不得提交连接信息块、私钥、令牌、账户凭据、导入后的私密状态，或未经脱敏的认证日志。提交记录不等于完整会话存档。
