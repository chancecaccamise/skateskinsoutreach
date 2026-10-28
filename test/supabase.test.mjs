import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { tables } from '../lib/supabase.mjs';

async function freePort() { return await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function waitFor(url) { for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.status) return; } catch {} await new Promise(r => setTimeout(r, 50)); } throw new Error('Server did not start'); }
const jwt = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

// Minimal stand-in for Supabase Auth + PostgREST: one admin, one non-admin, rows kept in memory.
function fakeSupabase() {
  const users = { 'admin@example.com': { id: '00000000-0000-4000-8000-000000000001', admin: true }, 'guest@example.com': { id: '00000000-0000-4000-8000-000000000002', admin: false } };
  const rows = Object.fromEntries(Object.values(tables).map(t => [t.table, []]));
  const session = email => ({ access_token: jwt({ sub: users[email].id, email, exp: Math.floor(Date.now() / 1000) + 3600 }), refresh_token: `rt-${email}`, expires_in: 3600, user: { id: users[email].id, email } });
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : null, url = new URL(req.url, 'http://x'), reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data)); };
    if (req.headers.apikey !== 'test-key') return reply(401, { message: 'No API key' });
    const token = req.headers.authorization?.replace('Bearer ', ''), sub = token?.split('.')[1] && JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub, user = Object.values(users).find(u => u.id === sub);
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') return users[body.email] && body.password === 'pw' ? reply(200, session(body.email)) : reply(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    if (url.pathname === '/auth/v1/logout') return reply(204);
    if (!user) return reply(401, { message: 'JWT required' });
    if (url.pathname === '/rest/v1/rpc/outreach_is_admin') return reply(200, user.admin);
    const table = rows[url.pathname.replace('/rest/v1/', '')]; if (!table) return reply(404, { message: 'Unknown table' });
    if (!user.admin) return reply(req.method === 'GET' ? 200 : 403, req.method === 'GET' ? [] : { code: '42501', message: 'RLS' });
    if (req.method === 'GET') { const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit')); return reply(200, table.slice(offset, offset + limit)); }
    const ignore = /ignore-duplicates/.test(req.headers.prefer); assert.match(req.headers.prefer, /(merge|ignore)-duplicates/);
    for (const row of body) { const i = table.findIndex(r => r.id === row.id); if (i < 0) table.push(row); else if (!ignore) table[i] = { ...table[i], ...row }; }
    return reply(201);
  });
  return { server, rows };
}

test('row mapping round-trips every collection', () => {
  const now = new Date().toISOString(), orgId = crypto.randomUUID();
  const samples = {
    orgs: { id: orgId, externalId: 'NA-00001', name: 'Northside', segment: 'team', category: 'Junior Team', stage: 'interested', priority: 'A', owner: 'Sam', website: '', phone: '716-555-0100', email: 'office@x.org', address: '1 Main St', city: 'Albany', region: 'NY', postalCode: '12207', country: 'USA', jurisdiction: 'US-NY', zone: '2 · Drive radius (≤300 mi)', milesFromHub: 255.5, leagueChain: 'NAHL', social: '', sourceUrl: 'https://x.org', researchDate: '2026-10-20', sourceDataset: 'Prospect list', contactBasis: 'public_business', optOut: false, suppressed: true, notes: '', nextStep: 'Call Tuesday', lastContacted: '', inquiryId: '', designId: '', checkoutLinkId: '', orderId: 'A1', orderAmount: 1250.5, orderCurrency: 'USD', createdAt: now, updatedAt: now },
    contacts: { id: crypto.randomUUID(), externalId: 'SS-0001', orgId, name: 'Pat', role: 'Coach', email: '', phone: '', contactBasis: 'unknown', sourceUrl: '', optOut: false, suppressed: false, notes: '', createdAt: now, updatedAt: now },
    tasks: { id: crypto.randomUUID(), orgId, title: 'Call', dueDate: '2026-10-28', status: 'open', createdAt: now, updatedAt: now },
    activities: { id: crypto.randomUUID(), orgId, type: 'reply', note: 'Interested', date: now, createdAt: now },
    suggestions: { id: crypto.randomUUID(), name: 'Shop', segment: 'pro_shop', stage: 'not_contacted', owner: '', website: 'https://shop.example.org', sourceUrl: 'https://shop.example.org/about', researchDate: '2026-10-20', jurisdiction: 'US-NY', evidence: 'Public page', status: 'approved', createdAt: now, reviewedAt: now, reviewNote: 'ok', orgId }
  };
  for (const [key, item] of Object.entries(samples)) {
    const back = tables[key].fromRow(JSON.parse(JSON.stringify(tables[key].toRow(item, 'user-id'))));
    for (const [field, value] of Object.entries(item)) assert.deepEqual(back[field], value, `${key}.${field}`);
  }
});

