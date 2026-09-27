---
name: arcade-mcp
description: Build, run, test and deploy MCP tool servers with Arcade MCP (arcade-mcp-server, arcade-tdk, the `arcade` CLI). Use when the user wants to create an MCP server or tool in Python, use `MCPApp` / `@tool` / `Context`, add OAuth auth or secrets to tools, handle tool errors, configure Claude Desktop/Cursor/VS Code, deploy to Arcade Cloud, or work inside the ArcadeAI/arcade-mcp repository.
---

# Arcade MCP

Source: https://github.com/ArcadeAI/arcade-mcp/blob/main/CLAUDE.md

Arcade MCP is a Python (3.10+) platform for tool servers that speak **two protocols from one process**:

1. **MCP**: JSON-RPC 2.0 over stdio or HTTP+SSE (Claude Desktop, Cursor, VS Code).
2. **Arcade Worker**: REST + HS256 JWT on `/worker/*`, used by the Arcade Engine. Enabled only when `ARCADE_WORKER_SECRET` is set.

Both share one `ToolCatalog`; a single `MCPApp` serves both.

## Quick start (building a server)

```bash
uv tool install arcade-mcp        # installs the `arcade` CLI
arcade new my_server              # minimal scaffold (--full for toolkit scaffold)
cd my_server && uv run server.py  # or: arcade mcp stdio / arcade mcp http
arcade configure claude           # write client config (claude | cursor | vscode)
```

```python
from typing import Annotated
from arcade_mcp_server import MCPApp, Context, tool

app = MCPApp(name="my_server", version="1.0.0")

@app.tool
async def greet(context: Context, name: Annotated[str, "Name to greet"]) -> str:
    """Greet a person."""
    await context.log.info(f"Greeting {name}")
    return f"Hello, {name}!"

if __name__ == "__main__":
    app.run(transport="stdio")  # or transport="http", host=..., port=...
```

Rules for tools:
- Every parameter needs a type and an `Annotated[..., "description"]`; the docstring becomes the tool description.
- Take `context: Context` as a parameter when you need logging, secrets, auth, etc.

## Transports

- **stdio**: for Claude Desktop/CLI. Supports auth and secrets natively. **Never write anything to stdout/stderr** (no `print`, no stdout logging, no chatty subprocesses): it corrupts the JSON-RPC channel.
- **http**: FastAPI + SSE for Cursor/VS Code. MCP at `/mcp/*`. Tools that need auth or secrets require `ResourceServerAuth` (OAuth 2.1 Bearer validation):

```python
from arcade_mcp_server.resource_server import ResourceServerAuth, AuthorizationServerEntry

auth = ResourceServerAuth(
    canonical_url="https://mcp.example.com/mcp",
    authorization_servers=[AuthorizationServerEntry(
        authorization_server_url="https://auth.example.com",
        issuer="https://auth.example.com",
        jwks_uri="https://auth.example.com/.well-known/jwks.json",
        algorithm="RS256",
        expected_audiences=["client-id"],
    )],
)
app = MCPApp(name="protected", auth=auth)
```

Also configurable via `MCP_RESOURCE_SERVER_CANONICAL_URL` / `MCP_RESOURCE_SERVER_AUTHORIZATION_SERVERS` (JSON array).

Worker endpoints (when `ARCADE_WORKER_SECRET` is set): `GET /worker/health` (no auth), `GET /worker/tools`, `POST /worker/tools/invoke`. The JWT is signed with the secret, `audience="worker"`, `ver="1"`.

## Auth and secrets

```python
from arcade_tdk import tool
from arcade_tdk.auth import Google

@tool(requires_auth=Google(scopes=["gmail.readonly"]), requires_secrets=["API_KEY"])
async def my_tool(context: Context, query: Annotated[str, "Search query"]) -> str:
    token = context.get_auth_token_or_empty()
    secret = context.get_secret("API_KEY")
    ...
```

- Built-in OAuth providers: Asana, Atlassian, Attio, Calendly, ClickUp, Discord, Dropbox, Figma, GitHub, Google, Hubspot, Linear, LinkedIn, Microsoft, MicrosoftPowerBI, Notion, PagerDuty, Reddit, Slack, Spotify, Twitch, X, Zoom. Use generic `OAuth2(...)` for anything else.
- **Secrets**: every environment variable that does NOT start with `MCP_` or `_` is exposed as a secret (including `ARCADE_*`). Put them in env or `.env`. `.env` is found by walking up from cwd, stopping at the nearest `pyproject.toml`; existing env vars win.
- Cloud: `arcade secret set/unset/list`.

