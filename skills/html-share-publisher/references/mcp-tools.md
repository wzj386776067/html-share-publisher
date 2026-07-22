# 碧橙内容发布 MCP 工具契约

执行服务提供以下十个工具：

- `auth_status`：读取本地委托授权状态，或完成已经发起的授权交换。
- `start_login`：创建一次性钉钉授权链接。
- `revoke_authorization`：撤销当前委托令牌并清除本地凭证。
- `precheck_package`：在本机校验静态网站或文档，不上传、不发布。
- `find_sites`：查找当前用户有权管理的作品。
- `prepare_site_status_change`：读取准确目标的当前状态，创建 15 分钟有效的下架或恢复确认计划，不执行变更。
- `execute_site_status_change`：执行用户已经明确确认的下架或恢复计划。
- `resolve_contacts`：把人员和部门解析为稳定 ID。
- `prepare_publish`：校验所有选择，创建 15 分钟有效的确认计划，不执行远程写入。
- `execute_publish`：执行一个已经确认的计划，发布新版本并写入与源文件对应的本地清单。

所有工具都返回结构化 JSON。返回的 `status` 为 `error` 时，使用 `code`、`message` 和 `recovery` 引导下一步交互。不能绕过 `AUTH_REQUIRED`、`ENTRY_REQUIRED`、`TITLE_DECISION_REQUIRED`、`ACCESS_POLICY_CONFIRMATION_REQUIRED`、`UPDATE_TARGET_REQUIRED`、`STATUS_TARGET_REQUIRED`、`CONFIRMATION_REQUIRED`、`SITE_STATE_CHANGED`、`SOURCE_CHANGED` 或任何权限错误。

下架与恢复必须使用独立的 `prepare_site_status_change`、`execute_site_status_change` 两阶段流程。准备阶段只接受准确 `siteId`、公开短码或稳定分享链接；标题查询应先通过 `find_sites` 让用户确认唯一目标。AI 只能操作当前用户自己发布的作品，管理员处理他人作品应进入管理后台。下架仅停止接收者访问，不删除文件、版本或稳定链接；恢复保留原权限，但不会自动重开已经过期、撤销或关闭的外部访问。

`execute_publish` 返回的 `recipientUrl` 是唯一可提供给接收者的链接，`recipientAccess` 表示 `dingtalk` 或 `external_password`。外部权限下，`shareUrl` 和 `internalPreviewUrl` 仅供发布者内部预览；如果 `recipientUrl` 为空或存在 `linkWarning`，不得用内部链接兜底。旧版 MCP 没有 `recipientUrl` 时，外部权限只允许使用 `externalUrl`。

传给 `prepare_publish` 的 `permissions` 必须使用 `resolve_contacts` 返回的原始对象：

```json
{
  "scopeType": "user 或 department",
  "scopeId": "稳定的钉钉标识",
  "scopeName": "展示名称"
}
```

三种分享策略分别是 `collaborators`、`company_link` 和 `external_link`。`accessPolicy` 只能来自用户在当前发布对话中的明确选择，并同时传入 `accessPolicyConfirmed: true`。外部访问必须包含密码和未来的失效时间。密码必须恰好为 4 位 ASCII 字母或数字；省略时由服务端生成合规密码。`externalExpiresAt` 省略时 MCP 使用默认 90 天，并在 `confirmation.externalAccess` 中返回 `validityDays`、`expiresAt`、`expiryMode`、`defaultApplied` 和可修改提示。AI 应展示“90 天（到 YYYY-MM-DD，可修改）”，不额外增加一个阻塞式问题。用户说“30 天”等相对期限时，由 AI 换算为未来的准确 ISO 时间；确认后发生修改必须重新调用 `prepare_publish` 并使用新 `planId`。

`precheck_package` 会返回完整 `htmlCandidates`、`suggestedEntryFile` 和 `requiresEntrySelection`。候选超过一个时，即使建议入口是 `index.html`，也必须让用户明确确认，并在 `prepare_publish` 中同时传 `entryFile` 和 `entryFileConfirmed: true`。

直接文档支持 `.md`、`.txt`、`.docx`、`.pptx` 和 `.xlsx`。文档预检返回 `sourceFormat`、`formatLabel`、`sourceFilename`、`displayMode`、大小、格式摘要和 `warnings`；`htmlCandidates` 为空，入口由平台固定生成为 `index.html`，不得要求用户选择入口。旧版 `.doc`、`.ppt` 和 `.xls` 不支持，应提示另存为新版格式。预检只读取本地文件，只有 `execute_publish` 才上传原文档并由服务器转换。

`prepare_publish.confirmation.source` 描述本次来源。文档必须向用户展示 `filename`、`formatLabel`、`size`、`details` 和全部 `conversionWarnings`；静态网站仍展示 `entryFile` 和 `package`。Word/PowerPoint 转换为网页预览时不保留宏、动态控件、动画、切换、音视频和外部数据；Excel 的隐藏工作表和高级对象按预检警告处理。

`precheck_package` 还会根据所选 HTML、ZIP、目录或文档名称返回 `suggestedTitle`。`prepare_publish.titleDecision` 必须是以下一种：

- `custom`：用户输入自定义名称，同时必须传 `title`。
- `use_suggested`：用户明确同意使用预检返回的建议名称。
- `keep_existing`：仅更新已有作品时使用，表示用户明确保留线上名称。

标题也是新生成分享链接中的可读名称。`find_sites` 和 `prepare_publish` 支持新 12 位公开短链接、旧 `siteId` 链接和直接 `siteId`；公开短码会先解析回真实作品，真正用于本地 Manifest 和精准更新的标识始终是不可变的 `siteId`。
