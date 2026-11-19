#!/usr/bin/env bash
# Adds every store subdomain to the platform's TLS certificate as soon as the
# store exists, so new photographers get HTTPS without manual steps.
#
# Uses HTTP-01 through the existing nginx site (the wildcard DNS record already
# points every *.DOMAIN at this server). Runs every few minutes from cron and
# only calls Let's Encrypt when a hostname is missing.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/photo-platform/src/infra/deploy}"
DOMAIN="${DOMAIN:?set DOMAIN, e.g. fotos.example.com}"
CERT_NAME="${CERT_NAME:-$DOMAIN}"
SERVER_IP="${SERVER_IP:-$(curl -fsS -4 --max-time 5 https://api.ipify.org || true)}"

exec 9>/run/photo-platform-certs.lock
flock -n 9 || exit 0

current="$(certbot certificates --cert-name "$CERT_NAME" 2>/dev/null | sed -n 's/^ *Domains: //p' | tr ' ' '\n' | sed '/^$/d' | sort -u)"

wanted="$(docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/docker-compose.yml" exec -T postgres \
  psql -U photo_platform -d photo_platform -Atc \
  "select d.hostname from store_domains d join stores s on s.id = d.store_id where s.deleted_at is null" \
  | grep -E "^[a-z0-9-]+\.${DOMAIN//./\\.}$" | sort -u || true)"

missing=()
while read -r host; do
  [[ -z "$host" ]] && continue
  grep -qx "$host" <<<"$current" && continue
  # Only request names that already resolve here, or the whole request fails.
  if [[ -n "$SERVER_IP" ]] && ! dig +short A "$host" | grep -qx "$SERVER_IP"; then
    echo "$(date -u -Is) skip $host (does not resolve to $SERVER_IP yet)"
    continue
  fi
  missing+=("$host")
done <<<"$wanted"

[[ ${#missing[@]} -eq 0 ]] && exit 0

args=(-d "$DOMAIN")
while read -r host; do [[ -n "$host" && "$host" != "$DOMAIN" ]] && args+=(-d "$host"); done <<<"$current"
for host in "${missing[@]}"; do args+=(-d "$host"); done

echo "$(date -u -Is) adding: ${missing[*]}"
certbot --nginx --cert-name "$CERT_NAME" "${args[@]}" --expand --non-interactive --keep-until-expiring --quiet
nginx -t && systemctl reload nginx
echo "$(date -u -Is) certificate now covers $(( ${#args[@]} / 2 )) names"
