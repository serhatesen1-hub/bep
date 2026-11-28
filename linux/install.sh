#!/usr/bin/env bash
# BEP Sistemi - Ubuntu kurulum betiği
# Kullanım:  sudo bash linux/install.sh
# Yeniden çalıştırmak güvenlidir: ayarlar ve veriler korunur, yalnızca program güncellenir.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Lütfen sudo ile çalıştırın:  sudo bash linux/install.sh"; exit 1; }

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/bep; DATA=/var/lib/bep; CONF=/etc/bep/bep.env; BACKUP=/var/backups/bep

for f in worker.js schema.sql public/index.html linux/server.mjs; do
  [ -e "$SRC/$f" ] || { echo "Eksik dosya: $SRC/$f (betiği deponun içinden çalıştırın)"; exit 1; }
done

# 1) Node.js 22.5+ (yerleşik SQLite için gerekli)
node_ok() { command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; }
if ! node_ok; then
  echo ">> Node.js 22 kuruluyor (internet gerekir)..."
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
  node_ok || { echo "Node.js 22.5+ kurulamadı."; exit 1; }
fi
echo ">> Node.js $(node -v)"

# 2) Program dosyaları
id bep >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin bep
mkdir -p "$APP" "$DATA" "$BACKUP" /etc/bep
rm -rf "$APP/public"
cp -r "$SRC/public" "$APP/public"
cp "$SRC/worker.js" "$SRC/schema.sql" "$APP/"
cp "$SRC/linux/server.mjs" "$APP/server.mjs"
chown -R root:root "$APP"
chown -R bep:bep "$DATA" "$BACKUP"
chmod 750 "$DATA"

# 3) Ayar dosyası (varsa dokunulmaz)
NEWKEY=""
if [ ! -f "$CONF" ]; then
  NEWKEY="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
  cat > "$CONF" <<CFG
# BEP Sistemi ayarları - değiştirdikten sonra:  sudo systemctl restart bep
PORT=8080
# Yalnızca bu bilgisayardan erişim: 127.0.0.1   |   Aynı ağdaki herkes: 0.0.0.0
BEP_HOST=127.0.0.1
# Yönetici paneli (/admin) giriş anahtarı
ADMIN_KEY=$NEWKEY
ADMIN_EMAIL=admin@localhost
# Oturum imzalama anahtarı (değiştirirseniz herkes yeniden giriş yapar)
SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
# HTTPS ile (ör. Nginx arkasında) yayınlıyorsanız:
# BEP_SECURE_COOKIES=1
# BEP_TRUST_PROXY=1
# BEP_PUBLIC_URL=https://bep.ornek.com
CFG
  chown root:bep "$CONF"; chmod 640 "$CONF"
fi

# 4) systemd servisi
cat > /etc/systemd/system/bep.service <<'UNIT'
[Unit]
Description=BEP Hazırlama Sistemi
After=network.target

[Service]
User=bep
Group=bep
EnvironmentFile=/etc/bep/bep.env
Environment=BEP_ROOT=/opt/bep BEP_DATA=/var/lib/bep
ExecStart=/usr/bin/env node --no-warnings /opt/bep/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/bep

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable bep >/dev/null 2>&1
systemctl restart bep

# 5) Yedekleme (her gün, son 14 yedek tutulur) ve elle yedek komutu
cat > /usr/local/bin/bep-yedekle <<'BK'
#!/usr/bin/env bash
set -e
set -a; . /etc/bep/bep.env; set +a
OUT="/var/backups/bep/bep-$(date +%F).db"
BEP_ROOT=/opt/bep BEP_DATA=/var/lib/bep runuser -u bep -- node --no-warnings /opt/bep/server.mjs --backup "$OUT"
ls -1t /var/backups/bep/bep-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
BK
chmod +x /usr/local/bin/bep-yedekle
printf '#!/bin/sh\n/usr/local/bin/bep-yedekle >/dev/null 2>&1\n' > /etc/cron.daily/bep-yedek
chmod +x /etc/cron.daily/bep-yedek

# 6) Uygulama menüsü kısayolu
PORT_NOW="$(grep -E '^PORT=' "$CONF" | cut -d= -f2)"; PORT_NOW="${PORT_NOW:-8080}"
cat > /usr/share/applications/bep-sistemi.desktop <<DESK
[Desktop Entry]
Type=Application
Name=BEP Sistemi
Comment=Bireyselleştirilmiş Eğitim Programı hazırlama
Exec=xdg-open http://localhost:$PORT_NOW
Icon=$APP/public/icons/icon-192.png
Categories=Education;
DESK

sleep 2
if systemctl is-active --quiet bep; then
  echo
  echo "=============================================="
  echo " BEP Sistemi kuruldu ve çalışıyor."
  echo " Adres:           http://localhost:$PORT_NOW"
  echo " Yönetici paneli: http://localhost:$PORT_NOW/admin"
  [ -n "$NEWKEY" ] && echo " Yönetici anahtarı: $NEWKEY   (ayrıca: $CONF)"
  echo " Veriler:         $DATA/bep.db"
  echo " Yedek komutu:    sudo bep-yedekle"
  echo "=============================================="
else
  echo "Servis başlamadı. Ayrıntı:  journalctl -u bep -n 50 --no-pager"; exit 1
fi
