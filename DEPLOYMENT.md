# Deployment Guide — PWA-Apart

## Prerequisites

- GitHub account
- Vercel account (free tier works)
- PostgreSQL database for production (e.g., Neon, Supabase, Railway, or Vercel Postgres)

---

## 1. Push to GitHub

```bash
# Initialize git (if not already)
git init

# Stage all files
git add .

# Initial commit
git commit -m "Initial commit: Apartment Management PWA"

# Create repo on GitHub, then add remote
git remote add origin https://github.com/YOUR_USERNAME/PWA-Apart.git

# Push
git branch -M main
git push -u origin main
```

---

## 2. Set Up PostgreSQL Database

The app uses PostgreSQL. You need a production database.

Recommended free-tier providers:
- **Neon** (neon.tech) — generous free tier, serverless
- **Supabase** (supabase.com) — free tier with dashboard
- **Railway** (railway.app) — easy setup
- **Vercel Postgres** — integrated with Vercel

You'll get a connection string like:
```
postgresql://user:password@host:5432/dbname?sslmode=require
```

### Run Migrations on Production DB

```bash
DATABASE_URL="your-postgres-url" npx prisma migrate deploy
DATABASE_URL="your-postgres-url" npx prisma db seed
```

---

## 3. Deploy Frontend to Vercel

### 3a. Import Project