## Context API

| Namespace | Use |
|---|---|
| `context.log` | `.info()`, `.error()`, ... (safe in stdio) |
| `context.progress` | progress for long operations |
| `context.resources` | read MCP resources |
| `context.tools` | call other tools: `await context.tools.call_raw(name, args)` |
| `context.prompts` | MCP prompts |
| `context.sampling` | ask the client's model to generate |
| `context.ui` | ask the user: `await context.ui.elicit(...)` |
| `context.notifications` | notify the client |

Also: `context.user_id`, `context.secrets`, `context.authorization`, `context.metadata`.

## Errors (from `arcade_core.errors`; `arcade_tdk.errors` re-exports them)

| Raise | When |
|---|---|
| `RetryableToolError` | transient; LLM may retry (`additional_prompt_content`, `retry_after_ms`) |
| `ContextRequiredToolError` | needs human input first (requires `additional_prompt_content`) |
| `FatalToolError` | unrecoverable |
| `UpstreamError` | external API failed (requires `status_code`; 5xx/429 retryable) |
| `UpstreamRateLimitError` | 429 (requires `retry_after_ms`) |

The `@tool` error adapter chain is: user adapters, then the auth-provider adapter, then GraphQL, then an HTTP fallback. Unhandled exceptions become `FatalToolError`.

For local debugging only, the magic value `yes-i-accept-leaking-internals-to-the-agent` in `ARCADE_DEBUG_EXPOSE_DEVELOPER_MESSAGE_IN_TOOL_ERROR_RESPONSES` or `ARCADE_DEBUG_EXPOSE_STACKTRACE_IN_TOOL_ERROR_RESPONSES` appends internals to the error `message`. **Never in production.**

## Tool discovery (`arcade mcp ...`)

- `--tool-package github`: load the installed `arcade-github` toolkit.
- `--discover-installed`: load all installed `arcade-*` toolkits.
- Default: scan cwd for `*.py`, `tools/*.py`, `arcade_tools/*.py`, `tools/**/*.py` (test files excluded).
- To exclude tools or toolkits: `ARCADE_DISABLED_TOOLS="Toolkit::Tool,..."`, `ARCADE_DISABLED_TOOLKITS="a,b"`.

## CLI

| Command | Purpose |
|---|---|
| `arcade mcp stdio` / `arcade mcp http` | run a server |
| `arcade new <name> [--full]` | scaffold |
| `arcade configure claude\|cursor\|vscode` | write client config |
| `arcade login` / `logout` / `whoami` | Arcade auth |
| `arcade deploy` | deploy to Arcade Cloud |
| `arcade server logs/list/status` | manage deployed servers |
| `arcade secret set/unset/list` | cloud secrets |
| `arcade show` | list installed tools |
| `arcade evals` | tool-calling evals (needs `[evals]` extra) |

Useful env vars: `ARCADE_API_KEY`, `ARCADE_API_BASE_URL` (default `https://api.arcade.dev`), `ARCADE_ENVIRONMENT`, `ARCADE_AUTH_DISABLED` (never in prod), `ARCADE_USAGE_TRACKING=0`, `ARCADE_DISABLE_AUTOUPDATE=1`.

Settings prefixes (`MCPSettings`): `MCP_SERVER_*`, `ARCADE_*`, `MCP_TRANSPORT_*`, `MCP_MIDDLEWARE_*`, `MCP_NOTIFICATION_*`, `MCP_RESOURCE_SERVER_*`.

## Contributing to the arcade-mcp repo itself

- Library graph: `arcade-core`, then `arcade-tdk` and `arcade-serve`, then `arcade-mcp-server`, then the `arcade` CLI. `arcade-evals` depends on core.
- **Always use uv** (`uv run`, `uv sync`); never bare `pip`/`python`.
- Commands: `make install`, `make test`, `make check` (pre-commit + mypy), `make build`. For a single test: `uv run pytest libs/tests/<path>::Class::test`.
- **TDD**: every change needs a test in `libs/tests/`.
- Bump the version in the lib's `pyproject.toml` once per branch; check `git diff main` first. Breaking change: also bump the dependent's minimum version.
- ruff (line length 100, py310), strict mypy, pre-commit. CI covers Python 3.10–3.14 on Linux, Windows and macOS.
- Changes to tool registration or `create_arcade_mcp()` affect both protocols. `arcade-serve` changes affect only the worker; `MCPServer`/transport changes affect only MCP.
- Examples, one feature per directory: `examples/mcp_servers/`.
