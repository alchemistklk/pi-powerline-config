# Pi footer：微调版与配置

基于 [jwu/pi-powerline](https://github.com/jwu/pi-powerline) 0.11.1 的本地修改版，保留原作者 MIT 许可与署名。不是原项目的官方发行版。

## 下载与效果

[下载微调版 ZIP](https://github.com/alchemistklk/pi-powerline-config/releases/download/v0.11.1-local.20261013/pi-footer-kit.zip) · [源代码仓库](https://github.com/alchemistklk/pi-powerline-config)

![整体效果](https://github.com/alchemistklk/pi-powerline-config/raw/main/docs/01-footer-main.png)

![信息说明](https://github.com/alchemistklk/pi-powerline-config/raw/main/docs/02-footer-guide.png)

## 安装

需要已安装 Pi 和 Python 3。本机验证环境为 Pi 1.1.0、Node 24.18.0；其他版本尚未验证。插件声明 Node >=22.19.0。

关闭 Pi，解压本压缩包，在 `pi-footer-kit` 目录执行：

```sh
python3 install.py --dry-run
python3 install.py
```

重新启动 Pi。安装器将插件复制到 `~/.pi/agent/local-packages/pi-powerline-shared`，替换 settings.json 中已有的同名本地/npm Powerline 引用；其他插件保持原有配置。通过 Git URL 引用的 Powerline 需自行移除，避免重复加载。

样式文件放入 `~/.pi/agent/powerline-style.json`。显示设置合并进 settings.json：启用 Powerline、输入框内嵌信息及 footer，关闭 header 与 header-info，使用 vscode-dark-modern 主题。模型、服务连接和其他设置不从发布包导入。

安装前的 settings.json、样式文件及既有 shared 目录备份到 `~/.pi/agent/backups/pi-footer-时间戳`。这些备份留在自己的机器，可能包含私有配置，不要对外上传。恢复时关闭 Pi，将对应备份文件复制回原位置；没有旧样式文件时删除新样式文件即可。

## 字体与布局

终端需使用 Nerd Font，支持图中的图标。没有字体时更换终端字体，或将样式文件 icons 中相应值设为空字符串。

- 输入框上沿左侧：模型名称、思考档位；右侧：会话名。
- footer：末级目录、存在时的 Git 分支、上下文占用比例与容量、累计输入/输出 token、最近一次调用的缓存命中率。
- 细横线与 ` │ ` 分组；浅粉紫模型、浅蓝会话、近白目录、暖黄分支、淡紫上下文、薄荷绿用量。
- 上下文达到 70%/90% 时使用 Pi 主题警示/错误颜色。
- 费用、缓存读写量和 LSP 状态隐藏。PR 详细状态默认关闭，显示编号链接；PR/CI 数据由独立插件提供，本包不包含内部 Git 服务配置。
- 会话名需要通过 Pi 的会话命名功能设置。后台任务、PR、MCP 等信息取决于自己的其他插件和实际状态，并非安装本包就会出现。

修改样式后运行 `/reload`。项目级 `<project>/.pi/powerline-style.json` 可以覆盖全局样式。详细字段见 `pi-powerline/STYLE-CONFIG.md`。

## 统计口径

`↑` 与 `↓` 是当前会话累计的 input/output 字段，不包含另外统计的 cacheRead/cacheWrite；缓存命中率是最近一次有效调用的 `cacheRead / (input + cacheRead + cacheWrite)`，不是整个会话平均值，也不是任务成功率。`272k` 是上下文窗口容量。

## 与原版的区别

本包包含布局代码修改和样式文件；只将样式文件用于原版不能完整复现截图。更新原插件前需要自行合并这些修改。

整理时修正了 MCP 计数函数中一处未定义 ctx 引用，避免启用 MCP 后计数被异常捕获而静默隐藏。其他呈现保持本地版本。没有包含认证文件、账号 secret、内部服务地址配置、历史会话或机器上的完整 settings.json。
