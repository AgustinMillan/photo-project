#!/usr/bin/env bash
# Installs the platform's scheduled jobs. Idempotent; touches only its own files:
#   /opt/photo-platform/bin/*, /etc/cron.d/photo-platform, /etc/logrotate.d/photo-platform
set -euo pipefail
DOMAIN="${DOMAIN:?set DOMAIN, e.g. fotos.example.com}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/photo-platform/src/infra/deploy}"
HERE="$(cd "$(dirname "$0")" && pwd)"

install -d -m 755 /opt/photo-platform/bin
install -m 750 "$HERE/backup.sh" /opt/photo-platform/bin/backup.sh
install -m 750 "$HERE/ensure-certs.sh" /opt/photo-platform/bin/ensure-certs.sh

cat > /etc/cron.d/photo-platform <<CRON
# Galeriza scheduled jobs (managed by infra/deploy/ops/install.sh)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Daily backup at 06:30 UTC (03:30 Argentina), 7 days of retention.
30 6 * * * root /opt/photo-platform/bin/backup.sh >> /var/log/photo-platform-backup.log 2>&1
# HTTPS for new store subdomains, every 5 minutes.
*/5 * * * * root DOMAIN=$DOMAIN /opt/photo-platform/bin/ensure-certs.sh >> /var/log/photo-platform-certs.log 2>&1
# Billing at 12:10 UTC (09:10 Argentina): trial-ending reminders and a full
# re-sync with Mercado Pago in case a webhook was lost.
10 12 * * * root cd $DEPLOY_DIR && docker compose exec -T api node dist/admin/cli.js billing:daily >> /var/log/photo-platform-billing.log 2>&1
CRON
chmod 644 /etc/cron.d/photo-platform

cat > /etc/logrotate.d/photo-platform <<'ROT'
/var/log/photo-platform-*.log {
  weekly
  rotate 4
  compress
  missingok
  notifempty
}
ROT
echo "installed"
