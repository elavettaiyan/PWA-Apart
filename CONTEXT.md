# Resilynk – Apartment Management PWA (Multi-Tenant)

## Project Location
`c:\Code\PWA-Apart` (npm workspaces monorepo)

---

## Tech Stack
- **Backend:** `packages/server` — Node.js + Express + TypeScript + Prisma (PostgreSQL) on port 4000, dev via `tsx watch`
- **Frontend:** `packages/client` — React 18 + Vite + TypeScript + Tailwind CSS + Zustand + TanStack Query on port 5173
- **Auth:** JWT (access 15m + refresh 7d), bcryptjs. Roles: `SUPER_ADMIN`, `ADMIN`, `OWNER`, `TENANT`
- **Database:** PostgreSQL via Docker (`docker-compose up -d`)
- **Payments:** PhonePe Standard Checkout API
- **Architecture:** Multi-tenant — each apartment/society is an isolated tenant

---

## What's Built & Working
1. **Multi-tenant architecture** — each apartment/society is isolated; new apartments self-register via `/register`
2. **Admin panel** — CRUD for blocks, flats, owners, tenants (scoped to society)
3. **Monthly maintenance billing** — config per flat type, generate bills, record cash payments
4. **PhonePe integration** — initiate, callback, status check (reads config from DB per society)
5. **Complaints** — create, status updates (admin), comments, image upload
6. **Expenses** — full CRUD (admin-only)
7. **Association Bylaws** — CRUD (admin), read-only for residents
8. **Reports** — dashboard, collection, defaulters, expense summary, P&L (admin-only)
9. **Settings** — PhonePe config UI with save, test, activate/disable
10. **Role-based access** — fully implemented:
    - ADMIN sees everything within their society
    - Owner/Tenant sees: Dashboard (personalized), My Flat, Billing, Complaints, Bylaws
    - Routes protected with `AdminRoute` wrapper, sidebar filtered by role

---

## Login Credentials (Seed Data)
### Green Valley Apartments
- **Super Admin:** `admin@greenvalley.com` / `admin123`
- **Owner:** `rajesh.kumar@email.com` / `owner123` (flat A-101)
- **Tenant:** `ravi.menon@email.com` / `tenant123`

### Sunrise Heights (2nd apartment — multi-tenant demo)
- **Admin:** `admin@sunriseheights.com` / `admin123`

---

## Key Server Files
| File | Purpose |
|------|---------|
| `packages/server/prisma/schema.prisma` | 16 models including `PaymentGatewayConfig` |
| `packages/server/prisma/seed.ts` | Seeds society, blocks, 20 flats, 10 owners, 1 tenant, admin user, configs, expenses, bylaws |
| `packages/server/src/index.ts` | Express app, all routes registered including `/api/settings` |
| `packages/server/src/config/index.ts` | Env config (PhonePe env vars are fallback now) |
| `packages/server/src/middleware/auth.ts` | `authenticate` + `authorize(...roles)` middleware |
| `packages/server/src/modules/auth/routes.ts` | Register, login, refresh, /me |
| `packages/server/src/modules/flats/routes.ts` | Societies, blocks, flats, owners, tenants CRUD + `GET /my-flat` for owner/tenant |
| `packages/server/src/modules/billing/routes.ts` | Maintenance config, generate bills, list bills (filtered by role), record payment |
| `packages/server/src/modules/payments/routes.ts` | PhonePe initiate/callback/status — uses `getPhonePeConfig()` that reads DB first, falls back to env |
| `packages/server/src/modules/complaints/routes.ts` | CRUD + comments, status update admin-only, filtered by createdById for owner/tenant |
| `packages/server/src/modules/expenses/routes.ts` | CRUD, all routes admin-only |
| `packages/server/src/modules/association/routes.ts` | Bylaws CRUD, read for all, write admin-only |
| `packages/server/src/modules/reports/routes.ts` | Dashboard (admin), my-dashboard (owner/tenant), collection, defaulters, expense-summary, P&L |
| `packages/server/src/modules/settings/routes.ts` | **NEW** — Admin CRUD for PhonePe config (GET/POST `/payment-gateway`, PATCH `/payment-gateway/toggle`, POST `/payment-gateway/test`) |

## Key Client Files
| File | Purpose |
|------|---------|
| `packages/client/src/App.tsx` | Routes with `ProtectedRoute` and `AdminRoute` wrappers |
| `packages/client/src/components/layout/Layout.tsx` | Role-filtered sidebar nav (`allNavigation` array) |
| `packages/client/src/store/authStore.ts` | Zustand persist store (user, tokens, isAuthenticated) |
| `packages/client/src/types/index.ts` | All TypeScript interfaces |
| `packages/client/src/lib/api.ts` | Axios instance with interceptors |
| `packages/client/src/lib/utils.ts` | Helpers: `formatCurrency`, `formatDate`, `getStatusColor`, `cn` |
| `packages/client/src/pages/dashboard/DashboardPage.tsx` | Split: `AdminDashboard` + `ResidentDashboard` based on role |
| `packages/client/src/pages/flats/FlatsPage.tsx` | Admin flat management |
| `packages/client/src/pages/flats/MyFlatPage.tsx` | Owner/tenant flat view with details + recent bills |
| `packages/client/src/pages/billing/BillingPage.tsx` | Billing with role-based buttons (Generate/Record hidden for non-admin, PhonePe visible for all) |
| `packages/client/src/pages/complaints/ComplaintsPage.tsx` | Complaints with role-based status update (admin-only) |
| `packages/client/src/pages/expenses/ExpensesPage.tsx` | Expenses (admin-only route) |
| `packages/client/src/pages/bylaws/BylawsPage.tsx` | Bylaws — add/edit/delete hidden for non-admins |
| `packages/client/src/pages/reports/ReportsPage.tsx` | 4-tab reports (admin-only route) |
| `packages/client/src/pages/settings/SettingsPage.tsx` | **NEW** — PhonePe config UI with env toggle, save, test connection, activate/disable |

---

---

## Commands

```bash
# Start PostgreSQL (first time)
docker-compose up -d

# Start backend
cd c:\Code\PWA-Apart\packages\server && npm run dev

# Start frontend
cd c:\Code\PWA-Apart\packages\client && npm run dev

# Reset database
cd c:\Code\PWA-Apart\packages\server && npx prisma migrate reset

# Run new migration
cd c:\Code\PWA-Apart\packages\server && npx prisma migrate dev --name <name>

# Regenerate Prisma client (kill server first if DLL locked)
npx kill-port 4000 && npx prisma generate
```

---

## Prompt to Continue
> Continue from the CONTEXT.md file — wire up the Settings page into App.tsx and Layout.tsx, restart both servers, and test.
