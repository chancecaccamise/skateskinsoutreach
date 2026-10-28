// Dependency-free Supabase Auth + PostgREST client. Every data call carries the signed-in user's token, so RLS decides access.
import { clean } from './outreach.mjs';

export function supabaseConfig(env = process.env) {
  const url = clean(env.SUPABASE_URL).replace(/\/+$/, ''), key = clean(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY);
  if (!url && !key) return null;
  if (!url || !key) throw new Error('Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, or neither for local mode');
  return { url, key };
}

function fail(message, status) { const e = new Error(message); e.status = status; throw e; }
async function call(cfg, path, { method = 'GET', token, body, prefer } = {}) {
  let res;
  try { res = await fetch(`${cfg.url}${path}`, { method, headers: { apikey: cfg.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { fail('Could not reach Supabase', 502); }
  const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (res.ok) return data;
  const message = data?.msg || data?.message || data?.error_description || data?.error || `Supabase request failed (${res.status})`;
  if (data?.code === '23505') fail('Possible duplicate (already in Supabase)', 409);
  if (data?.code === '42501' || res.status === 403) fail('This account does not have outreach access', 403);
  fail(message, res.status < 500 && res.status !== 404 ? res.status : 502);
}

export const auth = {
  signIn: (cfg, email, password) => call(cfg, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }),
  refresh: (cfg, refreshToken) => call(cfg, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } }),
  signOut: (cfg, token) => call(cfg, '/auth/v1/logout', { method: 'POST', token }).catch(() => null),
  isAdmin: (cfg, token) => call(cfg, '/rest/v1/rpc/outreach_is_admin', { method: 'POST', token, body: {} })
};
// Decodes JWT claims for display and expiry checks only. Supabase verifies the signature on every call.
export function claims(token) { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return {}; } }

const text = v => v ?? '', stamp = v => v ? new Date(v).toISOString() : null;
const orgFields = { externalId: 'external_id', name: 'name', segment: 'segment', category: 'category', stage: 'stage', priority: 'priority', owner: 'owner', website: 'website', phone: 'phone', email: 'email', address: 'address', city: 'city', region: 'region', postalCode: 'postal_code', country: 'country', jurisdiction: 'jurisdiction', zone: 'zone', milesFromHub: 'miles_from_hub', leagueChain: 'league_chain', social: 'social', sourceUrl: 'source_url', researchDate: 'research_date', sourceDataset: 'source_dataset', contactBasis: 'contact_basis', optOut: 'opt_out', suppressed: 'suppressed', notes: 'notes', nextStep: 'next_step', lastContacted: 'last_contacted', inquiryId: 'team_inquiry_ref', designId: 'internal_design_ref', checkoutLinkId: 'checkout_link_ref', orderId: 'completed_order_ref', orderAmount: 'recorded_order_amount', orderCurrency: 'recorded_order_currency' };
// Blank values that must be stored as null: dates, numbers, checked enums, and unique keys.
const nullable = new Set(['externalId', 'priority', 'milesFromHub', 'lastContacted', 'orderAmount']), numeric = new Set(['milesFromHub', 'orderAmount']);
const suggestionColumns = { name: 'name', segment: 'segment', sourceUrl: 'source_url', researchDate: 'research_date', evidence: 'evidence', jurisdiction: 'jurisdiction' };
const suggestionKeys = ['id', 'status', 'createdAt', 'reviewedAt', 'reviewNote', 'orgId', ...Object.keys(suggestionColumns)];
const pick = (item, fields) => Object.fromEntries(Object.entries(fields).map(([k, col]) => [col, item[k] === '' && nullable.has(k) ? null : item[k] ?? null]));
const unpick = (row, fields) => Object.fromEntries(Object.entries(fields).map(([k, col]) => [k, typeof row[col] === 'boolean' ? row[col] : numeric.has(k) ? (row[col] == null ? null : Number(row[col])) : text(row[col])]));

