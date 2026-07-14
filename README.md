# HTML Share Publisher

碧橙 HTML 分享工作台的通用 AI 发布客户端。仓库只包含本地 MCP、客户端适配、Skill 和安装工具，不包含工作台后端、钉钉应用密钥或用户授权令牌。

安装后可以在支持 MCP 的 AI 客户端中完成：

- 钉钉身份授权；
- HTML、静态站点目录或 ZIP 的预检与打包；
- 新建作品或精准更新已有作品；
- 设置仅协作者、公司内部链接或 4 位字母数字密码外链；
- 最终确认后发布，并保留稳定链接和本地更新绑定。

## 对 AI 说一句话安装

把下面这句话发给 Codex、WorkBuddy、TRAE 或其他具备本地终端能力的 AI：

> 请直接安装并配置“HTML 分享发布”工具，不要只告诉我步骤。仓库地址：https://github.com/wzj386776067/html-share-publisher 。请先阅读仓库中的 INSTALL_FOR_AI.md，自动识别我正在使用的 AI 客户端和操作系统，完成 MCP、可用的 Skill、自检和注册，完成后告诉我结果。

AI 应按照 [AI 安装约定](INSTALL_FOR_AI.md) 自动执行，用户不需要理解 Bash 或 PowerShell。安装过程中若客户端申请网络访问或写入用户配置目录，只需确认授权。

## 支持范围

| 客户端 | MCP | Skill/流程增强 | 配置方式 |
| --- | --- | --- | --- |
| Codex | 支持 | 安装 Skill | `codex mcp` |
| WorkBuddy | 支持 | MCP 自带完整流程说明 | `~/.workbuddy/mcp.json` |
| TRAE / TRAE SOLO | 支持 | 安装 Skill | TRAE 全局 MCP 与 Skill 目录 |
| CodeBuddy | 支持 | 安装 Skill | `~/.codebuddy` |
| 其他 MCP 客户端 | 支持标准配置 | 依赖 MCP 自描述 | 生成 `mcp-config.json` |

不支持运行本地 MCP 的纯云端对话工具无法直接使用，这是客户端能力边界。

## 手动安装备用

环境要求：Node.js 22+ 和 npm。Codex、WorkBuddy、TRAE、CodeBuddy 均为可选客户端。

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.sh | bash
```

Windows：

```powershell
irm https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.ps1 | iex
```

安装器会从最新 GitHub Release 下载发行包，校验 SHA-256，安装到：

```text
~/.local/share/html-share-publisher
~/.local/share/html-share-publisher/mcp-config.json
```

安装器默认自动识别本机已有客户端，注册名为 `html-share` 的本地 MCP，并在客户端支持标准 Skill 目录时安装 Skill。安装完成后重启当前客户端，或新建一个本地任务。

## 自动更新

从 `v0.3.0` 开始，所有客户端都固定连接本机 `launcher.mjs`，不再绑定某个版本目录。launcher 每 24 小时最多检查一次 GitHub Release；发现新版本后会校验 SHA-256、原子切换 MCP，并刷新客户端 Skill。检查失败或升级失败时继续运行原版本，不阻断发布。

已经安装 `v0.2.x` 的用户需要执行一次升级安装以迁移到 launcher。完成这次迁移后，后续版本无需重复下载安装。设置 `HTML_SHARE_AUTO_UPDATE=false` 可以关闭自动更新。

## 测试

准备一个包含 HTML 的本地目录，然后对当前 AI 说：

```text
把 /绝对路径/到/作品目录 发布出去，只允许我自己访问。执行前先展示最终确认摘要。
```

首次使用会返回一次性钉钉授权链接。完成授权后，AI 会继续预检、确认新建或更新、设置权限，并在真正上传前再次等待明确确认。

也可以测试更新链路：

```text
更新刚才发布的作品，保持原权限。执行前先展示最终确认摘要。
```

## 安装指定版本

```bash
curl -fsSL https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.sh \
  | bash -s -- --version v0.3.2
```

重复运行安装命令即可升级或修复安装。发布凭证保存在 `~/.config/html-share`，升级不会删除凭证。

## 卸载

先让当前 AI 撤销 HTML 分享授权，再移除对应客户端中的 `html-share` MCP 配置和安装目录。Codex 可以执行：

```bash
codex mcp remove html-share
rm -rf ~/.local/share/html-share-publisher ~/.codex/skills/html-share-publisher
```

## 安全边界

- 默认 API 为 `https://share.bi-cheng.cn`。
- 钉钉 `AppSecret` 只存在于公司服务端，本地客户端不会获取它。
- 本地只保存工作台签发的可撤销短期令牌，Skill 禁止展示或索取该令牌。
- MCP 初始化说明和工具描述都包含固定安全流程，不依赖某一种客户端的 Skill 实现。
- 只有 `execute_publish` 会执行远程发布，并且必须使用最终确认后生成的计划。
- 公开仓库不等于开放发布权限；服务端仍按真实钉钉身份、作品所有权和权限规则校验。

本仓库目前未附带开源许可证。代码公开用于公司内安装和安全审阅，不代表授予第三方复制、修改或再分发许可。
