# HTML Share Publisher

碧橙内容发布平台的通用 AI 发布客户端。仓库只包含本地 MCP、客户端适配、Skill 和安装工具，不包含平台后端、钉钉应用密钥或用户授权令牌。

> **重要：本仓库不是一个可独立使用的 Skill，而是 Codex Plugin + 本地 MCP + Skill 组合包。只复制 `skills/html-share-publisher` 属于不完整安装。**

安装后可以在支持 MCP 的 AI 客户端中完成：

- 钉钉身份授权；
- HTML、静态站点目录、ZIP、Markdown、TXT、Word、PowerPoint 和 Excel 的本地预检；
- 新建作品或通过 `siteId`、新短链接、旧链接精准更新已有作品；
- 设置仅协作者、公司内部链接或 4 位字母数字密码外链；
- 最终确认后发布，并保留稳定链接和本地更新绑定。
- 在确认影响后下架或恢复本人发布的作品，不删除文件和历史版本。

## 对 Codex 说一句话安装

用户只需要把下面一句话发给具备本地终端能力的 Codex：

> 安装并启用这个 Codex 插件：https://github.com/wzj386776067/html-share-publisher

仓库已经声明为 Codex marketplace。Codex 应按照 [AI 安装约定](INSTALL_FOR_AI.md) 自动添加 marketplace、安装 `html-share-publisher` Plugin，并一次性获得本地 MCP 和 Skill。用户不需要手工执行 `codex mcp add`、编辑配置或安装 npm 依赖。安装过程中若客户端申请网络访问或写入用户配置目录，只需确认授权。

如果用户仍然说“安装这个 Skill”，AI 也必须将其理解为安装完整产品，不能只复制 `skills/html-share-publisher`。

Codex 原生安装等价命令如下，仅用于排查或人工兜底：

```bash
codex plugin marketplace add wzj386776067/html-share-publisher --ref main
codex plugin add html-share-publisher@bicheng-html-share
```

WorkBuddy、TRAE、CodeBuddy 和其他客户端继续使用下方通用安装器。

## 支持范围

| 客户端 | MCP | Skill/流程增强 | 配置方式 |
| --- | --- | --- | --- |
| Codex | 支持 | Plugin 自动安装 | Codex marketplace |
| WorkBuddy | 支持 | MCP 自带完整流程说明 | `~/.workbuddy/mcp.json` |
| TRAE / TRAE SOLO | 支持 | 安装 Skill | TRAE 全局 MCP 与 Skill 目录 |
| CodeBuddy | 支持 | 安装 Skill | `~/.codebuddy` |
| 其他 MCP 客户端 | 支持标准配置 | 依赖 MCP 自描述 | 生成 `mcp-config.json` |

不支持运行本地 MCP 的纯云端对话工具无法直接使用，这是客户端能力边界。

## 通用安装器备用

环境要求：Node.js 22+ 和 npm。Codex、WorkBuddy、TRAE、CodeBuddy 均为可选客户端。

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.sh | bash
```

Windows：

```powershell
irm https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.ps1 | iex
```

安装器会从最新 GitHub Release 下载发行包，同时校验 SHA-256 和内置公钥对应的 Ed25519 发布签名，安装到：

```text
~/.local/share/html-share-publisher
~/.local/share/html-share-publisher/mcp-config.json
```

安装器默认自动识别本机已有客户端，注册名为 `html-share` 的本地 MCP，并在客户端支持标准 Skill 目录时安装 Skill。安装完成后重启当前客户端，或新建一个本地任务。

## 更新

Codex Plugin 通过 marketplace 更新：

```bash
codex plugin marketplace upgrade bicheng-html-share
codex plugin add html-share-publisher@bicheng-html-share
```

使用通用安装器的客户端继续通过本机 `launcher.mjs` 自动更新。launcher 每 24 小时最多检查一次 GitHub Release；发现新版本后会校验 SHA-256、原子切换 MCP，并刷新客户端 Skill。检查失败或升级失败时继续运行原版本，不阻断发布。设置 `HTML_SHARE_AUTO_UPDATE=false` 可以关闭自动更新。

已经安装 `v0.2.x` 或仅复制过 Skill 的 Codex 用户，重新发送上方一句话安装指令即可迁移到原生 Plugin。

## 测试

准备一个静态网站目录或支持的文档，然后对当前 AI 说：

```text
把 /绝对路径/到/作品目录 发布出去，只允许我自己访问。执行前先展示最终确认摘要。
```

文档可以直接发布，无需手工转成 ZIP：

```text
把 /绝对路径/季度复盘.pptx 发布给全公司，执行前先展示最终确认摘要。
```

直接文档支持 `.md`、`.txt`、`.docx`、`.pptx` 和 `.xlsx`。旧版 `.doc`、`.ppt`、`.xls` 请先另存为新版格式。文档在最终确认前只在本机预检，确认后才上传原文件并由平台转换为网页。

首次使用会返回一次性钉钉授权链接。完成授权后，AI 会继续预检、确认新建或更新、设置权限，并在真正上传前再次等待明确确认。

也可以测试更新链路：

```text
更新刚才发布的作品，保持原权限。执行前先展示最终确认摘要。
```

## 安装指定版本

```bash
curl -fsSL https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.sh \
  | bash -s -- --version v0.5.0
```

重复运行安装命令即可升级或修复安装。发布凭证保存在 `~/.config/html-share`，升级不会删除凭证。

## 卸载

先让当前 AI 撤销 HTML 分享授权。Codex Plugin 可以执行：

```bash
codex plugin remove html-share-publisher@bicheng-html-share
codex plugin marketplace remove bicheng-html-share
```

使用通用安装器的旧版 Codex 才需要执行 `codex mcp remove html-share` 并删除对应安装目录。

## 安全边界

- 默认 API 为 `https://share.bi-cheng.cn`。
- 钉钉 `AppSecret` 只存在于公司服务端，本地客户端不会获取它。
- 本地只保存工作台签发的可撤销短期令牌，Skill 禁止展示或索取该令牌。
- 自动更新只接受通过仓库内固定公钥验证的签名发行包；校验失败时继续运行当前版本。
- 发布和下架/恢复计划由服务端签名并绑定当前钉钉用户、作品、元数据和 15 分钟有效期。
- AI 委托令牌不继承浏览器管理员权限，只能管理当前用户自己发布的作品。
- MCP 初始化说明和工具描述都包含固定安全流程，不依赖某一种客户端的 Skill 实现。
- `prepare_publish` 必须包含用户明确作出的作品名称决策和分享范围确认，否则不会生成发布计划。
- `precheck_package` 和 `prepare_publish` 不上传源文件；只有 `execute_publish` 会在用户确认完整摘要后执行远程发布。
- 下架或恢复使用独立的两阶段状态计划；AI 只能操作当前用户自己发布的作品，管理员治理他人作品仍需进入工作台。
- 下架不会删除文件、版本或稳定链接；恢复不会自动重开已过期、撤销或关闭的外部访问。
- `execute_publish.recipientUrl` 是唯一面向接收者的链接；外部权限返回需要密码的外链，内部 `shareUrl` 仅供发布者预览，不能作为外链兜底。
- 公开仓库不等于开放发布权限；服务端仍按真实钉钉身份、作品所有权和权限规则校验。

本仓库目前未附带开源许可证。代码公开用于公司内安装和安全审阅，不代表授予第三方复制、修改或再分发许可。
