// BEP Hazırlama Sistemi - Cloudflare Worker (API + statik dosyalar) | D1 veritabanı

const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const un64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const CHUNK = 700000;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}
function html(body, status = 200) {
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BEP</title><body style="font-family:system-ui;max-width:560px;margin:40px auto;padding:0 16px">' + body,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } });
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function hashPass(pass, saltB64) {
  const salt = saltB64 ? un64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return 'p1$' + b64u(salt) + '$' + b64u(bits);
}
async function verifyPass(pass, stored) {
  const p = stored.split('$'); if (p[0] !== 'p1') return false;
  const h = await hashPass(pass, p[1]);
  return timingEq(h, stored);
}
function timingEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
const approvalToken = (env, id) => hmac(env.SECRET, 'approve|' + id);

function cookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
async function currentUser(req, env) {
  const tok = cookie(req, 'bepsid'); if (!tok) return null;
  const h = await sha256(tok);
  const r = await env.DB.prepare('SELECT u.id,u.email,u.first_name,u.last_name,u.branch,u.status,s.exp FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.tok=?').bind(h).first();
  if (!r || r.exp < Date.now() / 1000 || r.status !== 'active') return null;
  return r;
}
async function throttle(env, key, max, windowSec) {
  const t = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM attempts WHERE ts < ?').bind(t - 86400).run();
  const c = await env.DB.prepare('SELECT COUNT(*) c FROM attempts WHERE k=? AND ts>?').bind(key, t - windowSec).first();
  if (c.c >= max) return json({ error: 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.' }, 429);
  await env.DB.prepare('INSERT INTO attempts(k,ts) VALUES(?,?)').bind(key, t).run();
  return null;
}
async function sendMail(env, to, subject, text) {
  try {
    if (!env.EMAIL) return false;
    await env.EMAIL.send({ from: { email: env.FROM_EMAIL, name: 'BEP Sistemi' }, to, subject, text });
    return true;
  } catch (e) { console.log('mail error', String(e)); return false; }
}
async function audit(env, req, actor, action, target, detail) {
  try { await env.DB.prepare('INSERT INTO audit(ts,actor,action,target_id,detail,country) VALUES(?,?,?,?,?,?)').bind(now(), actor, action, target ?? null, detail ? String(detail).slice(0, 300) : null, (req && req.cf && req.cf.country) || null).run(); } catch (e) { console.log('audit', String(e)); }
}
async function adminOk(req, env) {
  const c = cookie(req, 'bepadm'); if (!c || !env.SECRET) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return timingEq(await hmac(env.SECRET, 'adm|' + exp), sig);
}
async function readJson(req, max) {
  const raw = await req.text();
  if (raw.length > max) throw json({ error: 'İstek çok büyük.' }, 413);
  try { const d = JSON.parse(raw); if (d && typeof d === 'object') return d; } catch (e) {}
  throw json({ error: 'Geçersiz istek.' }, 400);
}


const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
async function familySubmit(req, env) {
  if (req.method !== 'POST' || req.headers.get('X-BEP') !== '1') return json({ error: 'Geçersiz istek.' }, 400);
  const ip = req.headers.get('CF-Connecting-IP') || '0';
  const th = await throttle(env, 'fam:' + ip, 5, 3600); if (th) return th;
  const d = await readJson(req, 30000);
  const name = clip(d.name, 120).trim(); let phone = clip(d.phone, 20).replace(/\D/g, '').slice(0, 15);
  if (phone && String(d.phone).trim().startsWith('+')) phone = '+' + phone;
  if (!name || phone.replace(/\D/g, '').length < 8) return json({ error: 'Ad soyad ve geçerli bir telefon numarası gerekli.' }, 422);
  const row = { lang: clip(d.language, 4), name, phone, gender: clip(d.gender, 30), age: clip(d.exactAge, 30), track: clip(d.trackTitle, 200), results: clip(d.testResults, 12000), summary: clip(d.quickSummary, 2000) };
  await env.DB.prepare('INSERT INTO family_leads(created_at,lang,name,phone,gender,age,track,results,summary,country) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(now(), row.lang, row.name, row.phone, row.gender, row.age, row.track, row.results, row.summary, (req.cf && req.cf.country) || null).run();
  await audit(env, req, 'family', 'family_submit', null, row.track);
  await sendMail(env, env.ADMIN_EMAIL, 'Yeni aile ön değerlendirmesi: ' + row.name,
    `Yeni bir aile ön değerlendirmesi geldi.\n\nVeli: ${row.name}\nTelefon: ${row.phone}\nÇocuk: ${row.gender}, ${row.age}\nBölüm: ${row.track}\nDil: ${row.lang}\n\n${row.summary}\n\nAyrıntılar için yönetici panelini açın: https://bep.alanyaozelegitim.net/admin\n`);
  return json({ ok: true });
}

async function adminApi(req, env, name, url, xhr) {
  const m = req.method;
  if (name === 'admin_login' && m === 'POST') {
    if (!xhr) return json({ error: 'Geçersiz istek.' }, 400);
    const ip = req.headers.get('CF-Connecting-IP') || '0';
    const th = await throttle(env, 'adm:' + ip, 6, 900); if (th) return th;
    const d = await readJson(req, 2000);
    if (!env.ADMIN_KEY || !timingEq(await sha256(String(d.key || '')), await sha256(env.ADMIN_KEY))) { await audit(env, req, 'anon', 'admin_login_failed', null, null); return json({ error: 'Yönetici anahtarı hatalı.' }, 401); }
    const exp = Math.floor(Date.now() / 1000) + 7200;
    await audit(env, req, 'admin', 'admin_login', null, null);
    return json({ ok: true }, 200, { 'Set-Cookie': `bepadm=${exp}.${await hmac(env.SECRET, 'adm|' + exp)}; Path=/; Max-Age=7200; HttpOnly; Secure; SameSite=Strict` });
  }
  if (name === 'admin_logout' && m === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': 'bepadm=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict' });
  if (!(await adminOk(req, env))) return json({ error: 'Yönetici oturumu gerekli.' }, 401);
  if (m !== 'GET' && !xhr) return json({ error: 'Geçersiz istek.' }, 400);

  if (name === 'admin_users' && m === 'GET') {
    const rows = (await env.DB.prepare('SELECT id,email,first_name,last_name,branch,status,created_at,approved_at,last_login,login_count,last_save,students_count FROM users ORDER BY id DESC LIMIT 1000').all()).results;
    const tot = { all: rows.length, pending: 0, active: 0, disabled: 0, rejected: 0, students: 0 };
    rows.forEach(r => { tot[r.status] = (tot[r.status] || 0) + 1; tot.students += r.students_count || 0; });
    return json({ users: rows, totals: tot });
  }
  if (name === 'admin_user' && m === 'GET') {
    const id = parseInt(url.searchParams.get('id') || '0');
    const u = await env.DB.prepare('SELECT id,email,first_name,last_name,branch,status,created_at,approved_at,last_login,login_count,last_save,students_count FROM users WHERE id=?').bind(id).first();
    if (!u) return json({ error: 'Kullanıcı bulunamadı.' }, 404);
    let data = null;
    if (url.searchParams.get('data') === '1') {
      const meta = await env.DB.prepare('SELECT rev FROM userdata WHERE user_id=?').bind(id).first();
      if (meta) { const parts = (await env.DB.prepare('SELECT part FROM chunks WHERE user_id=? ORDER BY idx').bind(id).all()).results; data = JSON.parse(parts.map(p => p.part).join('')); }
      await audit(env, req, 'admin', 'admin_view_data', id, u.email);
    }
    const logs = (await env.DB.prepare("SELECT ts,actor,action,detail,country FROM audit WHERE target_id=? OR actor=? ORDER BY id DESC LIMIT 100").bind(id, 'user:' + id).all()).results;
    return json({ user: u, data, logs });
  }
  if (name === 'admin_family' && m === 'GET') {
    const id = parseInt(url.searchParams.get('id') || '0');
    if (id) { const r = await env.DB.prepare('SELECT * FROM family_leads WHERE id=?').bind(id).first(); if (!r) return json({ error: 'Kayıt bulunamadı.' }, 404); await audit(env, req, 'admin', 'admin_view_family', null, r.name); return json({ lead: r }); }
    const rows = (await env.DB.prepare('SELECT id,created_at,lang,name,phone,gender,age,track,summary,handled FROM family_leads ORDER BY id DESC LIMIT 500').all()).results;
    return json({ leads: rows });
  }
  if (name === 'admin_family_action' && m === 'POST') {
    const d = await readJson(req, 2000); const id = parseInt(d.id || 0);
    if (d.action === 'handled') { await env.DB.prepare('UPDATE family_leads SET handled=? WHERE id=?').bind(d.value ? 1 : 0, id).run(); return json({ ok: true }); }
    if (d.action === 'delete') { await audit(env, req, 'admin', 'admin_delete_family', null, String(id)); await env.DB.prepare('DELETE FROM family_leads WHERE id=?').bind(id).run(); return json({ ok: true }); }
    return json({ error: 'Geçersiz işlem.' }, 422);
  }
  if (name === 'admin_audit' && m === 'GET') {
    const logs = (await env.DB.prepare('SELECT a.id,a.ts,a.actor,a.action,a.target_id,a.detail,a.country,u.email FROM audit a LEFT JOIN users u ON u.id=a.target_id ORDER BY a.id DESC LIMIT 300').all()).results;
    return json({ logs });
  }
  if (name === 'admin_action' && m === 'POST') {
    const d = await readJson(req, 2000); const id = parseInt(d.id || 0); const act = String(d.action || '');
    const u = await env.DB.prepare('SELECT id,email,first_name,status FROM users WHERE id=?').bind(id).first();
    if (!u) return json({ error: 'Kullanıcı bulunamadı.' }, 404);
    const set = { approve: 'active', reject: 'rejected', disable: 'disabled', enable: 'active' }[act];
    if (set) {
      await env.DB.prepare('UPDATE users SET status=?' + (act === 'approve' ? ', approved_at=?' : '') + ' WHERE id=?').bind(...(act === 'approve' ? [set, now(), id] : [set, id])).run();
      if (set !== 'active') await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
      await audit(env, req, 'admin', 'admin_' + act, id, u.email);
      if (act === 'approve') await sendMail(env, u.email, 'BEP hesabınız onaylandı', `Merhaba ${u.first_name},\n\nHesabınız onaylandı. Şu adresten giriş yapabilirsiniz:\n${url.origin}/\n`);
      return json({ ok: true });
    }
    if (act === 'delete') {
      if (d.confirm !== u.email) return json({ error: 'Silmek için e-posta adresini aynen yazın.' }, 422);
      await audit(env, req, 'admin', 'admin_delete', id, u.email);
      await env.DB.batch([env.DB.prepare('DELETE FROM chunks WHERE user_id=?').bind(id), env.DB.prepare('DELETE FROM userdata WHERE user_id=?').bind(id), env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id), env.DB.prepare('DELETE FROM users WHERE id=?').bind(id)]);
      return json({ ok: true });
    }
    return json({ error: 'Geçersiz işlem.' }, 422);
  }
  return json({ error: 'Bulunamadı.' }, 404);
}

async function api(req, env, name, url) {
  const m = req.method;
  const xhr = req.headers.get('X-BEP') === '1';
  const origin = url.origin;

  if (name === 'me') {
    const u = await currentUser(req, env);
    return json(u ? { user: { id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, branch: u.branch } } : { user: null });
  }
  if (name === 'approve') {
    const id = parseInt(url.searchParams.get('id') || '0'); const t = url.searchParams.get('t') || '';
    if (!id || !timingEq(await approvalToken(env, id), t)) return html('<h2>Geçersiz bağlantı</h2>', 403);
    const u = await env.DB.prepare('SELECT id,email,first_name,last_name,branch,status FROM users WHERE id=?').bind(id).first();
    if (!u) return html('<h2>Kullanıcı bulunamadı</h2>', 404);
    if (m === 'POST') {
      const fd = await req.formData(); const act = fd.get('action');
      if (act === 'approve') {
        await env.DB.prepare("UPDATE users SET status='active', approved_at=? WHERE id=?").bind(now(), id).run();
        await audit(env, req, 'admin', 'approve', id, u.email);
        await sendMail(env, u.email, 'BEP hesabınız onaylandı', `Merhaba ${u.first_name},\n\nHesabınız onaylandı. Şu adresten giriş yapabilirsiniz:\n${origin}/\n`);
        return html('<h2>Onaylandı ✔</h2><p>' + esc(u.first_name + ' ' + u.last_name) + ' artık giriş yapabilir.</p>');
      }
      if (act === 'reject') { await env.DB.prepare("UPDATE users SET status='rejected' WHERE id=?").bind(id).run(); await audit(env, req, 'admin', 'reject', id, u.email); return html('<h2>Reddedildi</h2>'); }
    }
    return html(`<h2>Kullanıcı onayı</h2><p><b>${esc(u.first_name + ' ' + u.last_name)}</b><br>${esc(u.email)}<br>Branş: ${esc(u.branch)}<br>Durum: ${esc(u.status)}</p>
<form method="post"><button name="action" value="approve" style="padding:12px 20px;background:#12805c;color:#fff;border:0;border-radius:8px;font-size:16px">Onayla</button>
<button name="action" value="reject" style="padding:12px 20px;background:#d62d2d;color:#fff;border:0;border-radius:8px;font-size:16px;margin-left:8px">Reddet</button></form>`);
  }
  if (name.startsWith('admin_')) return adminApi(req, env, name, url, xhr);
  // buradan sonrası JSON + X-BEP başlığı ister (GET data hariç)
  if (name === 'register' && m === 'POST') {
    if (!xhr) return json({ error: 'Geçersiz istek.' }, 400);
    const d = await readJson(req, 20000);
    const email = String(d.email || '').trim().toLowerCase(), pass = String(d.password || '');
    const first = String(d.firstName || '').trim(), last = String(d.lastName || '').trim(), branch = String(d.branch || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 190) return json({ error: 'Geçerli bir e-posta girin.' }, 422);
    if (pass.length < 8 || pass.length > 200) return json({ error: 'Şifre en az 8 karakter olmalı.' }, 422);
    if (!first || !last || first.length > 80 || last.length > 80) return json({ error: 'Ad ve soyad gerekli.' }, 422);
    if (branch.length > 120) return json({ error: 'Branş çok uzun.' }, 422);
    if (!d.consent) return json({ error: 'Aydınlatma metnini ve sorumluluk beyanını onaylamalısınız.' }, 422);
    const ip = req.headers.get('CF-Connecting-IP') || '0';
    const th = await throttle(env, 'reg:' + ip, 5, 3600); if (th) return th;
    if (await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first()) return json({ error: 'Bu e-posta ile daha önce kayıt olunmuş. Giriş yapmayı deneyin.' }, 409);
    const r = await env.DB.prepare('INSERT INTO users(email,pass_hash,first_name,last_name,branch,status,consent_at,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(email, await hashPass(pass), first, last, branch, 'pending', now(), now()).run();
    const uid = r.meta.last_row_id;
    await audit(env, req, 'user:' + uid, 'register', uid, email);
    const link = `${origin}/api/approve.php?id=${uid}&t=${await approvalToken(env, uid)}`;
    const ok = await sendMail(env, env.ADMIN_EMAIL, `Yeni BEP kullanıcı kaydı: ${first} ${last}`,
      `Yeni bir kullanıcı kayıt oldu ve onayınızı bekliyor.\n\nAd Soyad: ${first} ${last}\nE-posta: ${email}\nBranş: ${branch}\nTarih: ${now()} (UTC)\n\nİnceleyip onaylamak veya reddetmek için bağlantıyı açın:\n${link}\n\nBu kaydı siz beklemiyorsanız bağlantıyı açmayın.`);
    return json({ ok: true, message: 'Kaydınız alındı. Yönetici onayından sonra giriş yapabilirsiniz.', mail: ok });
  }
  if (name === 'login' && m === 'POST') {
    if (!xhr) return json({ error: 'Geçersiz istek.' }, 400);
    const d = await readJson(req, 5000);
    const email = String(d.email || '').trim().toLowerCase(), pass = String(d.password || '');
    const ip = req.headers.get('CF-Connecting-IP') || '0';
    let th = await throttle(env, 'login:' + ip, 20, 900); if (th) return th;
    th = await throttle(env, 'loginu:' + email, 8, 900); if (th) return th;
    const u = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    const ok = u ? await verifyPass(pass, u.pass_hash) : (await hashPass(pass), false);
    if (!ok) { await audit(env, req, 'anon', 'login_failed', u ? u.id : null, email); return json({ error: 'E-posta veya şifre hatalı.' }, 401); }
    if (u.status === 'pending') return json({ error: 'Hesabınız henüz yönetici tarafından onaylanmadı.' }, 403);
    if (u.status !== 'active') return json({ error: 'Hesabınız etkin değil. Lütfen yönetici ile iletişime geçin.' }, 403);
    await env.DB.prepare('UPDATE users SET last_login=?, login_count=login_count+1 WHERE id=?').bind(now(), u.id).run();
    await audit(env, req, 'user:' + u.id, 'login', u.id, null);
    const tok = hex(crypto.getRandomValues(new Uint8Array(32)));
    const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
    await env.DB.prepare('INSERT INTO sessions(tok,user_id,exp) VALUES(?,?,?)').bind(await sha256(tok), u.id, exp).run();
    await env.DB.prepare('DELETE FROM sessions WHERE exp < ?').bind(Math.floor(Date.now() / 1000)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': `bepsid=${tok}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax` });
  }
  if (name === 'logout' && m === 'POST') {
    const tok = cookie(req, 'bepsid');
    if (tok) await env.DB.prepare('DELETE FROM sessions WHERE tok=?').bind(await sha256(tok)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': 'bepsid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' });
  }
  if (name === 'data') {
    const u = await currentUser(req, env); if (!u) return json({ error: 'Oturum gerekli.' }, 401);
    if (m === 'GET') {
      const meta = await env.DB.prepare('SELECT rev,n FROM userdata WHERE user_id=?').bind(u.id).first();
      if (!meta) return json({ data: null, rev: 0 });
      const parts = (await env.DB.prepare('SELECT part FROM chunks WHERE user_id=? ORDER BY idx').bind(u.id).all()).results;
      return json({ data: JSON.parse(parts.map(p => p.part).join('')), rev: meta.rev });
    }
    if (!xhr) return json({ error: 'Geçersiz istek.' }, 400);
    if (m === 'PUT' || m === 'POST') {
      const d = await readJson(req, 8388608);
      const data = d.data, base = parseInt(d.rev || 0);
      if (!data || typeof data !== 'object' || !Array.isArray(data.students)) return json({ error: 'Geçersiz veri.' }, 422);
      const str = JSON.stringify(data);
      const parts = []; for (let i = 0; i < str.length; i += CHUNK) parts.push(str.slice(i, i + CHUNK));
      const meta = await env.DB.prepare('SELECT rev FROM userdata WHERE user_id=?').bind(u.id).first();
      if (!meta && base !== 0) return json({ error: 'Sürüm çakışması', conflict: true }, 409);
      if (meta && meta.rev !== base) return json({ error: 'Başka bir cihazda daha yeni değişiklik var. Sayfayı yenileyin.', conflict: true }, 409);
      const newRev = base + 1;
      const stmts = [];
      if (meta) stmts.push(env.DB.prepare('UPDATE userdata SET rev=?, n=?, updated_at=? WHERE user_id=? AND rev=?').bind(newRev, parts.length, now(), u.id, base));
      else stmts.push(env.DB.prepare('INSERT INTO userdata(user_id,rev,n,updated_at) VALUES(?,?,?,?)').bind(u.id, newRev, parts.length, now()));
      stmts.push(env.DB.prepare('DELETE FROM chunks WHERE user_id=?').bind(u.id));
      parts.forEach((p, i) => stmts.push(env.DB.prepare('INSERT INTO chunks(user_id,idx,part) VALUES(?,?,?)').bind(u.id, i, p)));
      stmts.push(env.DB.prepare('UPDATE users SET last_save=?, students_count=? WHERE id=?').bind(now(), data.students.length, u.id));
      await env.DB.batch(stmts);
      return json({ ok: true, rev: newRev });
    }
    return json({ error: 'Yöntem desteklenmiyor.' }, 405);
  }
  if (name === 'delete_account' && m === 'POST') {
    if (!xhr) return json({ error: 'Geçersiz istek.' }, 400);
    const u = await currentUser(req, env); if (!u) return json({ error: 'Oturum gerekli.' }, 401);
    const d = await readJson(req, 5000);
    const row = await env.DB.prepare('SELECT pass_hash FROM users WHERE id=?').bind(u.id).first();
    if (!row || !(await verifyPass(String(d.password || ''), row.pass_hash))) return json({ error: 'Şifre hatalı.' }, 403);
    await audit(env, req, 'user:' + u.id, 'delete_account', u.id, u.email);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM chunks WHERE user_id=?').bind(u.id), env.DB.prepare('DELETE FROM userdata WHERE user_id=?').bind(u.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id), env.DB.prepare('DELETE FROM users WHERE id=?').bind(u.id)]);
    return json({ ok: true }, 200, { 'Set-Cookie': 'bepsid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' });
  }
  return json({ error: 'Bulunamadı.' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.protocol === 'http:' && url.hostname !== 'localhost') { url.protocol = 'https:'; return Response.redirect(url.toString(), 301); }
    try {
      if (url.pathname.startsWith('/api/') && url.hostname.startsWith('bep.')) {
        const name = url.pathname.slice(5).replace(/\.php$/, '');
        return await api(req, env, name, url);
      }
      const host = url.hostname;
      if (url.pathname === '/api/family_submit.php' && !host.startsWith('bep.')) return await familySubmit(req, env);
      let areq = req;
      if (!host.startsWith('bep.') && host !== 'localhost') {
        if (host.startsWith('www.')) { url.hostname = host.slice(4); return Response.redirect(url.toString(), 301); }
        if (url.pathname === '/' || url.pathname === '/index.html') { url.pathname = '/landing'; areq = new Request(url.toString(), req); }
        else if (!(url.pathname.startsWith('/fonts/') || ['/landing', '/landing.html', '/gizlilik', '/gizlilik.html', '/aile', '/aile.html', '/aile.js', '/aile.css', '/aile-gizlilik', '/aile-gizlilik.html', '/site.css', '/tema.css', '/favicon.svg', '/favicon.ico', '/icons/apple-touch-icon.png', '/icons/maskable-512.png', '/icons/icon-192.png', '/icons/icon-512.png'].includes(url.pathname))) return new Response('Bulunamadı', { status: 404 });
      }
      const res = await env.ASSETS.fetch(areq);
      const h = new Headers(res.headers);
      h.set('X-Content-Type-Options', 'nosniff'); h.set('Referrer-Policy', 'no-referrer'); h.set('Strict-Transport-Security', 'max-age=31536000');
      if (['/', '/index.html', '/sw.js', '/config.js'].includes(url.pathname)) h.set('Cache-Control', 'no-cache');
      return new Response(res.body, { status: res.status, headers: h });
    } catch (e) {
      if (e instanceof Response) return e;
      console.log('hata', String(e && e.stack || e));
      return json({ error: 'Sunucu hatası.' }, 500);
    }
  }
};
