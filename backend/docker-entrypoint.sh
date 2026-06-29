#!/bin/sh
set -e

echo "==> Applying database schema (prisma db push)..."
npx prisma db push --skip-generate

# Seed only once. A marker file lives in the persisted data volume.
if [ ! -f /app/data/.seeded ]; then
  echo "==> Seeding database (first run)..."
  node prisma/seed.js
  touch /app/data/.seeded
else
  echo "==> Database already seeded, skipping seed."
fi

echo "==> Starting PulseService API..."
exec node src/app.js
