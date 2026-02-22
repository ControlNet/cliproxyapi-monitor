FROM node:20-alpine AS base

WORKDIR /app

RUN corepack enable

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

FROM base AS builder

WORKDIR /app
ENV DATABASE_URL=postgresql://postgres:cliproxy@postgres:5432/cliproxy
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY . .

RUN pnpm run build:app

FROM base AS runner

ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://postgres:cliproxy@postgres:5432/cliproxy
WORKDIR /app

COPY --from=builder /app/.next .next
COPY --from=builder /app/package.json package.json
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/drizzle /app/drizzle
COPY --from=builder /app/scripts /app/scripts

RUN chmod +x /app/scripts/start-dashboard.sh

EXPOSE 3000
CMD ["sh", "/app/scripts/start-dashboard.sh"]
