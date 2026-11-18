#!/usr/bin/env bash
# Builds and (re)deploys the platform on a host that already runs other
# services. It only touches: the photo-platform-prod compose project, the
# WEB_ROOT directory and its own nginx site file.
#
# Usage (on the server, from the repository checkout):
#   DOMAIN=fotos.example.com infra/deploy/deploy.sh
set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN, e.g. fotos.example.com}"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/../.." && pwd)"
WEB_ROOT="${WEB_ROOT:-/var/www/photo-platform}"
SITE_FILE="/etc/nginx/sites-available/photo-platform"
API_PORT="$(grep -E '^API_HOST_PORT=' "$DEPLOY_DIR/.env" | cut -d= -f2)"
API_PORT="${API_PORT:-3100}"
SUPPORT_EMAIL="$(grep -E '^SUPPORT_EMAIL=' "$DEPLOY_DIR/.env" | cut -d= -f2 || true)"

[[ -f "$DEPLOY_DIR/.env" ]] || { echo "Missing $DEPLOY_DIR/.env (see .env.example)"; exit 1; }
if ss -tln | grep -q "127.0.0.1:$API_PORT " && ! docker compose -f "$DEPLOY_DIR/docker-compose.yml" ps --status running api | grep -q api; then
  echo "Port $API_PORT is already used by another service. Set API_HOST_PORT in .env."; exit 1
fi

cd "$REPO_DIR"
echo "==> Building API image"
docker build -f infra/deploy/Dockerfile --target api -t photo-platform-api:latest .

echo "==> Building web panel"
rm -rf "$WEB_ROOT.new"
docker build -f infra/deploy/Dockerfile --target web \
  --build-arg VITE_PLATFORM_DOMAIN="$DOMAIN" --build-arg VITE_SUPPORT_EMAIL="$SUPPORT_EMAIL" \
  --output "type=local,dest=$WEB_ROOT.new" .

echo "==> Starting database and running migrations"
cd "$DEPLOY_DIR"
docker compose up -d --wait postgres
docker compose run --rm --no-deps api node dist/db/migrate.js

echo "==> Starting API"
docker compose up -d api
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null || { docker compose logs --tail 50 api; exit 1; }

echo "==> Publishing web panel"
rm -rf "$WEB_ROOT.old"
[[ -d "$WEB_ROOT" ]] && mv "$WEB_ROOT" "$WEB_ROOT.old"
mv "$WEB_ROOT.new" "$WEB_ROOT"

if [[ ! -f "$SITE_FILE" ]]; then
  echo "==> Creating nginx site for $DOMAIN"
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__WEB_ROOT__|$WEB_ROOT|g" -e "s|__API_PORT__|$API_PORT|g" \
    "$DEPLOY_DIR/nginx.conf.template" > "$SITE_FILE"
  ln -sf "$SITE_FILE" /etc/nginx/sites-enabled/photo-platform
fi
nginx -t
systemctl reload nginx

echo "==> Done. API health: http://127.0.0.1:$API_PORT/api/v1/health"
echo "    Admin: cd $DEPLOY_DIR && docker compose exec api node dist/admin/cli.js list"
