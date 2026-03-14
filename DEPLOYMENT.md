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
| `JWT_SECRET` | (generate a strong 64-char random string) |
| `JWT_REFRESH_SECRET` | (generate another strong 64-char random string) |
| `PHONEPE_MERCHANT_ID` | Your PhonePe Merchant ID |
| `PHONEPE_SALT_KEY` | Your PhonePe Salt Key |
| `PHONEPE_SALT_INDEX` | `1` |
| `PHONEPE_ENV` | `PRODUCTION` |
| `CLIENT_URL` | `https://your-frontend.vercel.app` |
| `NODE_ENV` | `production` |

### 4c. Build Settings

- **Build Command:** `npx prisma generate && npm run build`
- **Output Directory:** `dist`

---

## 5. Alternative: Deploy Backend to Railway

If Vercel serverless doesn't suit your needs (e.g., WebSocket, long-running tasks):

1. Go to [railway.app](https://railway.app) → "New Project"
2. Connect your GitHub repo
3. Set **Root Directory** to `packages/server`
4. Add a PostgreSQL plugin (Railway provides one)
5. Set environment variables (same as section 4b)
6. Railway auto-detects Node.js and runs `npm start`

Make sure `packages/server/package.json` has a start script:
```json
"start": "node dist/index.js"
```

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
