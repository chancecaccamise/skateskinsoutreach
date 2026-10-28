import http from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { ACTION_LABELS, AUTO_TASK_TITLES, BASIS, FOLLOW_UPS, LABELS, PRIORITIES, SEGMENTS, STAGES, TOUCH_STAGES, addDays, nextStages, clean, contactKey, metrics, norm, orgKey, parseCsv, stageFrom, validEmail, validateContact, validateOrg, isoDate } from './lib/outreach.mjs';
import { access, auth, checkImportSchema, claims, fingerprint, insertNew, loadAll, saveChanges, supabaseConfig } from './lib/supabase.mjs';
import { applyUpdates, planImport, sourcesFromFiles, summarize } from './lib/lead-import.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
try { process.loadEnvFile(join(root, '.env')); } catch {}
const cfg = supabaseConfig();
const local = process.env.OUTREACH_DATA_DIR || join(root, '.local');
const dataPath = join(local, 'outreach.json');
const port = Number(process.env.PORT || 4173);
const host = '127.0.0.1';
const empty = () => ({ version: 1, orgs: [], contacts: [], activities: [], tasks: [], suggestions: [] });
const playbook = JSON.parse(readFileSync(new URL('./lib/playbook.json', import.meta.url), 'utf8'));
// On Vercel the filesystem is read-only, so local mode is not available there.
const missingSupabase = !cfg && process.env.VERCEL ? 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the Vercel project settings, then redeploy.' : '';
// Local mode keeps one in-memory db. Supabase mode keeps a cached copy and reuses it only while the database's newest change
// (its fingerprint) is unchanged, so edits from another admin, another server instance, or the import script show up at once.
let db = null, ctx = null, cache = null;
if (!cfg && !missingSupabase) {
  mkdirSync(local, { recursive: true, mode: 0o700 });
  db = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, 'utf8')) : empty();
  for (const key of ['orgs', 'contacts', 'activities', 'tasks', 'suggestions']) db[key] ||= [];
  for (const org of db.orgs) { org.stage = stageFrom(org.stage) || 'not_contacted'; if (org.location && !org.city) org.city = org.location; delete org.location; }
}
async function save() {
  if (cfg) {
    try { await saveChanges(cfg, ctx.token, ctx.user.id, db); } catch (e) { cache = null; throw e; }
    if (cache) cache.print = await fingerprint(cfg, ctx.token).catch(() => null); return;
  }
  const tmp = `${dataPath}.tmp`; writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 }); renameSync(tmp, dataPath);
}
function id() { return randomUUID(); }
function now() { return new Date().toISOString(); }
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'" };
// Responses are gzipped when the browser accepts it: the full lead list is several MB as JSON (Vercel caps responses at 4.5 MB).
function send(res, status, data, headers = {}) {
  let out = JSON.stringify(data); const zip = res.gzip && out.length > 1024;
  if (zip) out = gzipSync(out);
  res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...(zip ? { 'Content-Encoding': 'gzip' } : {}), ...headers }); res.end(out);
}
async function body(req, max = 2_000_000) {
  // Vercel may have parsed the body already.
  if ('body' in req && req.body != null) { if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body; const text = String(req.body); if (text.length > max) fail('Request is too large', 413); try { return JSON.parse(text || '{}'); } catch { fail('Invalid JSON'); } }
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > max) fail('Request is too large', 413); }
  try { return JSON.parse(text || '{}'); } catch { fail('Invalid JSON'); }
}
function orgOrFail(orgId) { const org = db.orgs.find(o => o.id === orgId); if (!org) fail('Organization not found', 404); return org; }
function duplicate(org, excludeId = '') { const key = orgKey(org); return db.orgs.find(o => o.id !== excludeId && orgKey(o) === key); }
function validOrg(raw) { try { return validateOrg(raw); } catch (e) { fail(e.message); } }
const label = stage => LABELS[stage] || stage.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
// Which buttons each stage offers, for teams and for everyone else (rinks, shops, chains).
const flow = { actions: ACTION_LABELS, followUps: FOLLOW_UPS, team: Object.fromEntries(STAGES.map(s => [s, nextStages({ segment: 'team', stage: s })])), other: Object.fromEntries(STAGES.map(s => [s, nextStages({ segment: 'rink', stage: s })])) };
const localDay = () => new Date().toLocaleDateString('en-CA');
// A one-click outreach button: move the stage, record the touch, replace the automatic reminder, and log it.
function advance(org, stage) {
  const old = org.stage, today = localDay();
  for (const t of db.tasks) if (t.orgId === org.id && t.status === 'open' && AUTO_TASK_TITLES.includes(t.title)) { t.status = 'done'; t.updatedAt = now(); }
  org.stage = stage; org.updatedAt = now(); if (TOUCH_STAGES.includes(stage)) org.lastContacted = today;
  const plan = FOLLOW_UPS[stage], task = plan ? { id: id(), orgId: org.id, title: plan.title, dueDate: addDays(today, plan.days), status: 'open', createdAt: now(), updatedAt: now() } : null;
  if (task) db.tasks.push(task);
  log(org.id, 'stage', `${ACTION_LABELS[stage]}. Moved from ${label(old)} to ${label(stage)}.${task ? ` Next: "${task.title}" due ${task.dueDate}.` : ''}`);
  return task;
}
function log(orgId, type, note) { db.activities.unshift({ id: id(), orgId, type, note, date: now(), createdAt: now() }); }
function createOrg(raw, reason = 'manual') {
  const values = validOrg(raw);
  const found = duplicate(values); if (found) fail(`Possible duplicate: ${found.name}`, 409);
  const org = { id: id(), ...values, createdAt: now(), updatedAt: now() };
  db.orgs.unshift(org); log(org.id, 'created', reason === 'csv' ? 'Imported from CSV' : reason === 'suggestion' ? 'Approved research suggestion' : 'Created manually');
  return org;
}
function cleanContact(raw, orgId, checkOrg = true) {
  if (checkOrg) orgOrFail(orgId);
  try { return validateContact({ ...raw, orgId }); } catch (e) { fail(e.message); }
}
// CSV columns are the snake_case form of the organization fields, e.g. postal_code, miles_from_hub. "location" is the old name for city.
const csvFields = ['name', 'segment', 'category', 'stage', 'priority', 'owner', 'website', 'phone', 'email', 'address', 'city', 'location', 'region', 'postalCode', 'country', 'jurisdiction', 'zone', 'milesFromHub', 'leagueChain', 'social', 'sourceUrl', 'researchDate', 'externalId', 'contactBasis', 'notes', 'nextStep', 'lastContacted', 'inquiryId', 'designId', 'checkoutLinkId', 'orderId', 'orderAmount', 'orderCurrency'];
const snake = key => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const yes = value => /^(true|yes|1)$/i.test(value || '');
async function importCsv(csv) {
  const rows = parseCsv(csv); const result = { added: 0, skipped: [], errors: [] };
  for (const row of rows) {
    try {
      const raw = { ...Object.fromEntries(csvFields.map(k => [k, row[snake(k)]])), optOut: yes(row.opt_out), suppressed: yes(row.suppressed) };
      const values = validOrg(raw);
      if (duplicate(values)) fail(`Possible duplicate: ${row.name}`, 409);
      let contact = null;
      if (row.contact_name) {
        const email = clean(row.contact_email).toLowerCase();
        if (email && db.contacts.some(c => norm(c.email) === norm(email))) fail(`Possible duplicate contact: ${email}`, 409);
        contact = cleanContact({ name: row.contact_name, role: row.contact_role, email, phone: row.contact_phone, contactBasis: row.contact_basis || 'unknown', sourceUrl: row.contact_source_url || row.source_url, optOut: yes(row.contact_opt_out), suppressed: yes(row.contact_suppressed) }, '', false);
      }
      const org = createOrg(values, 'csv'); result.added++;
      if (contact) db.contacts.push({ id: id(), ...contact, orgId: org.id, createdAt: now(), updatedAt: now() });
    } catch (e) { (e.status === 409 ? result.skipped : result.errors).push({ row: row._row, name: row.name, reason: e.message }); }
  }
  await save(); return result;
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, 'public', `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(resolve(root, 'public') + '/') || !existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { ...securityHeaders, 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}

const cookieAttrs = res => `Path=/; HttpOnly; SameSite=Strict${res.secure ? '; Secure' : ''}`;
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])); }
function setSession(res, s) { res.setHeader('Set-Cookie', [`ss_at=${s.access_token}; ${cookieAttrs(res)}; Max-Age=${s.expires_in}`, `ss_rt=${s.refresh_token}; ${cookieAttrs(res)}; Max-Age=${60 * 60 * 24 * 30}`]); }
function clearSession(res) { res.setHeader('Set-Cookie', ['ss_at', 'ss_rt'].map(name => `${name}=; ${cookieAttrs(res)}; Max-Age=0`)); }
function sessionFrom(token) { const c = claims(token); return { token, user: { id: c.sub, email: c.email } }; }
async function session(req, res) {
  const c = cookies(req); if (!c.ss_rt) fail('Sign in required', 401);
  if (c.ss_at && (claims(c.ss_at).exp || 0) * 1000 > Date.now() + 60_000) return sessionFrom(c.ss_at);
  try { const s = await auth.refresh(cfg, c.ss_rt); setSession(res, s); return sessionFrom(s.access_token); }
  catch (e) { if (e.status === 502) throw e; clearSession(res); fail('Session expired. Sign in again', 401); }
}
// A signed-in account without access records its request (with its name) and is told where it stands. It gets no session.
async function refuseUntilApproved(s) {
  let status = null;
  try { await access.request(cfg, s.access_token, { id: s.user.id, email: s.user.email, name: s.user.user_metadata?.name }); status = await access.mine(cfg, s.access_token, s.user.id); } catch {}
  await auth.signOut(cfg, s.access_token);
  fail(status === 'denied' ? 'Access to Outreach was declined for this account. Ask an admin if this is a mistake.' : 'Your account is waiting for an admin to approve it. You can sign in once it is approved.', 403);
}
async function authRoute(req, res, url) {
  if (url.pathname === '/api/session' && req.method === 'GET') {
    if (!cfg) return send(res, 200, { mode: 'local', user: null });
    try { const s = await session(req, res); if (!(await auth.isAdmin(cfg, s.token))) fail('Not an outreach admin', 403); return send(res, 200, { mode: 'supabase', user: { email: s.user.email } }); }
    catch (e) { if (![401, 403].includes(e.status)) throw e; clearSession(res); return send(res, 200, { mode: 'supabase', user: null }); }
  }
  if (!cfg) fail('Sign-in is only available when Supabase is configured', 404);
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const raw = await body(req), email = clean(raw.email), password = String(raw.password ?? '');
    if (!email || !password) fail('Email and password are required');
    let s; try { s = await auth.signIn(cfg, email, password); } catch (e) { if (e.status === 502) throw e; fail(/not confirmed/i.test(e.message) ? 'Confirm your email first: open the link in the email from Supabase, then sign in.' : 'Incorrect email or password', 401); }
    if (!(await auth.isAdmin(cfg, s.access_token))) await refuseUntilApproved(s);
    cache = null; setSession(res, s); return send(res, 200, { user: { email: s.user.email } });
  }
  // Anyone can create an account; it sees nothing until an admin approves it on the Team access page.
  if (url.pathname === '/api/signup' && req.method === 'POST') {
    const raw = await body(req), name = clean(raw.name), email = clean(raw.email).toLowerCase(), password = String(raw.password ?? '');
    if (!name) fail('Enter your name');
    if (!validEmail(email)) fail('Enter a valid email');
    if (password.length < 8) fail('Use a password of at least 8 characters');
    let r; try { r = await auth.signUp(cfg, email, password, name); } catch (e) { if (e.status === 502) throw e; fail(/registered|exists/i.test(e.message) ? 'An account with this email already exists. Sign in instead.' : e.message); }
    if (!r?.access_token) return send(res, 200, { status: 'confirm_email' });
    try { await access.request(cfg, r.access_token, { id: r.user.id, email, name }); } catch {}
    await auth.signOut(cfg, r.access_token); return send(res, 200, { status: 'pending' });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const at = cookies(req).ss_at; if (at) await auth.signOut(cfg, at);
    cache = null; clearSession(res); return send(res, 200, { ok: true });
  }
  fail('API route not found', 404);
}
// API requests run one at a time so each sees a consistent db and duplicate checks cannot race.
let queue = Promise.resolve();
function exclusive(fn) { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; }

// One handler for both the local server and the Vercel function (api/index.mjs). On Vercel, vercel.json rewrites
// /api/<path> to /api?__path=<path>, and the static files in public/ are served by Vercel itself.
export async function handler(req, res) {
  try {
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim(), self = `${proto}://${req.headers.host}`;
    res.secure = proto === 'https'; res.gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const url = new URL(req.url, self), forwarded = url.searchParams.get('__path');
    if (url.pathname === '/api' && forwarded !== null) { url.pathname = `/api/${forwarded}`; url.searchParams.delete('__path'); }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
    if (missingSupabase) fail(missingSupabase, 503);
    // Writes must come from this site's own pages.
    if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== self) fail('Invalid origin', 403);
    if (['/api/session', '/api/login', '/api/signup', '/api/logout'].includes(url.pathname)) return await authRoute(req, res, url);
    await exclusive(async () => {
      if (cfg) {
        ctx = await session(req, res);
        const print = await fingerprint(cfg, ctx.token);
        if (!cache || cache.print !== print) cache = { db: await loadAll(cfg, ctx.token), print };
        db = cache.db;
      }
      await route(req, res, url);
    });
  } catch (e) { send(res, e.status || 500, { error: e.status ? e.message : 'Internal server error' }); if (!e.status) console.error(e); }
}
async function route(req, res, url) {
  if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, { ...db, metrics: metrics(db), stages: STAGES, segments: SEGMENTS, bases: BASIS, priorities: PRIORITIES, labels: LABELS, flow });
  if (url.pathname === '/api/playbook' && req.method === 'GET') return send(res, 200, playbook);
  if (url.pathname === '/api/team' && req.method === 'GET') { if (!cfg) fail('Team access needs Supabase', 404); return send(res, 200, { me: ctx.user.id, accounts: await access.accounts(cfg, ctx.token) }); }
  if (/^\/api\/team\/[^/]+$/.test(url.pathname) && req.method === 'POST') {
    if (!cfg) fail('Team access needs Supabase', 404);
    const target = url.pathname.split('/')[3], approve = (await body(req)).approve === true;
    await access.decide(cfg, ctx.token, target, approve); return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/orgs' && req.method === 'POST') { const org = createOrg(await body(req)); await save(); return send(res, 201, org); }
  if (/^\/api\/orgs\/[^/]+\/stage$/.test(url.pathname) && req.method === 'POST') {
    const org = orgOrFail(url.pathname.split('/')[3]), stage = stageFrom((await body(req)).stage);
    if (!STAGES.includes(stage)) fail('Invalid pipeline stage');
    if (stage === org.stage) fail(`Already ${label(stage)}`, 409);
    const task = advance(org, stage); await save(); return send(res, 200, { org, task });
  }
  if (url.pathname.startsWith('/api/orgs/') && req.method === 'PATCH') {
    const org = orgOrFail(url.pathname.split('/')[3]); const raw = await body(req);
    const next = validOrg({ ...org, ...raw }); const found = duplicate(next, org.id); if (found) fail(`Possible duplicate: ${found.name}`, 409);
    const oldStage = org.stage; Object.assign(org, next, { updatedAt: now() });
    if (oldStage !== org.stage) log(org.id, 'stage', `Moved from ${label(oldStage)} to ${label(org.stage)}`);
    else log(org.id, 'updated', 'Organization details updated');
    await save(); return send(res, 200, org);
  }
  if (url.pathname === '/api/contacts' && req.method === 'POST') {
    const raw = await body(req); const contact = cleanContact(raw, raw.orgId);
    if (db.contacts.some(c => contactKey(c) === contactKey(contact))) fail('Possible duplicate contact', 409);
    const item = { id: id(), ...contact, createdAt: now(), updatedAt: now() }; db.contacts.push(item); log(item.orgId, 'contact', `Added contact: ${item.name}`); await save(); return send(res, 201, item);
  }
  if (url.pathname.startsWith('/api/contacts/') && req.method === 'PATCH') {
    const contact = db.contacts.find(c => c.id === url.pathname.split('/')[3]); if (!contact) fail('Contact not found', 404);
    const raw = await body(req); const next = cleanContact({ ...contact, ...raw }, contact.orgId);
    if (db.contacts.some(c => c.id !== contact.id && contactKey(c) === contactKey(next))) fail('Possible duplicate contact', 409);
    Object.assign(contact, next, { updatedAt: now() }); log(contact.orgId, 'contact', `Updated contact: ${contact.name}`); await save(); return send(res, 200, contact);
  }
  if (url.pathname === '/api/activities' && req.method === 'POST') {
    const raw = await body(req); orgOrFail(raw.orgId);
    const type = clean(raw.type); if (!['note', 'outreach', 'reply', 'quote', 'order', 'call', 'meeting'].includes(type)) fail('Invalid activity type');
    const note = clean(raw.note); if (!note) fail('Activity note is required');
    const item = { id: id(), orgId: raw.orgId, type, note, date: now(), createdAt: now() }; db.activities.unshift(item); await save(); return send(res, 201, item);
  }
  if (url.pathname === '/api/tasks' && req.method === 'POST') {
    const raw = await body(req); orgOrFail(raw.orgId); const title = clean(raw.title), dueDate = isoDate(raw.dueDate);
    if (!title || !dueDate) fail('Task title and due date are required');
    const item = { id: id(), orgId: raw.orgId, title, dueDate, status: 'open', createdAt: now(), updatedAt: now() };
    db.tasks.push(item); log(item.orgId, 'task', `Follow-up scheduled for ${dueDate}: ${title}`); await save(); return send(res, 201, item);
  }
  if (url.pathname.startsWith('/api/tasks/') && req.method === 'PATCH') {
    const task = db.tasks.find(t => t.id === url.pathname.split('/')[3]); if (!task) fail('Task not found', 404);
    const raw = await body(req); if (!['open', 'done'].includes(raw.status)) fail('Invalid task status');
    task.status = raw.status; task.updatedAt = now(); log(task.orgId, 'task', `${task.status === 'done' ? 'Completed' : 'Reopened'} follow-up: ${task.title}`); await save(); return send(res, 200, task);
  }
  // The lead spreadsheets, uploaded from the app. Without write it only previews. Uses the signed-in session, like every other request.
  if (url.pathname === '/api/import-leads' && req.method === 'POST') {
    const raw = await body(req, 40_000_000);
    if (!Array.isArray(raw.files) || !raw.files.length) fail('Choose the lead files to import');
    let parsed; try { parsed = sourcesFromFiles(raw.files.map(f => ({ name: clean(f.name), data: Buffer.from(String(f.data || ''), 'base64') }))); } catch (e) { fail(`Could not read the files: ${e.message}`); }
    if (!parsed.used.length) fail('None of these files look like the SkateSkins lead files (prospect list, Outreach Plan workbook, or Klaviyo export)');
    if (cfg) await checkImportSchema(cfg, ctx.token).catch(e => fail(e.message, 409));
    const plan = planImport(db, parsed.sources), result = { used: parsed.used, summary: summarize(plan), orgs: plan.orgs.length, contacts: plan.contacts.length, updates: plan.updates.length, written: false };
    if (raw.write && (plan.orgs.length || plan.contacts.length || plan.updates.length)) {
      if (cfg) { cache = null; await insertNew(cfg, ctx.token, 'orgs', plan.orgs, ctx.user.id); await insertNew(cfg, ctx.token, 'contacts', plan.contacts, ctx.user.id); }
      else { db.orgs.push(...plan.orgs); db.contacts.push(...plan.contacts); }
      applyUpdates(db, plan.updates); await save();
      result.written = true;
    }
    return send(res, 200, result);
  }
  if (url.pathname === '/api/import' && req.method === 'POST') return send(res, 200, await importCsv(clean((await body(req)).csv)));
  if (url.pathname === '/api/suggestions' && req.method === 'POST') {
    const raw = await body(req); const values = validOrg({ ...raw, stage: 'not_contacted' }); const evidence = clean(raw.evidence);
    if (!evidence) fail('Evidence summary is required');
    const item = { id: id(), ...values, evidence, status: 'pending', createdAt: now(), reviewedAt: null };
    db.suggestions.unshift(item); await save(); return send(res, 201, item);
  }
  if (url.pathname.startsWith('/api/suggestions/') && req.method === 'PATCH') {
    const item = db.suggestions.find(s => s.id === url.pathname.split('/')[3]); if (!item) fail('Suggestion not found', 404);
    if (item.status !== 'pending') fail('Suggestion already reviewed', 409);
    const raw = await body(req); if (!['approve', 'reject'].includes(raw.action)) fail('Invalid review action');
    let org = null; if (raw.action === 'approve') org = createOrg({ ...item, ...raw.edits, stage: 'not_contacted' }, 'suggestion');
    item.status = raw.action === 'approve' ? 'approved' : 'rejected'; item.reviewedAt = now(); item.reviewNote = clean(raw.note); item.orgId = org?.id || null;
    await save(); return send(res, 200, item);
  }
  fail('API route not found', 404);
}
// Listen only when run directly (npm start); Vercel imports the handler instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) http.createServer(handler).listen(port, host, () => {
  console.log(`Outreach local admin: http://${host}:${port}`);
  console.log(cfg ? `Data is stored in Supabase (${new URL(cfg.url).host}); sign-in required. No outbound sending.` : 'Data stays in .local/; no Supabase connection or outbound sending.');
});
