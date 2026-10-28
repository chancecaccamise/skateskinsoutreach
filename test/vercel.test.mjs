import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs the Vercel entry point in-process the way Vercel calls it: behind the /api rewrite, over HTTPS, with gzip.
test('the Vercel function serves the API through the rewrite, checks the origin, and gzips responses', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'skateskins-vercel-'));
  Object.assign(process.env, { SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_ANON_KEY: '', OUTREACH_DATA_DIR: dir });
  const { default: handler } = await import('../api/index.mjs');
  const server = http.createServer((req, res) => { req.headers['x-forwarded-proto'] = 'https'; handler(req, res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const host = `127.0.0.1:${server.address().port}`, base = `http://${host}`;
  try {
    const session = await fetch(`${base}/api?__path=session`);
    assert.deepEqual(await session.json(), { mode: 'local', user: null });
    const org = { name: 'Rochester Americans', segment: 'team', sourceUrl: 'https://src.example/amerks', researchDate: '2026-10-20' };
    const post = origin => fetch(`${base}/api?__path=orgs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(org) });
    assert.equal((await post('https://evil.example')).status, 403);
    assert.equal((await post(`https://${host}`)).status, 201);
    const state = await fetch(`${base}/api?__path=state`);
    assert.equal(state.headers.get('content-encoding'), 'gzip');
    assert.equal((await state.json()).orgs[0].name, 'Rochester Americans');
    assert.equal((await fetch(`${base}/api?__path=orgs/${'x'}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"stage":"contacted"}' })).status, 404);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});
