#!/usr/bin/env sh

set -e

FAILED_MIGRATION_NAME="${PRISMA_FAILED_MIGRATION_NAME:-20260317130000_multi_society_membership}"

if npx prisma@5.22.0 migrate deploy; then
  exit 0
fi

echo "prisma migrate deploy failed."
echo "Attempting one-time recovery by resolving failed migration as rolled back: $FAILED_MIGRATION_NAME"

if npx prisma@5.22.0 migrate resolve --rolled-back "$FAILED_MIGRATION_NAME"; then
  echo "Recovery resolve succeeded. Retrying prisma migrate deploy."
  npx prisma@5.22.0 migrate deploy
  exit 0
fi

echo "Automatic migration recovery could not resolve $FAILED_MIGRATION_NAME."
echo "Run prisma migrate resolve manually for the failing migration, then redeploy."
exit 1