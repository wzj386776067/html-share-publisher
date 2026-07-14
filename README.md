# HTML Share Publisher

碧橙 HTML 分享工作台的 Codex 发布客户端。仓库只包含本地 MCP、Skill 和安装工具，不包含工作台后端、钉钉应用密钥或用户授权令牌。

安装后可以在 Codex 对话中完成：

- 钉钉身份授权；
- HTML、静态站点目录或 ZIP 的预检与打包；
- 新建作品或精准更新已有作品；
- 设置仅协作者、公司内部链接或密码外链；
- 最终确认后发布，并保留稳定链接和本地更新绑定。

## 一键安装

环境要求：macOS 或 Linux、Node.js 22+、npm、Codex CLI。

```bash
curl -fsSL https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.sh | bash
```

安装器会从最新 GitHub Release 下载发行包，校验 SHA-256，安装到：

```text
~/.local/share/html-share-publisher
~/.codex/skills/html-share-publisher
```

随后自动注册名为 `html-share` 的本地 MCP。安装完成后重新打开 Codex，或新建一个任务。

## 测试

准备一个包含 HTML 的本地目录，然后对 Codex 说：

```text
使用 $html-share-publisher 发布 /绝对路径/到/作品目录，只允许我自己访问。执行前先展示最终确认摘要。
```

首次使用会返回一次性钉钉授权链接。完成授权后，AI 会继续预检、确认新建或更新、设置权限，并在真正上传前再次等待明确确认。

也可以测试更新链路：

```text
使用 $html-share-publisher 更新刚才的作品，保持原权限。执行前先展示最终确认摘要。
```

## 安装指定版本

```bash
curl -fsSL https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.sh \
  | bash -s -- --version v0.1.0
```

重复运行安装命令即可升级或修复安装。发布凭证保存在 `~/.config/html-share`，升级不会删除凭证。

## 卸载

先在 Codex 中要求 `$html-share-publisher` 撤销 HTML 分享授权，再执行：

```bash
codex mcp remove html-share
rm -rf ~/.local/share/html-share-publisher ~/.codex/skills/html-share-publisher
```

## 安全边界

- 默认 API 为 `https://share.bi-cheng.cn`。
- 钉钉 `AppSecret` 只存在于公司服务端，本地客户端不会获取它。
- 本地只保存工作台签发的可撤销短期令牌，Skill 禁止展示或索取该令牌。
- 只有 `execute_publish` 会执行远程发布，并且必须使用最终确认后生成的计划。
- 公开仓库不等于开放发布权限；服务端仍按真实钉钉身份、作品所有权和权限规则校验。

本仓库目前未附带开源许可证。代码公开用于公司内安装和安全审阅，不代表授予第三方复制、修改或再分发许可。
