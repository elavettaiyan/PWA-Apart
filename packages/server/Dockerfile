# ── Stage 1: Install production dependencies ─────────────
FROM node:20-slim AS deps

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY prisma ./prisma/

RUN npm install --omit=dev && npx prisma@5.22.0 generate

# ── Stage 2: Build TypeScript ────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json ./
COPY prisma ./prisma/
RUN npm install

COPY tsconfig.json ./
COPY src ./src/

RUN npx prisma@5.22.0 generate && npm run build

# ── Stage 3: Production image ────────────────────────────
FROM node:20-slim AS runner

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

RUN mkdir -p uploads

EXPOSE ${PORT:-4000}

CMD ["node", "dist/index.js"]
