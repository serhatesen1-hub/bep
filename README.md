# BEP Sistemi – Cloudflare sürümü

Cloudflare Worker (API) + D1 (veritabanı) + statik uygulama (`public/`).
Adres: https://bep.alanyaozelegitim.net

- `worker.js` – kayıt, giriş, yönetici onayı, veri senkronu, hesap silme
- `schema.sql` – D1 tabloları (bir kez çalıştırıldı)
- `wrangler.jsonc` – bağlamalar. `SECRET` ve `ADMIN_KEY` Cloudflare'de gizli değişken olarak tanımlıdır; depoya yazılmaz.

Dağıtım: Cloudflare → Workers & Pages → bep-sistemi → Settings → Build → Git deposunu bağla (branch: `cloudflare`, deploy komutu: `npx wrangler deploy`).


## Ubuntu Linux sürümü

Aynı uygulama Cloudflare olmadan Ubuntu'da da çalışır (Node.js + SQLite): bkz. [`linux/KURULUM.md`](linux/KURULUM.md). Kurulum: `sudo bash linux/install.sh`.
