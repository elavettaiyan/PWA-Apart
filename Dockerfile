# ── Stage 1: Install production dependencies ─────────────
FROM node:20-slim AS deps

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/ ./packages/

RUN npm install --omit=dev --workspace=@pwa-apart/server && npx prisma@5.22.0 generate --schema=packages/server/prisma/schema.prisma

# ── Stage 2: Build TypeScript ────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/ ./packages/

RUN npm install --workspace=@pwa-apart/server

RUN npx prisma@5.22.0 generate --schema=packages/server/prisma/schema.prisma && npm run build --workspace=@pwa-apart/server

# ── Stage 3: Production image ────────────────────────────
FROM node:20-slim AS runner

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/server/package.json ./packages/server/package.json
COPY packages/server/prisma ./packages/server/prisma/
COPY packages/server/start.sh ./packages/server/start.sh
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/dist ./packages/server/dist

RUN mkdir -p packages/server/uploads && chmod +x packages/server/start.sh

EXPOSE ${PORT:-4000}

CMD ["./packages/server/start.sh"]