1. Go to [vercel.com](https://vercel.com) → "New Project"
2. Import your GitHub repo
3. Set **Root Directory** to `packages/client`
4. Framework Preset: **Vite**

### 3b. Environment Variables

Add in Vercel dashboard → Settings → Environment Variables:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://your-backend-url.vercel.app/api` |

### 3c. Build Settings

- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

---

## 4. Deploy Backend to Vercel (Serverless)

### 4a. Create Separate Vercel Project for Backend

1. Vercel → "New Project" → same GitHub repo
2. Set **Root Directory** to `packages/server`

### 4b. Environment Variables

Add in Vercel dashboard:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `DIRECT_URL` | `postgresql://user:pass@direct-host:5432/db?sslmode=require` |
| `JWT_SECRET` | (generate a strong 64-char random string) |
| `JWT_REFRESH_SECRET` | (generate another strong 64-char random string) |
| `PHONEPE_MERCHANT_ID` | Your PhonePe Merchant ID |
| `PHONEPE_SALT_KEY` | Your PhonePe Salt Key |
| `PHONEPE_SALT_INDEX` | `1` |
| `PHONEPE_ENV` | `PRODUCTION` |
| `CLIENT_URL` | `https://your-frontend.vercel.app` |
| `NODE_ENV` | `production` |

### 4c. Build Settings

- **Build Command:** `npm run vercel-build`
- **Output Directory:** `dist`

`npm run vercel-build` now runs `prisma generate` by default and skips database migrations to avoid deploy-time failures from inconsistent migration states.

If you want to run migrations during build, set `RUN_PRISMA_MIGRATIONS=1` in Vercel. In that mode, it runs a safe migration flow: execute `prisma migrate deploy`, recover known failed migration states, and retry once.

By default, the auto-recovery targets migration `20260317130000_multi_society_membership`. You can override this with environment variable `PRISMA_FAILED_MIGRATION_NAME` in Vercel when recovering a different migration.

Recovery mode defaults to `auto`, which tries:

- resolve as `rolled-back` and retry deploy
- if that still fails (including duplicate object/column cases), resolve as `applied` and retry deploy

If a migration was partially applied manually (for example, deploy fails with `column \"activeSocietyId\" already exists`), set:

- `PRISMA_FAILED_MIGRATION_NAME=20260317130000_multi_society_membership`
- `PRISMA_FAILED_MIGRATION_RESOLVE_MODE=applied`

This marks that migration as applied (skips re-running its SQL) and lets `prisma migrate deploy` continue with newer migrations.

Prisma CLI reads `DATABASE_URL` directly during build-time migration. If your Vercel project currently only has `APART_EASE_POSTGRES_PRISMA_URL`, the deploy script now maps it to `DATABASE_URL` automatically before running `migrate deploy`.

For Supabase and similar providers, use `DIRECT_URL` for migrations (direct Postgres host/port `5432`). Pooled URLs (often port `6543`) can stall or fail for schema migration/DDL operations.

If your Vercel backend project was created before this change, verify these two points in the Vercel dashboard:

- Root Directory is `packages/server`
- Build Command is `npm run vercel-build`

If the project is still using old cached settings, redeploy after saving the updated Build Command once in the dashboard.

---

## 5. Deploy Backend to Railway

Railway runs the server as a persistent process (not serverless), which is better for WebSockets, long-running tasks, and consistent cold-start-free performance.

### 5a. Create Railway Project

1. Go to [railway.app](https://railway.app) → **"New Project"**
2. Select **"Deploy from GitHub repo"** → choose this repo
3. In Service Settings → set **Root Directory** to `packages/server`

### 5b. Add a PostgreSQL Database

1. In the Railway project, click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway auto-injects `DATABASE_URL` into your service when you link them
3. Click your server service → **Variables** → verify `DATABASE_URL` is linked (a reference variable like `${{Postgres.DATABASE_URL}}`)

### 5c. Environment Variables

Add these in your Railway service → **Variables** tab:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | (auto-injected if Railway Postgres is linked) |
| `JWT_SECRET` | (generate a strong 64-char random string) |
| `JWT_REFRESH_SECRET` | (generate another strong 64-char random string) |
| `NODE_ENV` | `production` |
| `CLIENT_URL` | `https://your-frontend.vercel.app` |
| `PHONEPE_MERCHANT_ID` | Your PhonePe Merchant ID |
| `PHONEPE_SALT_KEY` | Your PhonePe Salt Key |
| `PHONEPE_SALT_INDEX` | `1` |
| `PHONEPE_ENV` | `PRODUCTION` |

Generate secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> **Note:** Railway provides `PORT` automatically — do not set it manually. The server reads `process.env.PORT` at startup.

### 5d. Build & Deploy Settings

**Option A — Nixpacks (default, recommended)**

Railway auto-detects Node.js via Nixpacks. Configure in Service Settings:

- **Build Command:** `npm run railway-build`
- **Start Command:** `node dist/index.js`

The `railway-build` script runs: `prisma generate` → `prisma migrate deploy` → `tsc`

**Option B — Dockerfile**

A `Dockerfile` is included in `packages/server/` for full control. To use it:

1. Service Settings → **Builder** → select **Dockerfile**
2. Railway will use `packages/server/Dockerfile` automatically (since Root Directory is `packages/server`)

### 5e. Health Check

Configure in Service Settings → **Healthcheck Path**: `/api/health`

### 5f. Custom Domain

1. Service Settings → **Networking** → **"Generate Domain"** (gives you `*.up.railway.app`)
2. Or add a **Custom Domain** (e.g., `api.dwellhub.in`) and configure DNS with the provided CNAME

### 5g. First Deploy

After setting up variables and linking Postgres:

1. Push to your main branch — Railway auto-deploys
2. Check deploy logs for:
   - `prisma migrate deploy` succeeding
   - `Server running on port <PORT>`
   - `Database connected successfully`

3. Seed the database (one-time, run from Railway's shell or locally):
```bash
# From your local machine, using the Railway DATABASE_URL:
DATABASE_URL="postgresql://..." npx prisma@5.22.0 db seed
```

Or use Railway CLI:
```bash
railway run npx prisma@5.22.0 db seed
```

### 5h. Update Frontend API URL

Point the frontend to your Railway backend:

- In Vercel (client project), set `VITE_API_URL` to `https://your-server.up.railway.app/api`
- Or for custom domain: `https://api.dwellhub.in/api`

---

## 6. Post-Deployment Checklist

- [ ] Frontend loads and shows login page
- [ ] Admin can log in (admin@greenvalley.com / admin123)
- [ ] API calls from frontend reach the backend
- [ ] Database migrations are applied
- [ ] Seed data is loaded
- [ ] PhonePe settings page works (Admin → Settings)
- [ ] File uploads work (complaints with attachments)
- [ ] PWA manifest loads and app is installable

---

## 7. Test Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@greenvalley.com | admin123 |
| Owner | rajesh.kumar@email.com | owner123 |
| Tenant | ravi.menon@email.com | tenant123 |

---

## 8. Generate Strong Secrets

```bash
# Generate JWT secrets (run in terminal)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Folder Structure for Deployment

```
PWA-Apart/
├── vercel.json                          # Root Vercel config (if single-project deploy)
├── packages/
│   ├── client/
│   │   ├── .env.production.example      # Frontend env template
│   │   └── ...
│   └── server/
│       ├── vercel.json                  # Backend Vercel serverless config
│       ├── .env.production.example      # Backend env template
│       ├── uploads/.gitkeep             # Preserve uploads dir
│       └── ...
├── .gitignore
├── DEPLOYMENT.md                        # This file
└── CONTEXT.md                           # Project context & documentation
```
