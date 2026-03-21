#!/usr/bin/env sh

set -e

FAILED_MIGRATION_NAME="${PRISMA_FAILED_MIGRATION_NAME:-20260317130000_multi_society_membership}"
RESOLVE_MODE="${PRISMA_FAILED_MIGRATION_RESOLVE_MODE:-auto}"
DEPLOY_LOG_FILE="$(mktemp)"

run_deploy() {
  npx prisma@5.22.0 migrate deploy >"$DEPLOY_LOG_FILE" 2>&1
  status=$?
  cat "$DEPLOY_LOG_FILE"
  return "$status"
}

resolve_and_retry() {
  MODE="$1"
  if [ "$MODE" = "applied" ]; then
    FLAG="--applied"
  else
    FLAG="--rolled-back"
  fi

  echo "Attempting one-time recovery by resolving failed migration as $MODE: $FAILED_MIGRATION_NAME"
  if npx prisma@5.22.0 migrate resolve "$FLAG" "$FAILED_MIGRATION_NAME"; then
    echo "Recovery resolve succeeded. Retrying prisma migrate deploy."
    if run_deploy; then
      return 0
    fi
  fi

  return 1
}

if [ "$RESOLVE_MODE" = "applied" ]; then
  echo "Pre-resolving migration as applied to skip execution: $FAILED_MIGRATION_NAME"
  npx prisma@5.22.0 migrate resolve --applied "$FAILED_MIGRATION_NAME" || true
fi

if run_deploy; then
  exit 0
fi

echo "prisma migrate deploy failed."
if [ "$RESOLVE_MODE" = "applied" ]; then
  if resolve_and_retry applied; then
    exit 0
  fi
elif [ "$RESOLVE_MODE" = "rolled-back" ]; then
  if resolve_and_retry rolled-back; then
    exit 0
  fi
else
  if resolve_and_retry rolled-back; then
    exit 0
  fi

  if grep -Eq "already exists|E42701|activeSocietyId" "$DEPLOY_LOG_FILE"; then
    echo "Detected partial migration state (duplicate column/object). Trying applied fallback."
  else
    echo "Trying applied fallback after rolled-back strategy failed."
  fi

  if resolve_and_retry applied; then
    exit 0
  fi
fi

echo "Automatic migration recovery could not resolve $FAILED_MIGRATION_NAME."
echo "Run prisma migrate resolve manually for the failing migration, then redeploy."
exit 1
