# NanoFleet Agent

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.x-fbf0df?logo=bun&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-ELv2-aa2200)

Self-hosted autonomous AI agent runtime — provider-agnostic, channel-independent.

Built with [Mastra](https://mastra.ai), Bun + TypeScript.

<details>
<summary>Lines of code</summary>

```
─────────────────────────────────────────────────────────────────────
Language            Files       Lines    Blanks  Comments       Code
─────────────────────────────────────────────────────────────────────
TypeScript             16       1 683       270        32      1 381
Markdown               10       1 611       435         0      1 176
JSON                    6         121         0         0        121
YAML                    2          94        11         0         83
Dockerfile              1          30        12         0         18
License                 1          91        27         0         64
─────────────────────────────────────────────────────────────────────
Total                  36       3 630       755        32      2 843
─────────────────────────────────────────────────────────────────────
```

</details>

## Quick Start

```bash
cp .env.example .env
# Add your API key (ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or OPENROUTER_API_KEY)
# Set AGENT_MODEL (e.g. claude-haiku-4-5, gemini-2.0-flash, openrouter:meta-llama/llama-3.3-70b-instruct)

# Edit `docker-compose.yml` and uncomment a channel adapter to connect the agent to an external platform.
docker compose up -d

curl http://localhost:4111/health
```

<details>
<summary>Development</summary>

```bash
bun install
bun run dev        # HTTP server with hot reload
bun run lint
bun run format
```

</details>

## Workspace

Customize the agent by editing files in `workspace/`:

| File | Description |
|------|-------------|
| `SOUL.md` | Agent identity — name, worldview, opinions, interests |
| `STYLE.md` | Communication style guide |
| `MEMORY.md` | Long-term memory (auto-consolidated after conversations) |
| `HEARTBEAT.md` | Periodic tasks checklist (runs every 30 min by default) |
| `AGENTS.md` | Other agents in the system (for multi-agent setups) |
| `cron.json` | Scheduled jobs _(not yet implemented)_ |
| `skills/` | Custom skills — each in its own `SKILL.md` file |

### Skills

Skills are Markdown files with YAML frontmatter, placed in `workspace/skills/<name>/SKILL.md`.

<details>
<summary>SKILL.md format</summary>

```yaml
---
id: my-skill
name: My Skill
description: Does something useful
requirements:
  binaries: ["jq"]
  env_vars: ["API_KEY"]
---

# Skill instructions here
```

</details>

The agent detects available skills at startup and injects their metadata into the system prompt.

## Tools

The agent comes with built-in tools:

| Tool | Enabled by default | Description |
|------|--------------------|-------------|
| Web search | Yes | Provider-native: Anthropic (`webSearch_20250305`), Google (`googleSearch`), OpenRouter (`:online` suffix) |
| Web fetch | Yes | Fetches a URL and returns readable text |
| File read/write | Yes | Read and write files in the workspace |
| Shell | No | Execute shell commands — enable with `SHELL_TOOL_ENABLED=true` |

Additional tools can be added via [MCP servers](#mcp).

## MCP

Add MCP servers in `workspace/.mcp.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    }
  }
}
```

Tools from MCP servers are automatically discovered and registered at startup.

## API

<details>
<summary><strong>Health & Info</strong></summary>

### GET /health
```bash
curl http://localhost:4111/health
# {"status":"ok"}
```

### GET /identity
```bash
curl http://localhost:4111/identity
# {"hasSoul":true,"hasStyle":true,"hasMemory":false,"hasAgents":false}
```

### GET /system-prompt
```bash
curl http://localhost:4111/system-prompt
```

### GET /skills
```bash
curl http://localhost:4111/skills
# {"skills":[{"id":"...","name":"...","description":"...","available":true}]}
```

</details>

<details>
<summary><strong>Generate & Stream</strong></summary>

### POST /api/agents/:id/generate

```bash
curl -X POST http://localhost:4111/api/agents/main/generate \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

Response:
```json
{
  "text": "Hello! How can I help you?",
  "threadId": "thread-123",
  "usage": { "inputTokens": 100, "outputTokens": 20 },
  "cost": 0.0002
}
```

Pass `threadId` in subsequent requests to continue the same conversation. Without it, the last thread is reused automatically.

### POST /api/agents/:id/stream

SSE streaming response.

```bash
curl -X POST http://localhost:4111/api/agents/main/stream \
  -H "Content-Type: application/json" -N \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

</details>

<details>
<summary><strong>Memory</strong></summary>

### GET /api/agents/:id/memory/threads
```bash
curl http://localhost:4111/api/agents/main/memory/threads
```

### POST /api/agents/:id/memory/threads

Create a new thread explicitly (e.g. to start a fresh conversation).

```bash
curl -X POST http://localhost:4111/api/agents/main/memory/threads \
  -H "Content-Type: application/json" \
  -d '{"resourceId": "user-123"}'
```

### GET /memory/config
```bash
curl http://localhost:4111/memory/config
```

</details>

<details>
<summary><strong>Usage</strong></summary>

### GET /api/agents/:id/usage
```bash
curl http://localhost:4111/api/agents/main/usage
```

```json
{
  "totalInputTokens": 10000,
  "totalOutputTokens": 5000,
  "totalCacheReadTokens": 8000,
  "totalCacheWriteTokens": 2000,
  "totalCost": 0.15,
  "cacheHitRate": 80,
  "requests": 50
}
```

### GET /api/agents/:id/usage/threads/:threadId
```bash
curl http://localhost:4111/api/agents/main/usage/threads/thread-123
```

</details>

## Channels

Channels connect the agent to external platforms (Telegram, Discord, ...). Each channel is a standalone adapter that forwards messages to the agent via HTTP/SSE.

Available channels: [nanofleet-agent-channels](https://github.com/NanoFleet/nanofleet-agent-channels)

The `docker-compose.yml` includes a commented Telegram example — uncomment and configure it to add a channel alongside the agent.

> If you use [NanoFleet](https://github.com/NanoFleet/nanofleet), channels are deployed and managed from the web dashboard — no manual docker-compose configuration needed.

## License

[Elastic License 2.0 (ELv2)](LICENSE)
