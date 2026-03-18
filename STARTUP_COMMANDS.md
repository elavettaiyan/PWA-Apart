# Build and Start Commands

## Prerequisites
- Node.js 20+
- npm
- PostgreSQL running locally (or `DATABASE_URL` configured)

## Install Dependencies
```bash
npm install
```

## Database Setup
```bash
npm run db:migrate
npm run db:seed
```

## Start Development (Client + Server)
```bash
npm run dev
```

## Start Only Backend
```bash
npm run dev:server
```

## Start Only Frontend
```bash
npm run dev:client
```

## Build All
```bash
npm run build
```

## Build Backend Only
```bash
npm run build:server
```

## Build Frontend Only
```bash
npm run build:client
```

## Server Direct Commands
```bash
npm --prefix packages/server run dev
npm --prefix packages/server run build
npm --prefix packages/server run start
```

## Client Direct Commands
```bash
npm --prefix packages/client run dev
npm --prefix packages/client run build
npm --prefix packages/client run preview
```

## Marketing Site Commands
```bash
npm --prefix packages/marketing run dev
npm --prefix packages/marketing run build
npm --prefix packages/marketing run preview
```

## Useful DB Commands
```bash
npm run db:studio
```
