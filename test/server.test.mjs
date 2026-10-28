import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

async function freePort() { return await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function waitFor(url) { for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.status) return; } catch {} await new Promise(r => setTimeout(r, 50)); } throw new Error('Server did not start'); }

test('import deduplication, suggestion review, and task history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'skateskins-outreach-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), OUTREACH_DATA_DIR: dir, SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_ANON_KEY: '' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(base);
    const request = async (path, method = 'GET', data) => {
      const res = await fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
      return { status: res.status, body: await res.json() };
    };
    const csv = 'name,segment,source_url,research_date,jurisdiction\nNorthside,team,https://directory.org/north,2026-10-20,US-NY\nSouthside,rink,https://directory.org/south,2026-10-20,US-NY\nNorthside,team,https://directory.org/north,2026-10-20,US-NY\n';
    const imported = await request('import', 'POST', { csv });
    assert.equal(imported.body.added, 2); assert.equal(imported.body.skipped.length, 1);
    const state = await request('state');
    assert.equal(state.body.orgs.length, 2); const orgId = state.body.orgs[0].id;
    const task = await request('tasks', 'POST', { orgId, title: 'Follow up', dueDate: '2026-10-19' });
    assert.equal(task.status, 201);
    await request(`tasks/${task.body.id}`, 'PATCH', { status: 'done' });
    const suggestion = await request('suggestions', 'POST', { name: 'Example Shop', segment: 'pro_shop', sourceUrl: 'https://shop.example.org/about', researchDate: '2026-10-20', evidence: 'Public shop page', jurisdiction: 'US-NY' });
    assert.equal(suggestion.status, 201);
    const reviewed = await request(`suggestions/${suggestion.body.id}`, 'PATCH', { action: 'approve' });
    assert.equal(reviewed.body.status, 'approved');
    const final = await request('state');
    assert.equal(final.body.orgs.length, 3);
    assert.equal(final.body.tasks[0].status, 'done');
    assert.ok(final.body.activities.some(a => a.type === 'task' && a.note.includes('Completed')));
  } finally { child.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('lead files uploaded in the app are previewed, then imported once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'skateskins-outreach-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), OUTREACH_DATA_DIR: dir, SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_ANON_KEY: '' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const request = async (path, method = 'GET', data) => { const res = await fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }); return { status: res.status, body: await res.json() }; };
  const csv = 'Lead ID,Priority,Segment,Organization,Location Name,Contact Name,Title,Email,Phone,Website,Address,City,State/Province,Country,League/Chain,Notes,Source URL,Status\nSS-0001,A,NHL Team,Buffalo Sabres,KeyBank Center,Dave Lee,Equipment Manager,dave@sabres.example,,https://sabres.example,,Buffalo,NY,USA,NHL,,https://src.example/sabres,\n';
  const files = [{ name: 'SkateSkins Prospect List - All Leads.csv', data: Buffer.from(csv).toString('base64') }];
  try {
    await waitFor(base);
    assert.equal((await request('import-leads', 'POST', { files: [{ name: 'notes.csv', data: '' }] })).status, 400);
    const preview = await request('import-leads', 'POST', { files });
    assert.equal(preview.body.written, false); assert.equal(preview.body.orgs, 1); assert.match(preview.body.summary.join(' '), /1 organizations and 1 contacts to add/);
    assert.equal((await request('state')).body.orgs.length, 0);
    const imported = await request('import-leads', 'POST', { files, write: true });
    assert.equal(imported.body.written, true);
    const state = (await request('state')).body;
    assert.equal(state.orgs[0].name, 'Buffalo Sabres'); assert.equal(state.contacts[0].email, 'dave@sabres.example');
    assert.equal((await request('import-leads', 'POST', { files, write: true })).body.orgs, 0);
  } finally { child.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('one-click outreach moves the stage, records the touch, and keeps one automatic follow-up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'skateskins-outreach-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), OUTREACH_DATA_DIR: dir, SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_ANON_KEY: '' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const request = async (path, method = 'GET', data) => { const res = await fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }); return { status: res.status, body: await res.json() }; };
  const today = new Date().toLocaleDateString('en-CA'), plus = days => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  try {
    await waitFor(base);
    const org = (await request('orgs', 'POST', { name: 'Amherst Knights', segment: 'team', sourceUrl: 'https://src.example/knights', researchDate: '2026-10-20' })).body;
    await request('tasks', 'POST', { orgId: org.id, title: 'Ask about spring tournament', dueDate: plus(10) });
    const contacted = await request(`orgs/${org.id}/stage`, 'POST', { stage: 'contacted' });
    assert.equal(contacted.body.org.stage, 'contacted'); assert.equal(contacted.body.org.lastContacted, today);
    assert.equal(contacted.body.task.dueDate, plus(3));
    assert.equal((await request(`orgs/${org.id}/stage`, 'POST', { stage: 'contacted' })).status, 409);
    assert.equal((await request(`orgs/${org.id}/stage`, 'POST', { stage: 'won-ish' })).status, 400);
    await request(`orgs/${org.id}/stage`, 'POST', { stage: 'follow_up_1' });
    await request(`orgs/${org.id}/stage`, 'POST', { stage: 'interested' });
    const bought = await request(`orgs/${org.id}/stage`, 'POST', { stage: 'purchased' });
    assert.equal(bought.body.task.title, 'Follow up after the purchase');
    const state = (await request('state')).body, open = state.tasks.filter(t => t.status === 'open').map(t => t.title).sort();
    assert.deepEqual(open, ['Ask about spring tournament', 'Follow up after the purchase'], 'manual tasks stay open; only the latest automatic follow-up is open');
    assert.equal(state.metrics.purchases, 1);
    assert.ok(state.activities.some(a => a.note.startsWith('Purchased. Moved from Interested to Purchased.')));
    assert.deepEqual(state.flow.team.interested.slice(0, 1), ['purchased']);
  } finally { child.kill(); rmSync(dir, { recursive: true, force: true }); }
});
