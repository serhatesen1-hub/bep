#!/usr/bin/env bash
# BEP Sistemi'ni kaldırır. Veriler (/var/lib/bep) ve yedekler silinmez; isterseniz elle silin.
set -e
[ "$(id -u)" -eq 0 ] || { echo "sudo ile çalıştırın."; exit 1; }
systemctl disable --now bep 2>/dev/null || true
rm -f /etc/systemd/system/bep.service /usr/local/bin/bep-yedekle /etc/cron.daily/bep-yedek /usr/share/applications/bep-sistemi.desktop
rm -rf /opt/bep
systemctl daemon-reload
echo "Kaldırıldı. Veriler korundu: /var/lib/bep, /var/backups/bep, /etc/bep"
