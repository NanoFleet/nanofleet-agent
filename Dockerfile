FROM oven/bun:1.3-debian AS base

WORKDIR /app

FROM base AS install

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

FROM base AS builder

COPY --from=install /app/node_modules ./node_modules
COPY . .

FROM base AS runner

ARG AGENT_VERSION=dev
LABEL com.nanofleet.agent-version=${AGENT_VERSION}

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src

RUN mkdir -p /workspace

EXPOSE 4111

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4111/health || exit 1

CMD ["bun", "src/index.ts"]
