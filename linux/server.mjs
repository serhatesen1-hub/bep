// BEP Sistemi - Ubuntu/Linux yerel sunucusu
// worker.js dosyasını DEĞİŞTİRMEDEN çalıştırır: D1 yerine SQLite (node:sqlite), ASSETS yerine yerel klasör.
// Gereksinim: Node.js 22.5 veya üstü. Başka paket gerekmez.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.BEP_ROOT || (fs.existsSync(path.join(here, 'worker.js')) ? here : path.resolve(here, '..'));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.BEP_HOST || '127.0.0.1';
const DATA = process.env.BEP_DATA || path.join(root, 'data');
const PUBLIC_URL = (process.env.BEP_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TRUST_PROXY = process.env.BEP_TRUST_PROXY === '1';
const KEEP_SECURE = process.env.BEP_SECURE_COOKIES === '1'; // HTTPS arkasında çalışıyorsa 1 yapın
fs.mkdirSync(DATA, { recursive: true });

// ---- Gizli değerler ----
let SECRET = process.env.SECRET;
if (!SECRET) { // yoksa bir kez üretip veri klasöründe saklar
  const f = path.join(DATA, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  SECRET = fs.readFileSync(f, 'utf8').trim();
}
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// ---- Veritabanı (D1 uyumlu ince katman) ----
const sqlite = new DatabaseSync(path.join(DATA, 'bep.db'));
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;');
for (const stmt of fs.readFileSync(path.join(root, 'schema.sql'), 'utf8').split(';').map(s => s.trim()).filter(Boolean)) {
  try { sqlite.exec(stmt); } catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
}
const nz = a => a.map(v => v === undefined ? null : typeof v === 'boolean' ? +v : v);
const mk = (sql, args = []) => ({
  bind: (...a) => mk(sql, nz(a)),
  first: async () => { const r = sqlite.prepare(sql).get(...args); return r ? { ...r } : null; },
  all: async () => ({ results: sqlite.prepare(sql).all(...args).map(r => ({ ...r })) }),
  run: async () => { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
  _exec: () => sqlite.prepare(sql).run(...args),
});
const DB = {
  prepare: sql => mk(sql),
  batch: async stmts => {
    sqlite.exec('BEGIN');
    try { const out = stmts.map(s => { const r = s._exec(); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; }); sqlite.exec('COMMIT'); return out; }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  },
};

// ---- Statik dosyalar (Cloudflare "html_handling" davranışı) ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };
const PUB = path.join(root, 'public');
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const ASSETS = {
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p.includes('\0')) return new Response('Bulunamadı', { status: 404 });
    const cands = p.endsWith('/') ? [p + 'index.html'] : [p, p + '.html', p + '/index.html'];
    for (const c of cands) {
      const f = path.join(PUB, path.normalize(c));
      if (!f.startsWith(PUB + path.sep) || path.basename(f).startsWith('_headers')) continue;
      if (isFile(f)) return new Response(req.method === 'HEAD' ? null : fs.readFileSync(f), { status: 200, headers: { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' } });
    }
    return new Response('Bulunamadı', { status: 404 });
  },
};

// ---- E-posta: sunucuda SMTP yoksa gönderilecek iletiler dosyaya yazılır ----
const EMAIL = {
  async send({ from, to, subject, text }) {
    const body = String(text).replaceAll('https://bep.localhost', PUBLIC_URL).replaceAll('https://bep.alanyaozelegitim.net', PUBLIC_URL);
    fs.appendFileSync(path.join(DATA, 'mails.log'), `--- ${new Date().toISOString()}\nKime: ${to}\nKonu: ${subject}\n\n${body}\n\n`);
    console.log(`[e-posta] ${to}: ${subject} (data/mails.log)`);
  },
};

// ---- worker.js'i içe aktar (kopyalamadan) ----
const src = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;
const env = { DB, ASSETS, EMAIL, SECRET, ADMIN_KEY, ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@localhost', FROM_EMAIL: process.env.FROM_EMAIL || 'bep@localhost' };

// ---- Yedek: node server.mjs --backup /yol/bep-yedek.db ----
const bi = process.argv.indexOf('--backup');
if (bi > 0) { const out = path.resolve(process.argv[bi + 1] || `bep-yedek-${new Date().toISOString().slice(0, 10)}.db`); fs.rmSync(out, { force: true }); sqlite.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); console.log('Yedek yazıldı:', out); process.exit(0); }

// ---- HTTP ----
const server = http.createServer(async (rq, rs) => {
  try {
    const chunks = []; let size = 0;
    for await (const c of rq) { size += c.length; if (size > 30e6) { rs.writeHead(413).end(); return; } chunks.push(c); }
    const headers = new Headers();
    for (const [k, v] of Object.entries(rq.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const ip = (TRUST_PROXY && String(rq.headers['x-forwarded-for'] || '').split(',')[0].trim()) || rq.socket.remoteAddress || '0';
    headers.set('CF-Connecting-IP', ip);
    // worker "bep." sunucu adını bekler: iç adres olarak eşlenir
    const url = new URL(rq.url, 'https://bep.localhost');
    if (url.pathname === '/api/family_submit.php') url.hostname = 'localhost'; // aile formu "bep." olmayan adreste kabul edilir
    const hasBody = !['GET', 'HEAD'].includes(rq.method);
    const res = await worker.fetch(new Request(url, { method: rq.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined }), env);
    const out = {};
    res.headers.forEach((v, k) => { if (k !== 'set-cookie' && k !== 'strict-transport-security') out[k] = v; });
    let cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (!KEEP_SECURE) cookies = cookies.map(c => c.replace(/;\s*Secure/i, ''));
    if (cookies.length) out['set-cookie'] = cookies;
    rs.writeHead(res.status, out);
    rs.end(rq.method === 'HEAD' ? undefined : Buffer.from(await res.arrayBuffer()));
  } catch (e) { console.error(e); if (!rs.headersSent) rs.writeHead(500); rs.end('Sunucu hatası'); }
});
server.listen(PORT, HOST, () => {
  console.log(`BEP Sistemi çalışıyor: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (veri: ${DATA})`);
  if (!ADMIN_KEY) console.log('UYARI: ADMIN_KEY tanımlı değil; yönetici paneline giriş yapılamaz.');
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { server.close(); sqlite.close(); process.exit(0); });
