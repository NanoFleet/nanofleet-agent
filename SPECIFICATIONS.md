# nanofleet-agent — Specifications

> Autonomous AI agent runtime, designed to be self-hosted, provider-agnostic, and channel-independent.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Architecture](#3-architecture)
4. [Identity & Personality](#4-identity--personality)
5. [Memory](#5-memory)
6. [Skills](#6-skills)
7. [Tools & MCP](#7-tools--mcp)
8. [Scheduling — HEARTBEAT.md](#8-scheduling--heartbeatmd)
9. [Transport Layer](#9-transport-layer)
10. [Usage & Cost Tracking](#10-usage--cost-tracking)
11. [Channels](#11-channels)
12. [Multi-Agent & Group Chat](#12-multi-agent--group-chat)
13. [Multimodal](#13-multimodal)
14. [Tech Stack](#14-tech-stack)
15. [Repository Structure](#15-repository-structure)
16. [Configuration](#16-configuration)
17. [Deployment](#17-deployment)
18. [Prompt Caching](#18-prompt-caching)

---

## 1. Overview

`nanofleet-agent` is a standalone autonomous AI agent runtime.

**What it is:**
- A self-contained agent that can run in a Docker container
- Provider-agnostic (Anthropic, Google, OpenRouter, vLLM, and any model via 600+ providers)
- Channel-independent — communication adapters live in a separate repository
- Usable standalone (CLI, webhook)

**What it is not:**
- A chatbot framework
- A messaging platform
- Tied to any specific LLM provider or channel

**Companion repositories:**
- [`nanofleet`](https://github.com/NanoFleet/nanofleet) — web UI and fleet manager (optional)
- `nanofleet-agent-channels` — communication channel adapters (Telegram, Discord, webhook...)

---

## 2. Design Principles

1. **Agent core stays clean** — no channel logic, no platform SDKs in the core. The agent receives a message and returns a response. Period.
2. **Provider-agnostic** — swap models without changing agent logic.
3. **Self-hosted first** — no mandatory cloud dependency.
4. **Minimal by default, extensible by design** — built-in tools cover the essentials; everything else is MCP or skills.
5. **Markdown-driven configuration** — identity, memory, skills, and heartbeat are plain markdown files editable by humans and agents alike.
6. **Robust from day one** — persistent memory, proper session isolation, no RAM-only state.
7. **Cache-aware by design** — the system prompt structure, tool ordering, and session lifecycle are designed around prompt caching constraints. See [Prompt Caching](#18-prompt-caching).

---

## 3. Architecture

```
nanofleet-agent/
│
├── Agent Core (Mastra)
│   ├── LLM loop (generate / stream)
│   ├── Tool execution
│   ├── Memory (conversation history, working memory, semantic recall)
│   └── MCP client
│
├── Identity Layer
│   ├── SOUL.md       ← personality & identity
│   ├── STYLE.md      ← voice & communication style (optional)
│   └── AGENTS.md     ← multi-agent context (optional)
│
├── Memory Layer
│   ├── MEMORY.md     ← long-term facts (injected in system prompt)
│   ├── HISTORY.md    ← append-only timestamped log
│   └── LibSQL DB     ← Mastra native (conversation, working memory, vectors)
│
├── Skills Layer
│   └── skills/       ← SKILL.md files, loaded on demand
│
├── Scheduling Layer
│   └── HEARTBEAT.md  ← periodic task checklist
│
└── Transport Layer
    ├── HTTP REST     ← POST /api/agents/:id/generate
    └── SSE streaming ← POST /api/agents/:id/stream
```

### Data flow

```
Inbound message (from any channel)
    → Transport layer (HTTP/SSE)
    → Mastra agent loop
        → System prompt built:
            SOUL.md + MEMORY.md + active skills metadata
        → LLM call (with tool use if needed)
        → Memory updated (Mastra + MEMORY.md consolidation)
    → Response streamed back to caller
```

---

## 4. Identity & Personality

Each agent instance has a workspace directory containing markdown files that define who it is. These files are loaded at session start and injected into the system prompt.

### SOUL.md (required)

Defines the agent's core identity: who it is, what it believes, how it sees the world. Edited by the user at setup or by the agent over time.

```markdown
# Soul

## Who I Am
...

## Worldview
...

## Opinions
...

## Interests
...
```

### STYLE.md (optional)

Defines communication voice, tone, and vocabulary preferences. If absent, defaults to a neutral, helpful style.

### AGENTS.md (optional)

Loaded when the agent operates in a multi-agent context. Describes other agents it may interact with, their roles, and collaboration rules.

### System prompt assembly order

```
1. Core instructions (hardcoded, minimal)
2. SOUL.md
3. STYLE.md (if present)
4. MEMORY.md (first 200 lines)
5. Active skills metadata (name + description per skill)
6. AGENTS.md (if multi-agent context)
```

---

## 5. Memory

Memory is multi-layered. Each layer serves a different time horizon.

### 5.1 Conversation history

Managed by Mastra natively. The last N messages from the current thread are injected into context automatically. Configurable via `lastMessages`.

### 5.2 Working memory (Mastra)

Persistent structured facts about the user or context — name, preferences, ongoing projects. Stored in LibSQL. The agent can update it via an internal `updateWorkingMemory` tool call.

### 5.3 Semantic recall (Mastra)

Vector search over older conversations. When a message arrives, Mastra retrieves the top-K most semantically relevant past exchanges and injects them into context. Requires a vector store (LibSQL with vector extension by default).

### 5.4 MEMORY.md — long-term facts file

A markdown file maintained by the agent. The first 200 lines are always injected into the system prompt. When conversation history exceeds a threshold (default: 50 messages), a consolidation LLM call:
- Rewrites MEMORY.md with updated long-term facts
- Appends a timestamped summary entry to HISTORY.md

### 5.5 HISTORY.md — append-only log

A grep-searchable chronological log of past events and summaries. Not injected in full — loaded on demand when the agent needs to recall past events.

### Memory consolidation flow

```
messages > 50
    → consolidation LLM call
        → reads current MEMORY.md + last N messages
        → output: updated MEMORY.md + HISTORY.md entry
    → session.last_consolidated pointer advanced
```

### Storage backends

| Layer | Default | Alternatives |
|---|---|---|
| Conversation / Working memory | LibSQL (file-based SQLite) | PostgreSQL, MongoDB |
| Semantic recall vectors | LibSQL Vector | pgvector, Pinecone |
| MEMORY.md / HISTORY.md | Filesystem | Any mounted volume |

---

## 6. Skills

Skills are markdown files that give the agent new capabilities or knowledge. They follow the [Agent Skills open standard](https://agentskills.io).

### Structure

```
skills/
  web-scraping/
    SKILL.md
  code-review/
    SKILL.md
    scripts/
      lint.sh
  github/
    SKILL.md
```

Each `SKILL.md` has YAML frontmatter:

```yaml
---
name: web-scraping
description: Scrape and parse web pages, extract structured data from HTML.
compatibility: Requires web search tool
allowed-tools: WebSearch WebFetch
---

# Web Scraping

## When to use this skill
...
```

### Loading mechanism

1. At startup, the agent scans `skills/` and reads frontmatter from each `SKILL.md`
2. Skill names and descriptions are injected into the system prompt as XML
3. When the LLM determines a skill is needed, it activates it — the full `SKILL.md` is loaded into context
4. Skills are provider-agnostic — any LLM can use them

### Skills XML in system prompt

```xml
<available_skills>
  <skill>
    <name>web-scraping</name>
    <description>Scrape and parse web pages...</description>
    <location>/workspace/skills/web-scraping/SKILL.md</location>
  </skill>
</available_skills>
```

### Compatibility filtering

If a skill declares `compatibility` requirements (e.g., a specific binary or env var), the agent checks availability at startup and excludes unavailable skills from the system prompt.

---

## 7. Tools & MCP

### Built-in tools

| Tool | Description |
|---|---|
| `webSearch` | Web search (provider-native: Anthropic, Google, or OpenRouter `:online`) |
| `webFetch` | Fetch and parse a URL to readable text |
| `readFile` | Read a file from the workspace |
| `writeFile` | Write a file to the workspace |
| `editFile` | Precise string-patch edit with fuzzy near-match feedback |
| `listDir` | List workspace directory contents |
| `execShell` | Execute a shell command (guarded, configurable deny-patterns) |

The `execShell` tool is disabled by default. It must be explicitly enabled in configuration and only runs inside a Docker container.

### MCP (Model Context Protocol)

`nanofleet-agent` includes a full MCP client (`@ai-sdk/mcp` or Mastra's `MCPClient`). External MCP servers are declared in `.mcp.json` or via environment configuration:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "${DATABASE_URL}" }
    }
  }
}
```

MCP tools are auto-discovered and registered alongside built-in tools. Tool names are namespaced: `mcp__github__create_issue`, `mcp__postgres__query`, etc.

### Expose as MCP server

`nanofleet-agent` can also expose itself as an MCP server, making the agent callable from any MCP-compatible client (Cursor, Claude Desktop, other agents).

---

## 8. Scheduling — HEARTBEAT.md

### HEARTBEAT.md

A markdown checklist in the agent's workspace. Processed on a configurable schedule (default: every 30 minutes).

```markdown
## Periodic Tasks
- [ ] Check for new emails and summarize urgent ones
- [ ] Review open GitHub issues and flag blockers
- [ ] Update MEMORY.md if significant events occurred today
```

### Mechanism

1. A scheduler timer fires (configurable interval or cron expression)
2. The agent reads `HEARTBEAT.md`
3. If the file is empty or has no actionable items, the run is skipped (no API call wasted)
4. Otherwise, the agent processes the checklist in a dedicated `heartbeat` session
5. If nothing requires action, the agent responds `HEARTBEAT_OK` silently
6. If action is needed, it executes and optionally notifies via the configured channel

### Heartbeat vs. Cron

| | Heartbeat | Cron |
|---|---|---|
| **Schedule** | Fixed interval (default 30 min) | Flexible cron expression |
| **Session** | Dedicated `heartbeat` session | Isolated per-job session |
| **Context** | Full agent context | Minimal, task-scoped |
| **Output** | Silent or channel notification | Channel notification |
| **Use case** | Recurring ambient awareness | Specific scheduled tasks |

Cron jobs are declared in `cron.json` and persist across restarts:

```json
[
  {
    "name": "morning-briefing",
    "message": "Good morning! Prepare a briefing of today's priorities.",
    "cron": "0 8 * * *",
    "timezone": "Europe/Paris"
  }
]
```

---

## 9. Transport Layer

The agent exposes its capabilities via HTTP/SSE. This is the contract that all channels and external services use.

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/agents` | List registered agents |
| `POST` | `/api/agents/:id/generate` | Single-turn response (JSON) |
| `POST` | `/api/agents/:id/stream` | Streaming response (SSE) |
| `GET` | `/api/agents/:id/memory/threads` | List conversation threads |
| `POST` | `/api/agents/:id/memory/threads` | Create a new thread |

### Message format

```typescript
// Request — POST /api/agents/:id/generate
{
  messages: [{ role: "user", content: "Hello" }],
  threadId: "thread_abc123",      // optional, for session continuity
  resourceId: "user_xyz",         // optional, for memory scoping
}

// Response
{
  text: "Hello! How can I help?",
  threadId: "thread_abc123",
  usage: { promptTokens: 42, completionTokens: 18 }
}
```

### Session isolation

Sessions are scoped by `threadId` + `resourceId`. This prevents context leakage between users, channels, and group conversations.

```
1:1 DM with user alice    → threadId: "dm:alice",          resourceId: "alice"
Group channel "project-x" → threadId: "group:project-x",   resourceId: "group:project-x"
```

---

## 10. Usage & Cost Tracking

Every LLM call returns token usage. The agent tracks this persistently per thread and exposes it via API — useful for monitoring and billing awareness.

### What is tracked

| Metric | Description |
|---|---|
| `promptTokens` | Tokens in the input (system prompt + messages + tools) |
| `completionTokens` | Tokens in the model's response |
| `totalTokens` | Sum of both |
| `cost` | Estimated cost in USD, calculated from model pricing |
| `model` | Model used for this call |
| `timestamp` | When the call was made |

### Cost calculation

Pricing is defined per model in a local price table (updated manually or via a pricing registry). The formula:

```
cost = (promptTokens / 1_000_000 × inputPrice) + (completionTokens / 1_000_000 × outputPrice)
```

Example price table entry:
```json
{
  "claude-sonnet-4-6":   { "input": 3.00,  "output": 15.00 },
  "claude-haiku-4-5":    { "input": 0.80,  "output": 4.00  },
  "gemini-3-flash":      { "input": 0.075, "output": 0.30  }
}
```

If a model is not in the price table, cost is reported as `null` (tokens still tracked).

### Storage

Usage records are stored in LibSQL alongside conversation history:

```
usage
  id           text PK
  threadId     text FK
  model        text
  promptTokens integer
  completionTokens integer
  totalTokens  integer
  cost         real (nullable)
  timestamp    text
```

### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agents/:id/usage` | Total usage + cost for this agent (all time) |
| `GET` | `/api/agents/:id/usage/threads/:threadId` | Usage for a specific conversation |

### Response format

```json
{
  "totalTokens": 84320,
  "totalCost": 0.0412,
  "currency": "USD",
  "byModel": {
    "claude-sonnet-4-6": { "tokens": 80000, "cost": 0.039 },
    "claude-haiku-4-5":  { "tokens": 4320,  "cost": 0.0022 }
  },
  "period": "all-time"
}
```

### In-conversation display

The CLI channel displays a usage summary after each response:

```
Agent: Here is my answer...

[tokens: 342 prompt + 128 completion | cost: $0.0008 | model: claude-sonnet-4-6]
```

Channels can choose to display or suppress this information.

---

## 11. Channels

Channels are **not part of `nanofleet-agent`**. They live in a separate repository: `nanofleet-agent-channels`.

A channel is an adapter that:
1. Receives messages from a platform (Telegram update, Discord event, HTTP webhook...)
2. Normalizes them into the agent's message format
3. Calls `POST /api/agents/:id/stream`
4. Sends the streamed response back to the platform

### Available channels (separate repo)

| Channel | Description |
|---|---|
| `webhook` | Generic HTTP webhook — for websites and custom integrations |
| `cli` | Interactive terminal conversation (included in this repo for dev/testing) |
| `telegram` | Telegram bot adapter |
| `discord` | Discord bot adapter |

### Channel contract

Each channel must implement:
```typescript
interface Channel {
  start(): Promise<void>
  stop(): Promise<void>
  // internal: normalize platform event → agent request → platform response
}
```

The agent has no knowledge of which channel is calling it.

### Multimodal handling in channels

Channels handle media conversion before forwarding to the agent:

| Media | Conversion | Tool |
|---|---|---|
| Voice message | Audio → text (STT) | Whisper (Groq/OpenAI) |
| Image | Passed as-is if model supports vision | Base64 / URL |
| Document/PDF | Extracted text | Channel-specific |
| Agent response → voice | Text → audio (TTS) | ElevenLabs / OpenAI TTS |

The agent core sees only text and images — never raw audio or binary files.

### Proactive notifications

Channels can receive proactive messages from the agent (heartbeat results, scheduled task output) without the user having to send a message first.

**Mechanism:**

The agent exposes a long-lived SSE endpoint:

```
GET /api/agents/:id/notifications/stream
```

A channel connects to this stream at startup and stays subscribed. When the agent emits a notification (e.g. a heartbeat run that produced actionable output), it is forwarded to the channel which delivers it to the configured recipient.

**Agent side — `NotificationEmitter`:**

An internal `EventEmitter` singleton. Any part of the agent (heartbeat, cron, tools) can call `notificationEmitter.notify(text)` to emit a notification. If no channel is connected, the notification is dropped and logged.

**Channel side:**

Each channel decides how to deliver the notification (Telegram DM, Discord message, etc.) and to whom (configured via `NOTIFICATION_USER_ID` or equivalent). Delivery target is channel-specific configuration — the agent has no knowledge of it.

**Behavior when no channel is connected:**

```
[notification] No channel connected, notification dropped: <text>
```

The agent continues normally. Notifications are fire-and-forget — no persistence, no retry.

**Heartbeat notification flow:**

```
HEARTBEAT.md has unchecked items
    → agent.generate(heartbeat prompt)
    → response is NOT "HEARTBEAT_OK"  (agent took action or has something to report)
    → notificationEmitter.notify(response text)
    → SSE stream → channel → user
```

If the agent responds with `HEARTBEAT_OK`, no notification is emitted.

---

## 12. Multi-Agent & Group Chat

### Standalone multi-agent

Multiple `nanofleet-agent` instances (one per container) can collaborate. Each agent is autonomous and exposes its own HTTP endpoints. Coordination happens at the channel level, not inside the agent core.

### Group chat model

A group conversation involves multiple agents and one or more humans in a shared message thread. The channel manages turn-taking.

**Routing modes:**

| Mode | Trigger | Behavior |
|---|---|---|
| `@mention` | `@agent-name` in message | Routes directly to named agent |
| `broadcast` | No mention | All agents in group receive the message |
| `moderator` | No mention, moderator configured | Moderator decides which agent(s) respond |

**Moderator pattern:**

One agent in the group is designated `moderator: true`. It:
- Always receives messages (`requireMention: false`)
- Decides which other agents to involve (via @mention in its response)
- Prevents ping-pong loops (`agent-to-agent limit` configurable)
- Can synthesize responses from multiple specialists before replying

**Loop prevention:**
- Configurable `maxAgentTurns` per group session
- `requireMention: true` for non-moderator agents by default
- Agent responses containing only `@mentions` without user-facing content do not reset the turn counter

**Shared context:**

All agents in a group share the same `threadId`, so each agent reads the full conversation history (including other agents' messages) when it responds.

```
Group thread messages: [
  { author: "human",     content: "How do we scale this API?" },
  { author: "agent-perf", content: "I'd recommend Redis caching..." },
  { author: "agent-arch", content: "With Redis, consider consistency..." },
  { author: "human",     content: "@agent-sec what's the security angle?" },
  { author: "agent-sec", content: "The main concern is..." },
]
```

### Concrete example — Discord multi-agent setup

**Setup:** a Discord server with a `#project-x` channel. Three agents are deployed:

| Agent | Role | Model | `requireMention` |
|---|---|---|---|
| `mod` | Moderator — orchestrates, always active | claude-sonnet-4-6 | false |
| `perf` | Performance specialist | claude-haiku-4-5 | true |
| `sec` | Security specialist | claude-haiku-4-5 | true |

The Discord channel adapter connects to all three agents and knows the group config.

---

**Scenario: a user asks a general question**

```
[Discord #project-x]
alice: How do we scale this API to handle 10x traffic?
```

**Step 1 — Discord adapter receives the event**

The Discord adapter receives a `messageCreate` event. No `@mention` of a specific agent → moderator mode. It calls:

```
POST http://agent-mod:4111/api/agents/mod/stream
{
  "messages": [{ "role": "user", "content": "How do we scale this API to handle 10x traffic?" }],
  "threadId": "discord:project-x",
  "resourceId": "discord:project-x",
  "author": "alice"
}
```

**Step 2 — Moderator decides who responds**

`agent-mod` sees the question and decides it needs the performance specialist. Its response (internal, not shown to Discord):

```
This question is about scaling — @perf should handle this.
```

The adapter detects `@perf` in the moderator's response and calls:

```
POST http://agent-perf:4111/api/agents/perf/stream
{
  "messages": [
    { "role": "user",      "content": "How do we scale this API to handle 10x traffic?" },
    { "role": "assistant", "content": "[mod]: This question is about scaling — @perf should handle this." }
  ],
  "threadId": "discord:project-x",
  "resourceId": "discord:project-x"
}
```

**Step 3 — Specialist responds**

`agent-perf` sees the full thread (including mod's routing decision) and responds with the actual answer. The adapter streams this response back to Discord:

```
[Discord #project-x]
perf: I'd recommend starting with horizontal scaling + Redis caching for your read-heavy endpoints.
      Here's a breakdown: [...]
```

---

**Scenario: a user directly mentions an agent**

```
[Discord #project-x]
bob: @sec what's the security risk of exposing the internal metrics endpoint?
```

The adapter detects `@sec` → skips the moderator entirely, calls `agent-sec` directly:

```
POST http://agent-sec:4111/api/agents/sec/stream
{
  "messages": [
    ...full thread history...,
    { "role": "user", "content": "@sec what's the security risk of exposing the internal metrics endpoint?" }
  ],
  "threadId": "discord:project-x",
  "resourceId": "discord:project-x"
}
```

`agent-sec` responds directly to Discord. The moderator is not involved.

---

**Sequence diagram (moderator mode)**

```
Discord        Adapter        agent-mod       agent-perf       Discord
  │                │               │               │               │
  │─ messageCreate ──▶             │               │               │
  │                │─ POST /stream ─▶              │               │
  │                │               │ (decides @perf)              │
  │                │◀─ SSE: @perf ─┤               │               │
  │                │─ POST /stream ─────────────────▶              │
  │                │               │               │ (generates)   │
  │                │◀─ SSE: answer ─────────────────┤              │
  │                │──────────────────────────────────── message ──▶
```

---

**What the agent core does NOT know**

- That the caller is Discord (could be Telegram, a webhook, or a CLI)
- Which other agents exist (that's the adapter's routing config)
- How many users are in the channel

The agent core only receives a `messages[]` array with a `threadId`. All orchestration logic lives in the channel adapter.

---

## 13. Multimodal

### Vision (images)

Supported natively for vision-capable models (Claude, Gemini, GPT-4o). Images are passed as base64 or URL in the message content. No special agent configuration required.

### Voice (speech)

Speech processing is handled by channels, not the agent core:

- **STT (input):** Channel transcribes audio → agent receives text
- **TTS (output):** Channel converts agent text response → audio

Default STT provider: Whisper via Groq (fast, cheap).
Default TTS provider: configurable (OpenAI TTS, ElevenLabs, Kokoro OSS).

### Real-time voice

Full duplex real-time voice (no push-to-talk) requires a dedicated voice channel using models like GPT-4o Realtime or Gemini Live. This is a separate channel implementation and is not part of the initial scope.

---

## 14. Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| **Runtime** | Bun | Compatible with Mastra, fast, TypeScript-native |
| **Language** | TypeScript | Type safety, ecosystem |
| **Agent framework** | Mastra (`@mastra/core`) | Built-in memory, MCP, multi-agent, workflows, Studio |
| **LLM routing** | Mastra Model Router + Vercel AI SDK | 600+ models, provider-agnostic |
| **Memory storage** | LibSQL (SQLite) | Zero-config default, file-based |
| **Vector store** | LibSQL Vector | Same DB, no extra infra |
| **HTTP server** | Mastra built-in (Hono) | Auto-exposes agent endpoints |
| **Containerization** | Docker | Isolation, portable deployment |
| **MCP client** | `@mastra/mcp` | Full spec support, OAuth, auto-discovery |

### Supported LLM providers (via Mastra Model Router)

Any provider supported by the Vercel AI SDK or Mastra's model registry:
- Anthropic (Claude Haiku, Sonnet, Opus)
- Google (Gemini Flash, Pro)
- OpenRouter (600+ models, including Qwen, Llama, Mistral, DeepSeek...)
- vLLM (local/self-hosted)
- Any OpenAI-compatible endpoint

---

## 15. Repository Structure

```
nanofleet-agent/
├── src/
│   ├── index.ts              ← entry point
│   ├── agent.ts              ← Mastra agent definition
│   ├── mastra.ts             ← Mastra instance + server config
│   ├── memory/
│   │   ├── index.ts          ← memory layer (Mastra + MEMORY.md/HISTORY.md)
│   │   └── consolidation.ts  ← MEMORY.md consolidation logic
│   ├── skills/
│   │   └── loader.ts         ← skill scanner and system prompt injector
│   ├── scheduling/
│   │   ├── heartbeat.ts      ← HEARTBEAT.md processor
│   │   └── cron.ts           ← cron job manager
│   ├── tools/
│   │   ├── index.ts          ← tool registry
│   │   ├── web.ts            ← webSearch, webFetch
│   │   ├── filesystem.ts     ← readFile, writeFile, editFile, listDir
│   │   └── shell.ts          ← execShell (disabled by default)
│   └── mcp/
│       └── client.ts         ← MCP server connections
├── workspace/                ← agent workspace (mounted volume in Docker)
│   ├── SOUL.md
│   ├── STYLE.md
│   ├── MEMORY.md
│   ├── HISTORY.md
│   ├── HEARTBEAT.md
│   ├── AGENTS.md
│   ├── skills/
│   └── cron.json
├── .mcp.json                 ← MCP server declarations
├── Dockerfile
├── docker-compose.yml
├── package.json
└── SPECIFICATIONS.md
```

---

## 16. Configuration

Configuration via environment variables and/or a `config.json` file.

### Environment variables

```bash
# LLM Provider (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...
OPENROUTER_API_KEY=sk-or-...

# Agent
AGENT_MODEL=claude-haiku-4-5          # default model
AGENT_WORKSPACE=/workspace            # path to workspace directory

# Memory
MEMORY_DB_PATH=/workspace/.db/agent.db
MEMORY_LAST_MESSAGES=20               # conversation history window
MEMORY_CONSOLIDATION_THRESHOLD=50     # messages before MEMORY.md consolidation

# Server
PORT=4111

# Scheduling
HEARTBEAT_INTERVAL=1800               # seconds (default: 30 min)
HEARTBEAT_ENABLED=true

# Shell tool (disabled by default)
SHELL_TOOL_ENABLED=false
SHELL_DENY_PATTERNS=rm -rf /,dd if=  # comma-separated dangerous patterns
```

### config.json (optional)

Fine-grained configuration that overrides env vars. Useful for multi-agent setups.

---

## 17. Deployment

### Standalone (Docker)

```bash
docker run -d \
  -v ./workspace:/workspace \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e AGENT_MODEL=claude-haiku-4-5 \
  -p 4111:4111 \
  nanofleet-agent
```

### Docker Compose (standalone)

```yaml
services:
  agent:
    image: nanofleet-agent
    volumes:
      - ./workspace:/workspace
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - AGENT_MODEL=claude-sonnet-4-6
    ports:
      - "4111:4111"
    restart: unless-stopped
```

### Multi-agent setup

Deploy multiple agent containers with different workspace directories and model configurations. A channel (Discord, webhook...) routes messages to the appropriate agent endpoint based on its routing configuration.

```yaml
services:
  agent-perf:
    image: nanofleet-agent
    volumes:
      - ./workspaces/perf:/workspace
    environment:
      - AGENT_MODEL=claude-sonnet-4-6

  agent-arch:
    image: nanofleet-agent
    volumes:
      - ./workspaces/arch:/workspace
    environment:
      - AGENT_MODEL=claude-sonnet-4-6

  agent-sec:
    image: nanofleet-agent
    volumes:
      - ./workspaces/sec:/workspace
      - AGENT_MODEL=claude-haiku-4-5
```

---

---

## 18. Prompt Caching

Prompt caching is a prefix-match mechanism — the API reuses computation from previous requests as long as the prefix is identical. A single unexpected change anywhere in the prefix invalidates the entire cache downstream. This section documents the constraints and design decisions made to maximize cache hit rate.

### System prompt ordering

The system prompt is assembled in static-first, dynamic-last order to maximize shared prefixes across sessions:

```
1. Core instructions      ← never changes
2. SOUL.md                ← changes only when user edits it
3. STYLE.md               ← changes only when user edits it
4. MEMORY.md              ← changes only at consolidation
5. Skills metadata        ← stable after startup (alphabetical, fixed set)
6. AGENTS.md              ← loaded only in multi-agent context
7. Conversation messages  ← dynamic, always last
```

### Tools are frozen at session start

Tool definitions (built-in + MCP) are resolved once when the session starts and never change mid-session. Adding or removing a tool invalidates the entire cached prefix.

- MCP servers are discovered at startup. If an MCP server becomes unavailable mid-session, its tools remain in the definition set (marked unavailable) rather than being removed.
- Skills are scanned at startup. Skills installed after a session has started take effect in the next session.

### Dynamic updates via `<system-reminder>`

When runtime information needs to be updated (current time, file changes, heartbeat results), it is injected as a `<system-reminder>` block in the next user message — not by modifying the system prompt. This preserves the cached prefix.

```
user message:
  <system-reminder>It is now Wednesday 2026-02-26 14:32 UTC</system-reminder>
  What should I focus on today?
```

### Model changes mid-session

Prompt caches are model-specific. Switching models mid-session invalidates the cache entirely — all tokens in the new model's first request are billed at full price regardless of what was cached before.

This is a deliberate trade-off: The agent supports model override mid-session for flexibility, but users should be aware of the cost implication. When a model change is detected, the agent logs a cache-miss warning and resets the usage tracking for that session.

For sub-tasks on cheaper models (e.g., Haiku for a lightweight query), use a **sub-agent with a handoff message** rather than switching the main session model. This keeps both caches intact.

### Consolidation (compaction) is cache-safe

When MEMORY.md consolidation runs, it reuses the exact same system prompt, tool definitions, and message history as the parent session — with only the consolidation prompt appended as a new user message. This ensures the parent's cached prefix is reused for the compaction call rather than rebuilding it from scratch.

### Skills metadata stability

Skill names and descriptions are injected in **alphabetical order** and must be stable across requests in the same session. Compatibility checks happen at startup only — a skill that fails compatibility is excluded before the first request and stays excluded for the session.

### Cache hit rate monitoring

The agent tracks and exposes cache hit rate via the usage API:

```json
{
  "cacheReadTokens": 45000,
  "cacheWriteTokens": 3200,
  "cacheHitRate": 0.93
}
```

A hit rate below 0.7 for a steady-state session indicates a structural issue (unstable prefix, tool churn, etc.) and should be investigated.

---

*This document covers `nanofleet-agent` core only. Channel adapters are specified in `nanofleet-agent-channels`.*
