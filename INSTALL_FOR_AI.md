# AI Installation Contract

> **Critical:** this repository is a combined **Codex Plugin + local MCP + Skill**, not a standalone Skill repository. Any request that includes this repository URL and asks to install the tool, Skill, plugin, or MCP means: install the complete product. Copying only `skills/html-share-publisher` is an incomplete installation and must never be reported as success.

Use this file when a user asks an AI agent to install the Bicheng Content Publisher from this repository.

## Required behavior

1. Do not only explain installation steps. The user has asked you to perform the installation.
2. Confirm that the environment is a local task with terminal access. Request normal network or filesystem approval when the client requires it.
3. Detect the operating system and current AI client.
4. For Codex with plugin support, use the native plugin flow below. It installs the Skill and MCP together; do not also run `skill-installer` or ask the user to register MCP manually.
5. For other supported clients, or older Codex versions without `codex plugin`, run the universal installer below.
6. Report the installed version and configured client. Tell the user to restart the current AI client or open a new local task.
7. Never request or print a DingTalk token. First-use authorization is completed later through the browser URL returned by the MCP.

## Codex native plugin — preferred

First verify that `codex plugin --help` succeeds. Then execute:

```bash
codex plugin marketplace add wzj386776067/html-share-publisher --ref main
codex plugin add html-share-publisher@bicheng-html-share --json
```

The second command returns an `installedPath`. Verify the bundled MCP from that path:

```bash
node <installedPath>/scripts/verify.cjs <installedPath>/mcp/server.mjs
```

Success requires all of the following:

- `codex plugin add` reports `html-share-publisher@bicheng-html-share`;
- the plugin is installed and enabled in `codex plugin list --json`;
- verification prints `Verified HTML Share MCP: 10 tools available.`

The plugin contains a dependency-free MCP bundle. Do not run `npm install`, edit `config.toml`, or execute `codex mcp add` after plugin installation.

## Universal installer

Use this for WorkBuddy, TRAE, CodeBuddy, generic MCP clients, or Codex versions that do not support `codex plugin`.

### macOS or Linux

```bash
curl -fsSL https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.sh | bash
```

When the current client is known, pass it explicitly:

```bash
curl -fsSL https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.sh \
  | bash -s -- --client workbuddy
```

Supported values are `auto`, `all`, `codex`, `workbuddy`, `trae`, `codebuddy`, and `generic`.

### Windows

```powershell
irm https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.ps1 | iex
```

The universal installer must finish with `Verified HTML Share MCP: 10 tools available.` and an installation success message. Do not claim success when either message is missing.

## Recovery from a Skill-only installation

If `~/.codex/skills/html-share-publisher` exists but the current task does not expose `auth_status`, `precheck_package`, `prepare_publish`, and `execute_publish`, treat it as an incomplete legacy installation. Do not stop at “MCP is unavailable.” Run the Codex native plugin flow above, verify it, and ask the user to open a new local task.

## Compatibility boundary

After restart or in a new local task, verify that the client exposes the ten `html-share` MCP tools. A user can then say:

```text
把这个 HTML 作品发布出去，只允许我自己访问。执行前先给我看最终确认摘要。
```

The same workflow supports a direct `.html` file, local static websites, and `.md`, `.txt`, `.docx`, `.pptx`, or `.xlsx` documents. A direct HTML file is packaged automatically as `index.html`; local images, CSS, or JavaScript require selecting the complete directory or ZIP instead. Legacy `.doc`, `.ppt`, and `.xls` files must be saved in their modern formats first. Precheck and preparation stay local; the source file is uploaded only after the user confirms the latest summary.

Clients without a dedicated adapter can import the generated `~/.local/share/html-share-publisher/mcp-config.json`. A cloud-only client that cannot run local MCP servers is not compatible; state that boundary instead of pretending installation succeeded.
