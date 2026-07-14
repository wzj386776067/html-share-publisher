# AI Installation Contract

Use this file when a user asks an AI agent to install HTML Share Publisher from this repository.

## Required behavior

1. Do not only explain installation steps. The user has asked you to perform the installation.
2. Confirm that the environment is a local task with terminal access. Request normal network or filesystem approval when the client requires it.
3. Detect the operating system and current AI client.
4. Run the official installer below. It downloads a versioned GitHub Release, verifies SHA-256, installs dependencies, configures supported clients, and runs the MCP self-test.
5. Report the installed version and configured clients. Tell the user to restart the current AI client or open a new local task.
6. Never request or print a DingTalk token. First-use authorization is completed later through the browser URL returned by the MCP.

## macOS or Linux

```bash
curl -fsSL https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.sh | bash
```

When the current client is known, pass it explicitly:

```bash
curl -fsSL https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.sh \
  | bash -s -- --client workbuddy
```

Supported values are `auto`, `all`, `codex`, `workbuddy`, `trae`, `codebuddy`, and `generic`.

## Windows

```powershell
irm https://raw.githubusercontent.com/wzj386776067/html-share-publisher/main/install.ps1 | iex
```

## Verification

The installer must finish with `Verified HTML Share MCP: 8 tools available.` and an installation success message. Do not claim success when either message is missing.

After restart, verify that the client exposes the `html-share` MCP tools. A user can then say:

```text
把这个 HTML 作品发布出去，只允许我自己访问。执行前先给我看最终确认摘要。
```

Clients without a dedicated adapter can import the generated `~/.local/share/html-share-publisher/mcp-config.json`. A cloud-only client that cannot run local MCP servers is not compatible; state that boundary instead of pretending installation succeeded.
