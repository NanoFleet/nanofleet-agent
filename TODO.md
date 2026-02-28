# nanofleet-agent — TODO

> Implementation checklist derived from [SPECIFICATIONS.md](./SPECIFICATIONS.md).
> Work through phases in order — each phase builds on the previous.

---

## Phase 0 — Project bootstrap

- [x] Create `nanofleet-agent/` repository
- [x] Initialize `package.json` with Bun (`bun init`)
- [x] Add core dependencies: `@mastra/core`, `@mastra/mcp`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@openrouter/ai-sdk-provider`, `ai`, `libsql`
- [x] Configure `tsconfig.json` (strict, ESM, Bun target)
- [x] Create `Dockerfile` (Bun base image)
- [x] Create `docker-compose.yml` (single agent, workspace volume, port 4111)
- [x] Create `.env.example` with all env vars from §16
- [x] Create `.gitignore` (node_modules, .env, workspace/.db/)
- [x] Create empty workspace scaffold: `SOUL.md`, `STYLE.md`, `MEMORY.md`, `HISTORY.md`, `HEARTBEAT.md`, `AGENTS.md`, `cron.json`, `skills/`
- [x] Create `.mcp.json` with commented-out example servers

---

## Phase 1 — Core agent (minimal working loop) - 81 loc

### 1.1 Mastra instance

- [x] Create `src/mastra.ts` — Mastra instance with HTTP server on `PORT` (default 4111)
- [x] Expose `GET /health` endpoint returning `{ status: "ok" }`
- [x] Expose `GET /api/agents` endpoint listing registered agents

### 1.2 Agent definition

- [x] Create `src/agent.ts` — basic Mastra agent with:
  - [x] Model loaded from `AGENT_MODEL` env var
  - [x] System prompt: SOUL.md + STYLE.md (if present) + MEMORY.md (first 200 lines)
  - [x] `POST /api/agents/:id/generate` — single-turn JSON response
  - [x] `POST /api/agents/:id/stream` — SSE streaming response

### 1.3 Entry point

- [x] Create `src/index.ts` — imports and starts Mastra server
- [x] Verify `bun run src/index.ts` starts without error
- [x] Verify `POST /api/agents/main/generate` returns a response

---

## Phase 2 — Identity layer - 181 loc

- [x] Create `src/identity/loader.ts` — reads SOUL.md, STYLE.md, MEMORY.md from `AGENT_WORKSPACE`
- [x] Implement system prompt assembly in static-first order (§18):
  1. Core instructions
  2. SOUL.md
  3. STYLE.md (if present)
  4. MEMORY.md (first 200 lines)
  5. Skills metadata placeholder (empty for now)
  6. AGENTS.md (if present)
- [x] Write default `workspace/SOUL.md` template (name, worldview, opinions, interests sections)
- [x] Write default `workspace/STYLE.md` template
- [x] Test: edit SOUL.md, restart, verify system prompt reflects changes

---

## Phase 3 — Memory layer - 391 loc

### 3.1 Mastra memory (conversation + working memory)

- [x] Create `src/memory/index.ts` — Mastra Memory instance with LibSQL backend
- [x] Configure `MEMORY_DB_PATH` → LibSQL file path
- [x] Configure `lastMessages` window from `MEMORY_LAST_MESSAGES` env var
- [x] Attach memory to agent in `src/mastra.ts`
- [x] Add `GET /api/agents/:id/memory/threads` — list conversation threads
- [x] Add `POST /api/agents/:id/memory/threads` — create a new thread
- [x] Verify: multi-turn conversation maintains context across requests (same `threadId`)

### 3.2 Working memory

- [x] Enable Mastra working memory (structured facts)
- [x] Define working memory schema: name, preferences, ongoing projects
- [x] Verify: agent can update working memory within a session

### 3.3 Semantic recall (vector search)

- [x] Enable LibSQL vector extension
- [x] Configure Mastra semantic recall (top-K retrieval)
- [x] Verify: past conversation excerpts are retrieved on relevant queries

### 3.4 MEMORY.md consolidation

- [x] Create `src/memory/consolidation.ts`
- [x] Implement consolidation trigger: when `messages > MEMORY_CONSOLIDATION_THRESHOLD`
- [x] Consolidation LLM call: reads MEMORY.md + last N messages → updated MEMORY.md content
- [x] Write updated MEMORY.md to workspace
- [x] Append timestamped summary entry to HISTORY.md
- [x] Track `lastConsolidated` pointer to avoid re-processing
- [x] Verify: after 50+ messages, MEMORY.md is updated and HISTORY.md receives a new entry

--- Fix & improvements - 358 loc

## Phase 4 — Tools - 609 loc

### 4.1 Web tools

- [x] Create `src/tools/web.ts`
- [x] Implement `webSearch` — provider-native routing:
  - Anthropic: `anthropic.tools.webSearch_20250305`
  - Google: `google.tools.googleSearch`
  - OpenRouter: `:online` suffix on model ID
- [x] Implement `webFetch` — fetch URL, return readable text (HTML stripped)

### 4.2 Filesystem tools

- [x] Create `src/tools/filesystem.ts`
- [x] Implement `readFile` — reads a file relative to workspace
- [x] Implement `writeFile` — writes/creates a file in workspace
- [x] Implement `editFile` — string-patch with near-match feedback (fuzzy diff)
- [x] Implement `listDir` — list directory contents (recursive option)

### 4.3 Shell tool

- [x] Create `src/tools/shell.ts`
- [x] Implement `execShell` — runs a shell command
- [x] Implement deny-pattern check from `SHELL_DENY_PATTERNS` env var
- [x] Gate behind `SHELL_TOOL_ENABLED=true` — tool not registered if disabled
- [x] Add Docker-only guard (warn if not running in container)

### 4.4 Tool registry

- [x] Create `src/tools/index.ts` — assembles tool set based on config
- [x] Attach tool registry to agent
- [x] Freeze tool definitions at session start (§18)

---

## Phase 5 — MCP client - 684 loc

- [x] Create `src/mcp/client.ts` — reads `.mcp.json`, connects to declared servers
- [x] Auto-discover and register MCP tools alongside built-in tools
- [x] Namespace MCP tools: `serverName_toolName`
- [x] Handle MCP server unavailability gracefully (mark tools unavailable, don't remove)
- [x] Add example `.mcp.json` with commented github + postgres entries
- [ ] Verify: MCP tool from a local test server is callable by the agent

### Expose as MCP server (optional, stretch)

- [ ] Expose `nanofleet-agent` itself as an MCP server endpoint
- [ ] Implement `agent_generate` and `agent_stream` as MCP tools

---

## Phase 6 — Skills - 828 loc

- [x] Create `src/skills/loader.ts`
- [x] Scan `workspace/skills/` at startup, parse YAML frontmatter from each `SKILL.md`
- [x] Run compatibility checks (binary/env var requirements from frontmatter)
- [x] Inject skills metadata as XML into system prompt (alphabetical, stable order)
- [x] Implement skill activation: when agent identifies a needed skill, load full `SKILL.md` into context
- [x] Verify: agent lists available skills, activates one on demand

---

## Phase 7 — Scheduling - 872 loc

### 7.1 HEARTBEAT.md

- [X] Create `src/scheduling/heartbeat.ts`
- [X] Implement heartbeat timer (interval from `HEARTBEAT_INTERVAL`, default 1800s)
- [X] Read `HEARTBEAT.md` at each tick
- [X] Skip if file is empty or has no actionable items (no API call)
- [X] Process checklist in a dedicated `heartbeat` session (`threadId: heartbeat:main`, `resourceId: heartbeat`) — isolated from user conversations
- [X] Respond `HEARTBEAT_OK` silently if nothing to do
- [X] Emit notification via `notificationEmitter` if response is not `HEARTBEAT_OK`
- [X] Write default `workspace/HEARTBEAT.md` template
- [ ] Verify: heartbeat fires, skips when empty, processes a task when items are present

### 7.2 Cron jobs

- [ ] Create `src/scheduling/cron.ts`
- [ ] Read `workspace/cron.json` at startup
- [ ] Schedule each job using a cron library
- [ ] Support `timezone` field per job
- [ ] Persist job state across restarts (last-run timestamp in LibSQL)
- [ ] Write default `workspace/cron.json` with commented example
- [ ] Verify: a cron job fires at the scheduled time

---

## Phase 8 — Usage & cost tracking - 1099 loc

- [x] Create `src/usage/tracker.ts`
- [x] Define LibSQL `usage` table schema (§10)
- [x] Extract `promptTokens`, `completionTokens`, `totalTokens` from every LLM call
- [x] Compute `cost` from local price table (`src/usage/prices.ts`)
- [x] Store usage record per LLM call in LibSQL
- [x] Write `src/usage/prices.ts` with initial price table (Claude, Gemini, MiniMax)
- [x] Handle unknown models: `cost = null`, tokens still tracked
- [x] Add `GET /api/agents/:id/usage` — total usage + cost (all-time)
- [x] Add `GET /api/agents/:id/usage/threads/:threadId` — per-thread usage
- [x] Track `cacheReadTokens` and `cacheWriteTokens` for prompt caching stats
- [x] Expose `cacheHitRate` in usage response
- [ ] Log cache-miss warning when model changes mid-session
- [x] Verify: usage records accumulate correctly after multiple conversations

---

## Phase 9 — CLI channel (dev/testing) - 1193 loc

> The CLI channel lives in this repo for development convenience. Production channels live in `nanofleet-agent-channels`.

- [x] Create `src/channels/cli.ts`
- [x] Implement Bun stdin reader (line-by-line, `Bun.stdin.stream()`)
- [x] Display `You:` prompt, read input, send to agent via HTTP
- [x] Stream SSE response and print to stdout
- [x] Display usage summary after each response: `[tokens: X prompt + Y completion | cost: $Z | model: M]`
- [x] Handle `exit` / `quit` / null (EOF) / SIGINT cleanly
- [x] Add `--cli` flag to `src/index.ts` to launch CLI channel instead of HTTP server
- [x] Verify: full conversation in CLI with usage display

---

## Phase 10 — Prompt caching optimization - 1274 loc

- [x] Audit system prompt assembly — confirm static-first order is maintained
- [x] Confirm tools are frozen at session start (no mid-session additions/removals)
- [x] Implement `<system-reminder>` injection pattern for dynamic updates (current time, file changes)
- [x] Log cache-miss warning when model changes mid-session
- [x] Verify `cacheHitRate` reported in usage API is > 0.7 for steady-state session

--- Fix & improvements - 1312 loc

## Phase 11 — Docker & deployment

- [x] Finalize `Dockerfile` (multi-stage: build → runtime)
- [x] Add healthcheck to `Dockerfile` (`GET /health`)
- [x] Finalize `docker-compose.yml` (workspace volume, env file, restart policy)
- [x] Test: `docker compose up` → agent responds via HTTP
- [x] Test: workspace files persist across container restarts

## Phase 12 — Proactive notifications (§7)

- [X] Create `src/notifications/emitter.ts` — `NotificationEmitter` singleton (typed EventEmitter)
- [X] Implement `notify(text, source?)` — emits or logs "dropped" if no listener
- [X] Add `GET /api/agents/:id/notifications/stream` SSE endpoint — long-lived, keep-alive every 30s, cleanup on disconnect
- [X] Wire heartbeat to emit via `notificationEmitter` when response is not `HEARTBEAT_OK`
- [ ] Wire cron jobs to emit via `notificationEmitter` on completion (when implemented)

---

## Phase 13 — Multi-agent support

- [ ] Add `AGENTS.md` loading to identity layer (§4)
- [ ] Write `workspace/AGENTS.md` template
- [ ] Implement session isolation: `threadId` + `resourceId` scoping (§9)
- [ ] Implement `@mention` routing logic (channel-side, documented for channel implementors)
- [ ] Document moderator pattern contract for channel implementors
- [ ] Verify: two agent instances share a `threadId` correctly; each sees full conversation history

---

## Phase 14 — Multimodal

- [ ] Verify vision works: pass base64 image in message content, model responds about it
- [ ] Document STT/TTS contract for channel implementors (§13)
- [ ] Add Whisper (Groq) integration example to channel docs

---

## Polish & documentation

- [ ] Write `README.md` with quick-start (Docker + env vars)
- [ ] Document all env vars (from §16)
- [ ] Document `.mcp.json` format
- [ ] Document `cron.json` format
- [ ] Document `SKILL.md` frontmatter schema
- [ ] Write `CONTRIBUTING.md`
- [ ] Add OpenAPI spec for HTTP endpoints (or auto-generate via Mastra/Hono)
- [ ] Add basic test suite (vitest or Bun test):
  - [ ] Identity loader unit tests
  - [ ] Memory consolidation logic
  - [ ] Cost calculation from price table
  - [ ] Tool deny-pattern check
  - [ ] Skill loader (frontmatter parsing)
  - [ ] Heartbeat skip logic (empty file)

---

## Backlog / future

- [x] `nanofleet-agent-channels` repo: Telegram adapter (thread persistence via `threads.json`, `/new` command, notification forwarding via `NOTIFICATION_USER_ID`)
- [ ] `nanofleet-agent-channels` repo: Discord adapter (subscribe to `/notifications/stream` at startup)
- [ ] `nanofleet-agent-channels` repo: generic webhook adapter
- [ ] Real-time voice channel (GPT-4o Realtime / Gemini Live)
- [ ] Agent self-update: allow agent to install new skills at runtime
- [ ] Multi-tenant mode: multiple users per agent instance (resourceId isolation)
- [ ] Mastra Studio UI: enable at `/studio` for local dev
- [ ] MCP server exposure: nanofleet-agent as MCP server (§7)
- [ ] Pricing registry auto-update (pull from upstream source periodically)
- [ ] Model override mid-session with cache-miss cost warning shown to user

---

*Phases 0–4 are the critical path to a working agent. Phases 5–8 add the features that differentiate nanofleet-agent. Phases 9–14 are production-readiness.*
