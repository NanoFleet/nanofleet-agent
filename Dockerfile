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

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:4111/health').then(r=>process.exit(r.ok?0:1))"

CMD ["bun", "src/index.ts"]
