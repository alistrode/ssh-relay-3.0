# 完整离线运行包

完整应用与官方 Node/Electron 均已上传；GitHub 单文件限制要求将完整 ZIP 无损分卷，每卷最多 90 MiB。下载本目录对应平台的全部 .part 文件和 ASSEMBLE 脚本到同一目录。Windows 双击 ASSEMBLE-WINDOWS.cmd；Linux 执行 sh ASSEMBLE-LINUX.sh。脚本本地合并并校验完整 SHA-256，不下载、不安装、不修改环境配置。解压生成的完整 ZIP，保留整个应用目录，运行 SSH-Relay-Near 或 SSH-Relay-Far。Linux 保留执行权限。

无需 Node、npm、账号或付费。离线启动界面无需下载组件；实际公网连接仍需可访问公共 WSS 中继。MANIFEST.json 记录各分卷及完整 ZIP 的大小和 SHA-256。源码另见 ../source.zip。不要把运行后生成的私密状态、密钥、配对码、报告或日志上传。
