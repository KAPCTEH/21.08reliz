#!/usr/bin/env bash
set -euo pipefail
umask 077

BOOTSTRAP_FILE="${1:-}"
INSTALL_FINISHED=0
BACKUP_READY=0
BACKUP_DIR=""
EXISTING_DB=0
CREATED_DB=0
SERVICE_WAS_ACTIVE=0
DB_ROLLBACK_FAILED=0
if [[ -z "$BOOTSTRAP_FILE" || ! -f "$BOOTSTRAP_FILE" ]]; then
  echo "Bootstrap configuration is missing" >&2
  exit 2
fi
cleanup_bootstrap() {
  API_KEY=""
  VPS_ATTESTATION_SECRET=""
  if command -v shred >/dev/null 2>&1; then shred -u -- "$BOOTSTRAP_FILE" 2>/dev/null || rm -f -- "$BOOTSTRAP_FILE"
  else rm -f -- "$BOOTSTRAP_FILE"
  fi
}
rollback_installation() {
  local status="$1"
  [[ "$status" == 0 || "$INSTALL_FINISHED" == 1 ]] && return
  set +e
  echo "JustFun: setup failed; restoring the previous server state" >&2
  systemctl stop orders-logistics 2>/dev/null || true
  if [[ "$BACKUP_READY" == 1 && -d "$BACKUP_DIR" ]]; then
    if [[ "$CREATED_DB" == 1 && "$EXISTING_DB" != 1 ]]; then
      sudo -u postgres dropdb --if-exists orderslogistics >/dev/null 2>&1
    elif [[ "$EXISTING_DB" == 1 && -s "$BACKUP_DIR/orderslogistics.dump" ]]; then
      if ! sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c \
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='orderslogistics' AND pid<>pg_backend_pid()" >/dev/null 2>&1 || \
         ! sudo -u postgres dropdb --if-exists orderslogistics >/dev/null 2>&1 || \
         ! sudo -u postgres createdb --owner=orderslogistics orderslogistics >/dev/null 2>&1 || \
         ! sudo -u postgres pg_restore --exit-on-error --dbname=orderslogistics \
          "$BACKUP_DIR/orderslogistics.dump" >/dev/null 2>&1 || \
         ! sudo -u postgres psql -d orderslogistics -v ON_ERROR_STOP=1 -tAc "SELECT 1" >/dev/null 2>&1; then
        DB_ROLLBACK_FAILED=1
        echo "JustFun: CRITICAL - automatic database restore failed; verified dump remains at $BACKUP_DIR/orderslogistics.dump" >&2
      fi
    fi
    for item in server.py server.env tls.crt tls.key 00-orders-logistics.conf; do
      if [[ -f "$BACKUP_DIR/$item" ]]; then
        case "$item" in
          server.py) cp -a "$BACKUP_DIR/$item" /opt/justfun/orders-logistics/server.py ;;
          00-orders-logistics.conf) cp -a "$BACKUP_DIR/$item" /etc/nginx/conf.d/00-orders-logistics.conf ;;
          *) cp -a "$BACKUP_DIR/$item" "/etc/orders-logistics/$item" ;;
        esac
      else
        case "$item" in
          server.py) rm -f /opt/justfun/orders-logistics/server.py ;;
          00-orders-logistics.conf) rm -f /etc/nginx/conf.d/00-orders-logistics.conf ;;
          *) rm -f "/etc/orders-logistics/$item" ;;
        esac
      fi
    done
    if [[ -f "$BACKUP_DIR/orders-logistics.service" ]]; then
      cp -a "$BACKUP_DIR/orders-logistics.service" /etc/systemd/system/orders-logistics.service
    else
      rm -f /etc/systemd/system/orders-logistics.service
    fi
    if [[ -f "$BACKUP_DIR/orders-logistics.nginx" ]]; then
      cp -a "$BACKUP_DIR/orders-logistics.nginx" /etc/nginx/sites-available/orders-logistics
      ln -sfn /etc/nginx/sites-available/orders-logistics /etc/nginx/sites-enabled/orders-logistics
    else
      rm -f /etc/nginx/sites-enabled/orders-logistics /etc/nginx/sites-available/orders-logistics
    fi
  fi
  systemctl daemon-reload 2>/dev/null || true
  if [[ "$SERVICE_WAS_ACTIVE" == 1 && "$DB_ROLLBACK_FAILED" == 0 && -f /etc/systemd/system/orders-logistics.service ]]; then
    systemctl restart orders-logistics 2>/dev/null || true
  fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
  echo "JustFun: previous server state restored after setup failure" >&2
}
finish() {
  local status=$?
  cleanup_bootstrap
  rollback_installation "$status"
  exit "$status"
}
trap finish EXIT

read_value() {
  local key="$1"
  local value
  value="$(sed -n "s/^${key}=//p" "$BOOTSTRAP_FILE" | tail -n 1)"
  value="${value%$'\r'}"
  [[ "$value" =~ ^[A-Za-z0-9+/=]+$ ]] || return 1
  printf '%s' "$value" | base64 -d
}

