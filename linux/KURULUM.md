# BEP Sistemi – Ubuntu Linux sürümü

Aynı program (aynı `worker.js` ve `public/` klasörü), Cloudflare yerine kendi bilgisayarınızda çalışır.
Veritabanı SQLite'tır, tek dosyadır. Bulut hesabı ve internet bağlantısı gerekmez (yalnızca kurulumda Node.js indirilir).

**Desteklenen:** Ubuntu 22.04 / 24.04 ve üstü (systemd'li Debian tabanlı sistemler).

## Kurulum

```bash
git clone -b cloudflare https://github.com/serhatesen1-hub/bep.git
cd bep
sudo bash linux/install.sh
```

Betik sırasıyla Node.js 22'yi (yoksa), programı `/opt/bep` altına, ayarları `/etc/bep/bep.env` dosyasına kurar ve `bep` servisini başlatır.
Sonunda yönetici anahtarını ekrana yazar. Bunu not alın.

- Uygulama: http://localhost:8080
- Yönetici paneli: http://localhost:8080/admin (anahtar: kurulumda ekrana yazılan)
- Uygulama menüsünde "BEP Sistemi" kısayolu da oluşur.

## İlk kullanım

1. Adrese gidip **Kayıt ol** ile hesap açın.
2. `/admin` sayfasına yönetici anahtarıyla girip hesabı **Onayla**.
3. Giriş yapıp öğrenci ekleyin.

Yönetici onayı e-posta ile gelmez; yeni kayıtlar panelde "Bekleyen" olarak görünür. Sistemin göndereceği e-postalar `/var/lib/bep/mails.log` dosyasına yazılır.

## Günlük işler

| İş | Komut |
|---|---|
| Durum | `systemctl status bep` |
| Kayıtlar (log) | `journalctl -u bep -f` |
| Yeniden başlat | `sudo systemctl restart bep` |
| Ayarlar | `sudo nano /etc/bep/bep.env` sonra yeniden başlat |
| Elle yedek | `sudo bep-yedekle` (dosya: `/var/backups/bep/`) |
| Güncelleme | `git pull` + `sudo bash linux/install.sh` (veri ve ayarlar korunur) |
| Kaldırma | `sudo bash linux/uninstall.sh` (veri silinmez) |

Her gün otomatik yedek alınır, son 14 yedek tutulur. Verilerin kendisi `/var/lib/bep/bep.db` dosyasıdır; bu dosyayı kopyalayarak başka bilgisayara taşıyabilirsiniz (servisi durdurup `bep.db`, `bep.db-wal`, `bep.db-shm` ve `.secret` dosyalarını birlikte kopyalayın).

## Ağdan erişim (okuldaki diğer bilgisayarlar)

`/etc/bep/bep.env` içinde `BEP_HOST=0.0.0.0` yapıp `sudo systemctl restart bep` deyin. Diğer bilgisayarlar `http://SUNUCU_IP:8080` adresini açar.
Bu bağlantı şifrelenmez (HTTP). Öğrenci verileri taşındığı için okul ağı dışına açmayın. İnternete açacaksanız Nginx/Caddy ile HTTPS kurun ve ayara şunları ekleyin:

```
BEP_SECURE_COOKIES=1
BEP_TRUST_PROXY=1
BEP_PUBLIC_URL=https://bep.ornek.com
```

## Notlar

- Cloudflare'deki canlı sitenin verileri bu kuruluma otomatik aktarılmaz; iki sistem ayrı veritabanı kullanır.
- Kişisel veriler (KVKK) bu bilgisayarda tutulur; yedeklerin ve erişimin sorumluluğu sizdedir. `/etc/bep/bep.env` ve `/var/lib/bep` yalnızca `bep` kullanıcısı ve root tarafından okunabilir.
- Geliştirme için kurmadan denemek: `ADMIN_KEY=deneme PORT=8080 node --no-warnings linux/server.mjs` (Node 22.5+; veri `./data` klasörüne yazılır).
