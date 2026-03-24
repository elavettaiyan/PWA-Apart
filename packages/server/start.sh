#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma@5.22.0 migrate deploy --schema=packages/server/prisma/schema.prisma

echo "Starting server..."
exec node packages/server/dist/index.js
