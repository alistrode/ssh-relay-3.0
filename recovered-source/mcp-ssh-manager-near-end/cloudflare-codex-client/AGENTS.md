# Directory operating rule

This directory is the near-end client for a remote Windows 10 machine reached through the configured Cloudflare SSH tunnel (`win10_cloudflare`).

- For any task concerning this directory or its project, default the execution target to the remote Windows machine. Run commands, inspect or change project files, and perform builds or other project work on the remote host through SSH or the configured SSH MCP server.
- The near-end machine is only for connection/bootstrap work: managing this directory's local connection bundle and private key, starting or stopping the local `cloudflared` proxy, and maintaining the local Codex SSH/MCP configuration. A local action needed to establish SSH is also allowed.
- Before acting, check that the remote tunnel and SSH session are available. If they are unavailable, report that and ask the user to restore the connection; do not silently perform the requested project operation on the near-end machine.
- Keep the two targets explicit in command choice. Use the remote SSH/MCP route for remote work; use local PowerShell only for the near-end tasks listed above or to invoke that route.
- If a requested action explicitly names the near-end machine, follow that instruction for that action. Otherwise, assume the remote host.

The reusable `remote-default-operations` skill is in `.agents/skills/remote-default-operations/SKILL.md`.
