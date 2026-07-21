---
name: html-share-publisher
description: 通过碧橙 HTML 分享 MCP 安全发布、更新、下架或恢复 HTML 作品。当用户要求上传、发布、分享、更新、重新部署 HTML 文件、静态网站目录或 ZIP 包，或下架、恢复已有作品时使用。严格执行钉钉鉴权、精准作品定位、影响确认和执行前最终确认。
---

# HTML 分享发布

使用 HTML 分享 MCP 执行实际操作。引导用户完成一套稳定、可预期的流程，绝不能在用户不知情时上传。

当用户明确要求撤销、断开或忘记 HTML 分享 AI 授权时，调用 `revoke_authorization`，并说明下次发布时需要重新完成钉钉授权。

## 工具门禁与自动修复

开始操作前，确认当前任务实际提供 `auth_status`、`start_login`、`precheck_package`、`prepare_publish`、`execute_publish`、`prepare_site_status_change` 和 `execute_site_status_change` 等 HTML 分享 MCP 工具。

如果 Skill 已加载但这些工具缺失，不得只回复“没有 MCP 工具”或让用户手工注册。应将其判断为不完整的旧安装，并在具备本地终端能力时主动修复：

1. 读取仓库的 `INSTALL_FOR_AI.md`。
2. Codex 优先执行原生 Plugin 安装：添加 `wzj386776067/html-share-publisher` marketplace，并安装 `html-share-publisher@bicheng-html-share`。
3. 如果当前 Codex 不支持 Plugin，执行仓库官方通用安装器并明确传入 `--client codex`。
4. 获得必要的网络或用户目录写入批准后自行执行，不把 MCP 注册步骤转交给用户。
5. 必须看到 `Verified HTML Share MCP: 10 tools available.` 才能报告安装或修复成功。
6. 当前任务的工具清单不会在运行中动态刷新；修复成功后要求用户完全重启客户端或打开新的本地任务，再继续发布。

纯云端任务或没有本地 MCP 能力的客户端无法完成修复，应明确说明兼容边界，不能假装安装成功。

## 下架与恢复流程

用户要求下架或恢复作品时，不做文件预检，也不进入上传流程：

1. 调用 `auth_status`；未授权时按正常钉钉授权流程处理。
2. 使用用户提供的真实 `siteId`、公开短码、稳定分享链接或本地 Manifest 精确定位作品。只有标题时调用 `find_sites`；无结果或多个候选时让用户明确选择，不能猜测。
3. 调用 `prepare_site_status_change`，其中 `action=unpublish` 表示下架，`action=republish` 表示恢复上线。
4. 把返回的 `confirmation` 完整展示给用户，然后停止执行。下架确认必须说明：接收者会立即无法访问，但文件、历史版本和稳定链接保留，可恢复；恢复确认必须说明原链接和权限会保留。
5. 如果恢复外链作品时 `warning` 提示外部访问已过期、撤销或关闭，必须明确告诉用户恢复作品不会自动重开外链，需要之后在工作台处理。
6. 用户对当前最新确认摘要明确同意后，才调用 `execute_site_status_change`，并传入该 `planId` 和 `confirmed: true`。
7. 执行完成后报告新状态，并说明没有删除文件、版本或稳定链接。工具返回 `already_in_target_state` 时直接说明无需重复操作，不再索取确认。

AI 只能下架或恢复当前钉钉用户自己发布的作品，即使当前用户是管理员也不能通过 AI 操作他人作品。管理员治理他人作品必须进入工作台管理后台。

## 发布与更新流程

1. 调用 `auth_status`。
2. 如果尚未授权，调用 `start_login`，把授权链接提供给用户并等待其完成授权，然后再次调用 `auth_status`。
3. 确认准确的本地源文件路径。支持静态网站目录、单个 HTML 文件或 ZIP 包。
4. 在讨论是否执行发布之前，调用 `precheck_package` 完成预检。
5. 如果存在多个可作为入口的 HTML 文件，展示完整候选列表和建议入口并让用户明确选择。即使建议入口是 `index.html` 也不能自行确认，更不能根据文件名相似度猜测；确认后在 `prepare_publish` 中同时传入 `entryFile` 和 `entryFileConfirmed: true`。
6. 确认发布文件名。该名称同时作为作品标题和分享链接中的可读名称：
   - 如果用户已经给出名称，使用 `titleDecision: custom` 并传入 `title`。
   - 否则展示 `precheck_package` 返回的 `suggestedTitle`，询问用户是输入新名称还是使用默认名称。
   - 用户明确使用默认名称时，传 `titleDecision: use_suggested`。更新已有作品且用户明确沿用线上名称时，传 `titleDecision: keep_existing`。
   - 不能把用户未回答当作同意默认名称，也不能省略 `titleDecision`。
7. 确认是新建还是更新：
   - 有效的本地 `.htmlshare.json` 是强更新绑定依据。
   - 用户提供了明确的 `siteId`、新短链接或旧版稳定分享链接时，优先使用该标识。MCP 会把公开短码解析回真实 `siteId`。
   - 需要查找目标作品时调用 `find_sites`。
   - 如果更新目标缺失或存在歧义，必须询问用户，绝不能只根据相似标题推断。