API_KEY="$(read_value API_KEY_B64)"
VPS_ATTESTATION_SECRET="$(read_value VPS_ATTESTATION_SECRET_B64)"
INSTALLATION_ID="$(read_value INSTALLATION_ID_B64)"
SERVER_IP="$(read_value SERVER_IP_B64)"
SSH_PORT="$(read_value SSH_PORT_B64)"
[[ "$API_KEY" =~ ^[A-Za-z0-9_-]{40,120}$ ]] || { echo "Invalid API key" >&2; exit 2; }
[[ "$VPS_ATTESTATION_SECRET" =~ ^jfvps_[A-Za-z0-9_-]{43,120}$ ]] || { echo "Invalid VPS attestation secret" >&2; exit 2; }
[[ "$INSTALLATION_ID" =~ ^[A-Za-z0-9_-]{16,80}$ ]] || { echo "Invalid installation ID" >&2; exit 2; }
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || { echo "Invalid SSH port" >&2; exit 2; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends postgresql postgresql-contrib python3 python3-psycopg2 nginx openssl ufw curl ca-certificates

if ! id -u orderslogistics >/dev/null 2>&1; then
  useradd --system --home /opt/justfun/orders-logistics --shell /usr/sbin/nologin orderslogistics
fi
install -d -o root -g orderslogistics -m 0750 /opt/justfun
install -d -o orderslogistics -g orderslogistics -m 0750 /opt/justfun/orders-logistics
install -d -o root -g root -m 0750 /etc/orders-logistics
install -d -o root -g postgres -m 0710 /var/backups/justfun-orders-logistics
BACKUP_DIR="/var/backups/justfun-orders-logistics/$(date -u +%Y%m%dT%H%M%SZ)"
EXISTING_DB="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='orderslogistics'" 2>/dev/null | tr -d '[:space:]' || true)"
install -d -m 0710 -o root -g postgres "$BACKUP_DIR"
if systemctl is-active --quiet orders-logistics 2>/dev/null; then
  SERVICE_WAS_ACTIVE=1
  systemctl stop orders-logistics
fi
if [[ -f /opt/justfun/orders-logistics/server.py || -f /etc/orders-logistics/server.env || "$EXISTING_DB" == 1 ]]; then
  [[ -f /opt/justfun/orders-logistics/server.py ]] && cp -a /opt/justfun/orders-logistics/server.py "$BACKUP_DIR/"
  [[ -f /etc/orders-logistics/server.env ]] && cp -a /etc/orders-logistics/server.env "$BACKUP_DIR/"
  [[ -f /etc/orders-logistics/tls.crt ]] && cp -a /etc/orders-logistics/tls.crt "$BACKUP_DIR/"
  [[ -f /etc/orders-logistics/tls.key ]] && cp -a /etc/orders-logistics/tls.key "$BACKUP_DIR/"
  [[ -f /etc/systemd/system/orders-logistics.service ]] && cp -a /etc/systemd/system/orders-logistics.service "$BACKUP_DIR/orders-logistics.service"
  [[ -f /etc/nginx/sites-available/orders-logistics ]] && cp -a /etc/nginx/sites-available/orders-logistics "$BACKUP_DIR/orders-logistics.nginx"
  [[ -f /etc/nginx/conf.d/00-orders-logistics.conf ]] && cp -a /etc/nginx/conf.d/00-orders-logistics.conf "$BACKUP_DIR/00-orders-logistics.conf"
  if [[ "$EXISTING_DB" == 1 ]]; then
    sudo -u postgres pg_dump --format=custom orderslogistics > "$BACKUP_DIR/orderslogistics.dump"
    chown root:postgres "$BACKUP_DIR/orderslogistics.dump"
    chmod 0640 "$BACKUP_DIR/orderslogistics.dump"
    sudo -u postgres pg_restore --list "$BACKUP_DIR/orderslogistics.dump" > "$BACKUP_DIR/orderslogistics.restore-list"
    sha256sum "$BACKUP_DIR/orderslogistics.dump" > "$BACKUP_DIR/orderslogistics.dump.sha256"
    chmod 0600 "$BACKUP_DIR/orderslogistics.restore-list" "$BACKUP_DIR/orderslogistics.dump.sha256"
  fi
fi
BACKUP_READY=1

DB_PASSWORD=""
DADATA_API_KEY=""
if [[ -f /etc/orders-logistics/server.env ]]; then
  DB_PASSWORD="$(sed -n 's/^JF_DB_PASSWORD=//p' /etc/orders-logistics/server.env | tail -n 1 || true)"
  DADATA_API_KEY="$(sed -n 's/^JF_DADATA_API_KEY=//p' /etc/orders-logistics/server.env | tail -n 1 || true)"
fi
if [[ ! "$DB_PASSWORD" =~ ^[a-f0-9]{64}$ ]]; then DB_PASSWORD="$(openssl rand -hex 32)"; fi
if [[ -n "$DADATA_API_KEY" && ! "$DADATA_API_KEY" =~ ^[A-Za-z0-9._-]{16,240}$ ]]; then
  echo "Existing address provider key has an invalid format; refusing to overwrite server.env" >&2
  exit 2
