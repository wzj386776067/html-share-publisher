---
name: html-share-publisher
description: Safely publish or update local HTML sites through the Bicheng HTML Share MCP. Use when the user asks to upload, publish, share, update, redeploy, or change access permissions for an HTML file, static site directory, or ZIP package. Enforces DingTalk authorization, package validation, exact update targeting, collaborator resolution, and explicit final confirmation before any remote write.
---

# HTML Share Publisher

Use the HTML Share MCP as the execution layer. Guide the user through one predictable flow and never upload silently.

When the user explicitly asks to revoke, disconnect, or forget the HTML Share AI authorization, call `revoke_authorization` and report that the next publish will require DingTalk authorization again.

## Required Workflow

1. Call `auth_status`.
2. If authorization is missing, call `start_login`, give the authorization URL to the user, and wait for them to finish. Call `auth_status` again afterward.
3. Identify the exact local source path. Accept a static-site directory, one HTML file, or a ZIP.
4. Call `precheck_package` before discussing execution.
5. If multiple HTML candidates require an entry, show the candidates and ask the user to select one. Never choose based on filename similarity.
6. Determine the published file name, which is also used as the work title and the readable name in its share URL:
   - If the user already supplied a name, use it.
   - Otherwise, show `suggestedTitle` from `precheck_package` and ask the user to enter a different name or use that default.
   - If the user leaves it blank, says to keep the original name, or has no preference, omit `title` and let the MCP use the original HTML, ZIP, or directory name. For updates, an omitted title preserves the existing work title.
7. Determine `new` or `update`:
   - Treat a valid local `.htmlshare.json` as a strong update binding.
   - Prefer an explicit `siteId` or stable share URL when supplied.
   - Use `find_sites` when the target needs lookup.
   - If the target is missing or ambiguous, ask. Never infer the target from title alone.
8. Ask for one access policy if it is not already explicit:
   - `collaborators`: only named people and departments.
   - `company_link`: any company employee with the link.
   - `external_link`: password-protected external link, default validity 90 days. The password must be exactly four ASCII letters or digits; generate one when the user does not provide it.
9. For collaborators, call `resolve_contacts`. Preserve the returned stable IDs. If a name is ambiguous or absent, show candidates and ask; do not guess. Groups are not supported in this version.
10. Call `prepare_publish` with the resolved source, operation, entry, target, and permission data.
11. Show the returned `confirmation` in a compact summary: file name/title, new/update, target site, entry file, package size, access policy, collaborators, and external password/expiry when applicable.
12. Stop and ask for explicit confirmation. Earlier requests such as “帮我发布” do not replace this final confirmation after the summary.
13. Only after the user explicitly confirms, call `execute_publish` with the returned `planId` and `confirmed: true`.
14. Return the stable share URL, site ID, version number, permission summary, and external password/expiry when applicable. Mention that a local manifest was written for precise future updates. Directories use `.htmlshare.json`; single HTML and ZIP sources use a source-specific `name.htmlshare.json` sidecar so several works can coexist in one folder.

## Safety Rules

- Never call `execute_publish` in the same turn that first presents the confirmation summary.
- Never pass `confirmed: true` based on inference, prior consent, or urgency.
- Never fabricate a person, department, `siteId`, entry file, or access policy.
- Never expose or ask for the delegated access token. Authorization is handled by `start_login` and `auth_status`.
- Treat a changed-source error as a mandatory re-precheck and reconfirmation.
- Explain that an update creates a new version while keeping the stable link; it does not erase history.
- For a single HTML file that references local assets, recommend selecting the complete directory before continuing.

## Conversation Style

Ask only for missing decisions. Combine related questions when helpful, but do not turn the flow into a long form. Translate natural language permissions directly:

- “发给张三和技术部看” means `collaborators`, followed by contact resolution.
- “全公司都能看” means `company_link`.
- “给外部客户看，加密码” means `external_link`; generate a four-character alphanumeric password and use 90 days unless the user specifies otherwise. Reject custom passwords that are not exactly four ASCII letters or digits.

Read [MCP tool contract](references/mcp-tools.md) only when tool inputs, outputs, or recovery behavior need clarification.