8. 如果用户尚未明确分享范围，要求其从以下三种策略中选择一种：
   - `collaborators`：仅指定人员和部门可以访问。
   - `company_link`：公司员工获得链接即可访问。
   - `external_link`：外部用户通过密码访问。密码必须恰好为 4 位 ASCII 字母或数字；用户未提供时自动生成。用户未指定有效期时，不增加单独的阻塞式提问，主动说明“默认 90 天，可在最终确认时修改”。
   - 只有用户已经明确选择后，才能在 `prepare_publish` 中传 `accessPolicyConfirmed: true`。不能根据内容用途、收件人或之前的作品权限自行代选。
9. 使用协作者权限时调用 `resolve_contacts`，并原样保留返回的稳定 ID。姓名不存在或重名时，展示候选项并让用户选择，绝不能猜测。当前版本不支持群聊。
10. 使用已经确认的源文件、操作类型、入口文件、目标作品、`titleDecision`、`accessPolicy` 和 `accessPolicyConfirmed: true` 调用 `prepare_publish`；多 HTML 还必须传 `entryFileConfirmed: true`。
11. 简洁完整地展示返回的 `confirmation`，必须包含：文件名或标题、新建或更新、目标作品、入口文件、文件数量和大小、分享范围、协作者，以及外部访问密码和有效期（如适用）。外部有效期必须同时展示天数和准确到期日期；默认值应写成“90 天（到 YYYY-MM-DD，可修改）”，不能只展示一串 ISO 时间。用户说“30 天”等相对期限时，将其换算为未来的准确 ISO 时间传给 `externalExpiresAt`。
12. 用户查看确认摘要后要求修改有效期或其他发布信息时，重新调用 `prepare_publish`，展示新的完整 `confirmation` 并等待确认；绝不能继续执行旧 `planId`。
13. 停止执行并向用户索取最终明确确认。用户之前说过“帮我发布”等指令，不能替代看过当前最新确认摘要后的最终确认。
14. 只有用户明确确认后，才能调用 `execute_publish`，并传入当前最新的 `planId` 和 `confirmed: true`。
15. 发布完成后只把 `execute_publish.recipientUrl` 作为提供给接收者的链接，并说明 `recipientAccess`：
    - `collaborators`、`company_link` 应返回钉钉访问链接。
    - `external_link` 必须返回外部密码链接、密码和有效期；绝不能把 `shareUrl` 或 `internalPreviewUrl` 当作对外链接。
    - 兼容旧版 MCP 时，如果没有 `recipientUrl`，外部权限只能使用 `externalUrl`，其他权限使用 `shareUrl`。
    - 如果 `recipientUrl` 为空或存在 `linkWarning`，说明作品已发布但安全分享链接未就绪，不能用内部预览链接兜底。
    同时返回 `siteId`、版本号和权限摘要。说明公开短码只用于链接，本地精准更新仍绑定真实 `siteId`。本地清单文件：目录使用 `.htmlshare.json`；单个 HTML 和 ZIP 使用与源文件对应的 `名称.htmlshare.json`，从而允许同一目录存在多个作品。

## 安全规则

- 首次展示最终确认摘要的同一轮中，绝不能调用 `execute_publish`。
- 首次展示状态变更确认摘要的同一轮中，绝不能调用 `execute_site_status_change`。
- 不能用标题近似匹配来决定下架或恢复目标，也不能通过 AI 以管理员身份操作他人的作品。
- 不能因为之前的同意、语气紧急或自行推断而传入 `confirmed: true`。
- 不能因为预检返回了建议名称就自行传 `titleDecision: use_suggested`，也不能因为存在默认权限就自行传 `accessPolicyConfirmed: true`。
- 不能因为预检建议使用 `index.html` 就自行传 `entryFileConfirmed: true`；多 HTML 的入口必须来自用户明确确认。
- 外部权限下不能向用户提供 `shareUrl` 或 `internalPreviewUrl` 作为分享链接；它们会走钉钉登录而不是密码验证。
- 绝不能虚构人员、部门、`siteId`、入口文件或分享范围。
- 绝不能展示或索取委托访问令牌；授权只能通过 `start_login` 和 `auth_status` 完成。
- 收到源文件已变化的错误后，必须重新预检并再次获得用户确认。
- 向用户说明：更新会创建新版本并保留稳定链接，不会抹掉历史版本。
- 单个 HTML 引用了本地图片、CSS 或 JavaScript 时，建议用户改为选择完整目录后再继续。

## 对话方式

只询问尚未明确的必要决策。可以合并相关问题，但不要把流程变成长表单。把自然语言权限直接转换为对应策略：

- “发给张三和技术部看”表示使用 `collaborators`，然后解析协作者。
- “全公司都能看”表示使用 `company_link`。
- “给外部客户看，加密码”表示使用 `external_link`；用户未指定时生成 4 位字母数字密码，并使用 90 天有效期。应立即说明默认有效期可在最终确认时修改，不再单独追问一次。用户自定义密码不是恰好 4 位 ASCII 字母或数字时必须拒绝。

仅在需要确认工具输入、输出或错误恢复方式时，读取 [MCP 工具契约](references/mcp-tools.md)。
