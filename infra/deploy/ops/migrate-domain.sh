#!/usr/bin/env bash
# One-time move of the platform to a new domain, keeping the old one working
# as a permanent redirect (and as the Mercado Pago endpoint until the MP app
# is updated).
#
# Usage (on the server, as root, after the new domain's DNS points here):
#   OLD_DOMAIN=fotos.alquila110.tech NEW_DOMAIN=galeriza.com.ar \
#     /opt/photo-platform/src/infra/deploy/ops/migrate-domain.sh
set -euo pipefail

OLD_DOMAIN="${OLD_DOMAIN:?}"
NEW_DOMAIN="${NEW_DOMAIN:?}"
OLD_CERT="${OLD_CERT:-$OLD_DOMAIN}"
NEW_SITE="${NEW_SITE:-galeriza}"
OLD_SITE_FILE="${OLD_SITE_FILE:-/etc/nginx/sites-available/photo-platform}"
DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$DEPLOY_DIR/.env"
STAMP="$(date -u +%Y%m%d-%H%M)"
SAFE="/opt/photo-platform/backups/domain-move-$STAMP"
SERVER_IP="${SERVER_IP:-$(curl -fsS -4 --max-time 5 https://api.ipify.org)}"
API_PORT="$(grep -E '^API_HOST_PORT=' "$ENV_FILE" | cut -d= -f2)"
API_PORT="${API_PORT:-3100}"

log() { echo "==> $*"; }

log "Checking DNS for $NEW_DOMAIN -> $SERVER_IP"
for host in "$NEW_DOMAIN" "www.$NEW_DOMAIN" "dns-check-$RANDOM.$NEW_DOMAIN"; do
  dig +short A "$host" | grep -qx "$SERVER_IP" || { echo "$host does not resolve to $SERVER_IP yet"; exit 1; }
done

log "Backups in $SAFE"
mkdir -p "$SAFE" && chmod 700 "$SAFE"
cp -a "$ENV_FILE" "$SAFE/env"
cp -a "$OLD_SITE_FILE" "$SAFE/nginx-old-site"
/opt/photo-platform/bin/backup.sh

log "Updating .env"
set_env() {
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
grep -qE '^MP_PUBLIC_BASE_URL=' "$ENV_FILE" || set_env MP_PUBLIC_BASE_URL "https://$OLD_DOMAIN"
set_env APP_URL "https://$NEW_DOMAIN"
set_env PLATFORM_DOMAIN "$NEW_DOMAIN"
set_env CORS_ORIGIN "https://$NEW_DOMAIN,https://$OLD_DOMAIN"

log "Moving store subdomains to $NEW_DOMAIN"
docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.yml" exec -T postgres \
  psql -U photo_platform -d photo_platform -v ON_ERROR_STOP=1 -c \
  "update store_domains set hostname = regexp_replace(hostname, '\\.' || replace('$OLD_DOMAIN', '.', '\\.') || '\$', '.$NEW_DOMAIN'), updated_at = now() where type = 'platform_subdomain' and hostname like '%.$OLD_DOMAIN'"

log "Deploying on $NEW_DOMAIN"
cd "$DEPLOY_DIR"
SITE_NAME="$NEW_SITE" DOMAIN="$NEW_DOMAIN" ./deploy.sh
docker compose up -d --force-recreate --wait api

log "Turning $OLD_DOMAIN into a redirect"
old_re="${OLD_DOMAIN//./\\.}"
sed -e "s|__OLD_DOMAIN_RE__|$old_re|g" -e "s|__OLD_DOMAIN__|$OLD_DOMAIN|g" -e "s|__NEW_DOMAIN__|$NEW_DOMAIN|g" \
  -e "s|__OLD_CERT__|$OLD_CERT|g" -e "s|__API_PORT__|$API_PORT|g" \
  "$DEPLOY_DIR/nginx.legacy.conf.template" > "$OLD_SITE_FILE"
if ! nginx -t; then
  cp -a "$SAFE/nginx-old-site" "$OLD_SITE_FILE"; nginx -t && systemctl reload nginx
  echo "Legacy config rejected; old site restored"; exit 1
fi
systemctl reload nginx

log "Certificate for $NEW_DOMAIN"
hosts=(-d "$NEW_DOMAIN" -d "www.$NEW_DOMAIN")
while read -r host; do [[ -n "$host" ]] && hosts+=(-d "$host"); done < <(
  docker compose exec -T postgres psql -U photo_platform -d photo_platform -Atc \
    "select d.hostname from store_domains d join stores s on s.id = d.store_id where s.deleted_at is null and d.hostname like '%.$NEW_DOMAIN'")
certbot --nginx --cert-name "$NEW_DOMAIN" "${hosts[@]}" --non-interactive --agree-tos --redirect --keep-until-expiring
nginx -t && systemctl reload nginx

log "Scheduled jobs for $NEW_DOMAIN"
DOMAIN="$NEW_DOMAIN" "$DEPLOY_DIR/ops/install.sh"

log "Done. Backups of the previous config: $SAFE"
