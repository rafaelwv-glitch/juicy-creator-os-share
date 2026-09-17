#!/usr/bin/env bash
# Local installer for Juicy Creator OS (shareable clone).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 22+ is required. Arch: sudo pacman -S nodejs npm"
    exit 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt 22 ]; then
    echo "Node $(node -v) is too old — need 22+."
    exit 1
  fi
}

need_node
echo "==> Node $(node -v)"

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "==> wrote .env.local (auth off, no secrets)"
fi

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

mkdir -p data
if [ ! -f data/last-snapshot.json ]; then
  node --input-type=module -e "
    import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    const raw = JSON.parse(readFileSync('fixtures/warehouse-sample.json','utf8'));
    mkdirSync('data', { recursive: true });
    for (const [name, body] of Object.entries(raw.files || {})) {
      if (!String(name).endsWith('.json')) continue;
      writeFileSync(join('data', String(name)), JSON.stringify(body, null, 2));
    }
    console.log('==> seeded sample warehouse into ./data');
  "
fi

echo
echo "Install complete. Start the dashboard with:"
echo "  npm run dev:local"
echo "then open http://127.0.0.1:8080"
