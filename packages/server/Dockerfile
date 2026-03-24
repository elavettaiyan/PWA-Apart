# ── Stage 1: Install dependencies ────────────────────────
FROM node:20-slim AS deps

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --omit=dev && npx prisma@5.22.0 generate

# ── Stage 2: Build TypeScript ────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci

COPY tsconfig.json ./
COPY src ./src/

RUN npx prisma@5.22.0 generate && npm run build

# ── Stage 3: Production image ────────────────────────────
FROM node:20-slim AS runner

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Copy production node_modules (with generated Prisma client)
COPY --from=deps /app/node_modules ./node_modules
# Copy compiled JS
COPY --from=builder /app/dist ./dist
# Copy Prisma schema (needed at runtime for some Prisma features)
COPY --from=builder /app/prisma ./prisma
# Copy package.json for metadata
COPY package.json ./

# Create uploads directory
RUN mkdir -p uploads

EXPOSE ${PORT:-4000}

CMD ["node", "dist/index.js"]
