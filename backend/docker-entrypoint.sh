#!/bin/sh
set -e

echo "==> Applying database schema (prisma db push)..."
# Prisma's engine retries the connection internally; the compose healthcheck
# (db: condition: service_healthy) already ensures Postgres is accepting
# connections before this container starts.
npx prisma db push --skip-generate

# Keep the Lookup table (DB-driven enums) in sync with src/constants/lookups.js
# on every start, so new options/categories appear without a full reseed.
echo "==> Syncing lookups..."
node prisma/sync-lookups.js

# Seed only once. Instead of a file marker (which doesn't survive a fresh
# Postgres volume the way SQLite's data dir did), we ask the database whether
# it has already been seeded by checking for the admin user.
echo "==> Checking whether the database needs seeding..."
if node prisma/seed-check.js; then
  echo "==> Database already seeded, skipping seed."
else
  echo "==> Seeding database (first run)..."
  node prisma/seed.js
fi

echo "==> Starting PulseService API..."
exec node src/app.js
