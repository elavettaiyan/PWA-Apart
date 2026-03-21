#!/usr/bin/env sh

set -e

if [ "$SKIP_PRISMA_MIGRATE_DEPLOY" = "1" ]; then
  echo "Skipping prisma migrate deploy because SKIP_PRISMA_MIGRATE_DEPLOY=1"
  npm run generate
  exit 0
fi

RESOLVED_URL="${DIRECT_URL:-${DATABASE_URL:-$APART_EASE_POSTGRES_PRISMA_URL}}"

if [ -z "$RESOLVED_URL" ]; then
  echo "Missing database URL for Prisma migration. Set DIRECT_URL or DATABASE_URL."
  exit 1
fi

if [ -z "$DIRECT_URL" ] && echo "$RESOLVED_URL" | grep -Eq "pooler\.supabase\.com:6543"; then
  echo "DIRECT_URL is required for Prisma migrations when DATABASE_URL points to Supabase pooler 6543."
  exit 1
fi

export DATABASE_URL="$RESOLVED_URL"
echo "Prisma migration URL source: $([ -n "$DIRECT_URL" ] && echo DIRECT_URL || echo DATABASE_URL)"
echo "Prisma DB URL: set"

npm run db:deploy:safe
npm run generate