// Collections are saved in this order so foreign keys exist before rows that reference them.
export const tables = {
  orgs: { table: 'outreach_organizations', order: 'created_at.desc',
    toRow: o => ({ id: o.id, ...pick(o, orgFields), created_at: o.createdAt, updated_at: o.updatedAt }),
    fromRow: r => ({ id: r.id, ...unpick(r, orgFields), createdAt: stamp(r.created_at), updatedAt: stamp(r.updated_at) }) },
  contacts: { table: 'outreach_contacts', order: 'created_at.asc',
    toRow: c => ({ id: c.id, external_id: c.externalId || null, organization_id: c.orgId, name: c.name, role: c.role, email: c.email || null, phone: c.phone, contact_basis: c.contactBasis, source_url: c.sourceUrl, opt_out: c.optOut, suppressed: c.suppressed, notes: c.notes, created_at: c.createdAt, updated_at: c.updatedAt }),
    fromRow: r => ({ id: r.id, externalId: text(r.external_id), orgId: r.organization_id, name: r.name, role: text(r.role), email: text(r.email), phone: text(r.phone), contactBasis: r.contact_basis, sourceUrl: text(r.source_url), optOut: r.opt_out, suppressed: r.suppressed, notes: text(r.notes), createdAt: stamp(r.created_at), updatedAt: stamp(r.updated_at) }) },
  tasks: { table: 'outreach_tasks', order: 'due_date.asc',
    toRow: t => ({ id: t.id, organization_id: t.orgId, title: t.title, due_date: t.dueDate, status: t.status, created_at: t.createdAt, updated_at: t.updatedAt }),
    fromRow: r => ({ id: r.id, orgId: r.organization_id, title: r.title, dueDate: r.due_date, status: r.status, createdAt: stamp(r.created_at), updatedAt: stamp(r.updated_at) }) },
  activities: { table: 'outreach_activities', order: 'occurred_at.desc',
    toRow: (a, userId) => ({ id: a.id, organization_id: a.orgId, actor_id: userId, kind: a.type, note: a.note, occurred_at: a.date, created_at: a.createdAt }),
    fromRow: r => ({ id: r.id, orgId: r.organization_id, type: r.kind, note: r.note, date: stamp(r.occurred_at), createdAt: stamp(r.created_at) }) },
  suggestions: { table: 'outreach_research_suggestions', order: 'created_at.desc',
    toRow: (s, userId) => ({ id: s.id, ...pick(s, suggestionColumns), payload: Object.fromEntries(Object.entries(s).filter(([k]) => !suggestionKeys.includes(k))), status: s.status, reviewed_by: s.status === 'pending' ? null : userId, reviewed_at: s.reviewedAt, review_note: s.reviewNote ?? null, organization_id: s.orgId ?? null, created_at: s.createdAt }),
    fromRow: r => ({ ...r.payload, id: r.id, ...unpick(r, suggestionColumns), status: r.status, createdAt: stamp(r.created_at), reviewedAt: stamp(r.reviewed_at), reviewNote: text(r.review_note), orgId: r.organization_id }) }
};

const snapshots = new WeakMap(), PAGE = 1000;
async function readAll(cfg, token, t) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await call(cfg, `/rest/v1/${t.table}?select=*&order=${t.order},id.asc&limit=${PAGE}&offset=${offset}`, { token });
    rows.push(...page); if (page.length < PAGE) return rows.map(t.fromRow);
  }
}
export async function loadAll(cfg, token) {
  const entries = await Promise.all(Object.entries(tables).map(async ([key, t]) => [key, await readAll(cfg, token, t)]));
  const db = { version: 1, ...Object.fromEntries(entries) };
  snapshots.set(db, Object.fromEntries(entries.map(([key, items]) => [key, new Map(items.map(i => [i.id, JSON.stringify(i)]))])));
  return db;
}
// Upserts only the rows a request added or changed since loadAll. The app never deletes rows.
export async function saveChanges(cfg, token, userId, db) {
  const before = snapshots.get(db);
  for (const [key, t] of Object.entries(tables)) {
    const changed = db[key].filter(item => before[key].get(item.id) !== JSON.stringify(item));
    if (!changed.length) continue;
    await call(cfg, `/rest/v1/${t.table}`, { method: 'POST', token, body: changed.map(item => t.toRow(item, userId)), prefer: 'resolution=merge-duplicates,return=minimal' });
    for (const item of changed) before[key].set(item.id, JSON.stringify(item));
  }
}
// Fails with a clear message when migration 002 (lead import fields) has not been run yet.
export async function checkImportSchema(cfg, token) {
  try { await call(cfg, '/rest/v1/outreach_organizations?select=external_id,zone,miles_from_hub&limit=1', { token }); await call(cfg, '/rest/v1/outreach_contacts?select=external_id&limit=1', { token }); }
  catch (e) { throw new Error(`The Supabase schema is missing the lead import fields. Run supabase/002_lead_import.sql in the SQL Editor first. (${e.message})`); }
}
// Bulk insert for the lead importer: rows whose id already exists are skipped, never overwritten.
export async function insertNew(cfg, token, key, items, userId, onBatch = () => {}) {
  for (let i = 0; i < items.length; i += 500) {
    await call(cfg, `/rest/v1/${tables[key].table}`, { method: 'POST', token, body: items.slice(i, i + 500).map(item => tables[key].toRow(item, userId)), prefer: 'resolution=ignore-duplicates,return=minimal' });
    onBatch(Math.min(i + 500, items.length));
  }
}