fi

sudo -u postgres psql --set=ON_ERROR_STOP=1 --set=db_password="$DB_PASSWORD" <<'SQL'
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orderslogistics') THEN
    CREATE ROLE orderslogistics LOGIN;
  END IF;
END
$body$;
ALTER ROLE orderslogistics PASSWORD :'db_password';
SQL
if [[ "$EXISTING_DB" != 1 ]]; then
  sudo -u postgres createdb --owner=orderslogistics orderslogistics
  CREATED_DB=1
fi
install -o orderslogistics -g orderslogistics -m 0640 "$(dirname "$0")/server.py" /opt/justfun/orders-logistics/server.py
chown root:orderslogistics /opt/justfun
chmod 0750 /opt/justfun
chown -R orderslogistics:orderslogistics /opt/justfun/orders-logistics
chmod 0750 /opt/justfun/orders-logistics
API_KEY_SHA256="$(printf '%s' "$API_KEY" | sha256sum | awk '{print $1}')"
cat > /etc/orders-logistics/server.env <<EOF_ENV
JF_DB_PASSWORD=$DB_PASSWORD
JF_DB_DSN=dbname=orderslogistics user=orderslogistics password=$DB_PASSWORD host=127.0.0.1 port=5432
JF_API_KEY_SHA256=$API_KEY_SHA256
JF_VPS_ATTESTATION_SECRET=$VPS_ATTESTATION_SECRET
JF_LISTEN_HOST=127.0.0.1
JF_LISTEN_PORT=8792
JF_MAX_BODY=31457280
JF_DB_POOL_MIN=4
JF_DB_POOL_MAX=48
JF_INSTALLATION_ID=$INSTALLATION_ID
JF_DADATA_ORIGIN=https://suggestions.dadata.ru
JF_DADATA_API_KEY=$DADATA_API_KEY
JF_PHOTON_ORIGIN=https://photon.komoot.io
JF_ADDRESS_CACHE_SECONDS=900
EOF_ENV
chmod 0600 /etc/orders-logistics/server.env

RENEW_CERT=1
if [[ -f /etc/orders-logistics/tls.crt && -f /etc/orders-logistics/tls.key ]]; then
  if openssl x509 -in /etc/orders-logistics/tls.crt -noout -checkend 2592000 >/dev/null 2>&1 && \
     openssl x509 -in /etc/orders-logistics/tls.crt -noout -ext subjectAltName 2>/dev/null | grep -Fq "IP Address:$SERVER_IP"; then
    RENEW_CERT=0
  fi
fi
if [[ "$RENEW_CERT" == 1 ]]; then
  openssl req -x509 -nodes -newkey rsa:3072 -sha256 -days 825 \
    -keyout /etc/orders-logistics/tls.key -out /etc/orders-logistics/tls.crt \
    -subj "/CN=$SERVER_IP" -addext "subjectAltName=IP:$SERVER_IP"
fi
chmod 0600 /etc/orders-logistics/tls.key
chmod 0644 /etc/orders-logistics/tls.crt

cat > /etc/systemd/system/orders-logistics.service <<'EOF_SERVICE'
[Unit]
Description=JustFun Orders Logistics API
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=orderslogistics
Group=orderslogistics
EnvironmentFile=/etc/orders-logistics/server.env
ExecStart=/usr/bin/python3 /opt/justfun/orders-logistics/server.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/justfun/orders-logistics

[Install]
WantedBy=multi-user.target
EOF_SERVICE

cat > /etc/nginx/sites-available/orders-logistics <<'EOF_NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 308 https://$host$request_uri;
}
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_certificate /etc/orders-logistics/tls.crt;
    ssl_certificate_key /etc/orders-logistics/tls.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 30m;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    location / {
        proxy_pass http://127.0.0.1:8792;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
    }
}
EOF_NGINX
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/conf.d/00-orders-logistics.conf
ln -sfn /etc/nginx/sites-available/orders-logistics /etc/nginx/sites-enabled/orders-logistics
nginx -t

systemctl daemon-reload
systemctl enable --now postgresql orders-logistics nginx
systemctl restart orders-logistics nginx

ufw allow "$SSH_PORT/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 5432/tcp || true
ufw --force enable

READY=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 3 http://127.0.0.1:8792/health >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [[ "$READY" != 1 ]]; then
  journalctl -u orders-logistics --no-pager -n 40 >&2 || true
  exit 4
fi

CERT_SHA256="$(openssl x509 -in /etc/orders-logistics/tls.crt -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':')"
echo "JustFun REG.RU service 7.8.3 is ready"
echo "CERT_SHA256=$CERT_SHA256"
echo "DATABASE_PORT_EXTERNAL=closed"

INSTALL_FINISHED=1
unset API_KEY VPS_ATTESTATION_SECRET DB_PASSWORD API_KEY_SHA256