test('Supabase mode requires an admin sign-in and persists changes through the REST API', async () => {
  const fake = fakeSupabase(); await new Promise(r => fake.server.listen(0, '127.0.0.1', r));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), SUPABASE_URL: `http://127.0.0.1:${fake.server.address().port}`, SUPABASE_PUBLISHABLE_KEY: 'test-key', SUPABASE_ANON_KEY: '' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`; let cookie = '';
  const request = async (path, method = 'GET', data) => {
    const res = await fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: data === undefined ? undefined : JSON.stringify(data) });
    const set = res.headers.getSetCookie().map(c => c.split(';')[0]); if (set.length) cookie = set.join('; ');
    return { status: res.status, body: await res.json() };
  };
  try {
    await waitFor(base);
    assert.deepEqual((await request('session')).body, { mode: 'supabase', user: null });
    assert.equal((await request('state')).status, 401);
    assert.equal((await request('login', 'POST', { email: 'admin@example.com', password: 'wrong' })).status, 401);
    assert.equal((await request('login', 'POST', { email: 'guest@example.com', password: 'pw' })).status, 403);
    assert.equal((await request('login', 'POST', { email: 'admin@example.com', password: 'pw' })).status, 200);
    assert.equal((await request('session')).body.user.email, 'admin@example.com');

    const org = await request('orgs', 'POST', { name: 'Northside', segment: 'team', sourceUrl: 'https://directory.org/north', researchDate: '2026-10-20', orderId: 'A1', orderAmount: '99.5' });
    assert.equal(org.status, 201);
    await request(`orgs/${org.body.id}`, 'PATCH', { stage: 'interested' });
    await request('tasks', 'POST', { orgId: org.body.id, title: 'Follow up', dueDate: '2026-10-19' });
    assert.equal((await request('orgs', 'POST', { name: 'Northside', segment: 'team', sourceUrl: 'https://directory.org/north', researchDate: '2026-10-20' })).status, 409);

    const orgRows = fake.rows.outreach_organizations;
    assert.equal(orgRows.length, 1); assert.equal(orgRows[0].stage, 'interested'); assert.equal(orgRows[0].priority, null); assert.equal(orgRows[0].last_contacted, null); assert.equal(orgRows[0].recorded_order_amount, 99.5);
    assert.equal(fake.rows.outreach_activities.length, 3);
    assert.ok(fake.rows.outreach_activities.every(a => a.actor_id === '00000000-0000-4000-8000-000000000001'));

    const state = await request('state');
    assert.equal(state.body.orgs[0].stage, 'interested'); assert.equal(state.body.metrics.replies, 1); assert.equal(state.body.metrics.overdue, 1);

    assert.equal((await request('logout', 'POST', {})).status, 200);
    assert.equal((await request('state')).status, 401);
  } finally { child.kill(); fake.server.close(); }
});

test('the import command signs in, inserts new rows in batches, and skips them on a second run', async () => {
  const fake = fakeSupabase(); await new Promise(r => fake.server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'skateskins-import-'));
  writeFileSync(join(dir, 'SkateSkins Prospect List - All Leads.csv'), 'Lead ID,Priority,Segment,Organization,Location Name,Contact Name,Title,Email,Phone,Website,Address,City,State/Province,Country,League/Chain,Notes,Source URL,Status\nSS-0001,A,NHL Team,Buffalo Sabres,KeyBank Center,Dave Lee,Equipment Manager,dave@sabres.example,,https://sabres.example,,Buffalo,NY,USA,NHL,,https://src.example/sabres,\n');
  const run = (...flags) => new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/import-leads.mjs', dir, ...flags], { cwd: new URL('..', import.meta.url), env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${fake.server.address().port}`, SUPABASE_PUBLISHABLE_KEY: 'test-key', SUPABASE_ANON_KEY: '', OUTREACH_EMAIL: 'admin@example.com', OUTREACH_PASSWORD: 'pw' } });
    let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d); child.on('close', code => resolve({ code, out }));
  });
  try {
    const dry = await run();
    assert.equal(dry.code, 0, dry.out); assert.match(dry.out, /1 organizations and 1 contacts to add/); assert.equal(fake.rows.outreach_organizations.length, 0);
    const wrote = await run('--write');
    assert.equal(wrote.code, 0, wrote.out);
    assert.equal(fake.rows.outreach_organizations[0].external_id, 'SS-0001'); assert.equal(fake.rows.outreach_organizations[0].stage, 'not_contacted');
    assert.equal(fake.rows.outreach_contacts[0].email, 'dave@sabres.example');
    const again = await run('--write');
    assert.match(again.out, /Nothing new to import/); assert.equal(fake.rows.outreach_organizations.length, 1);
  } finally { fake.server.close(); rmSync(dir, { recursive: true, force: true }); }
});
