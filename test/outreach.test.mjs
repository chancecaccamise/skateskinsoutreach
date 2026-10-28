import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, validateOrg, orgKey, metrics, isoDate, stageFrom, nextStages } from '../lib/outreach.mjs';

const base = { name: 'Northside Hockey', segment: 'team', sourceUrl: 'https://example.org/teams/northside', researchDate: '2026-10-20' };

test('CSV parses quoted commas and reports required headers', () => {
  const rows = parseCsv('name,segment,source_url,research_date,notes\n"Northside, Jr.",team,https://example.org,2026-10-20,"Asked about ""team"" orders"\n');
  assert.equal(rows[0].name, 'Northside, Jr.');
  assert.equal(rows[0].notes, 'Asked about "team" orders');
  assert.throws(() => parseCsv('name,segment\nA,team'), /source_url/);
});

test('organizations need actual research provenance and valid dates', () => {
  assert.equal(validateOrg(base).stage, 'not_contacted');
  assert.throws(() => validateOrg({ ...base, sourceUrl: '' }), /source URL/);
  assert.equal(isoDate('2026-02-30'), '');
  assert.throws(() => validateOrg({ ...base, researchDate: '2026-02-30' }), /Research date/);
});

test('dedup key is name plus place, so chain locations sharing a website stay separate', () => {
  const store = { name: 'Pure Hockey', website: 'https://purehockey.com', city: 'Buffalo', region: 'NY' };
  assert.notEqual(orgKey(store), orgKey({ ...store, city: 'Rochester' }));
  assert.equal(orgKey(store), orgKey({ ...store, name: 'PURE  hockey', city: 'buffalo', website: 'https://other.example' }));
  assert.equal(orgKey({ name: 'Figure 8 & Hockey One' }), orgKey({ name: 'Figure 8 / Hockey One' }));
  assert.equal(orgKey({ name: 'Northside', jurisdiction: 'US-NY' }), orgKey({ name: 'Northside', jurisdiction: 'us-ny' }));
});

test('stages accept workbook labels and the earlier CRM stages', () => {
  assert.equal(stageFrom('Live – producing'), 'live');
  assert.equal(stageFrom('Visit / call booked'), 'visit_booked');
  assert.equal(stageFrom('Follow-up 2'), 'follow_up_2');
  assert.equal(validateOrg({ ...base, stage: 'quoted' }).stage, 'interested');
  assert.throws(() => validateOrg({ ...base, stage: 'c' }), /stage/);
  assert.equal(validateOrg({ ...base, website: 'www.example.org' }).website, 'https://www.example.org');
  assert.throws(() => validateOrg({ ...base, priority: 'Z' }), /Priority/);
});

test('dashboard counts overdue tasks and USD order references only', () => {
  const db = { orgs: [{ id: 'a', stage: 'not_contacted' }, { id: 'b', stage: 'follow_up_1' }, { stage: 'interested', orderId: 'O1', orderAmount: 125, orderCurrency: 'USD' }, { stage: 'live', orderId: 'O2', orderAmount: 100, orderCurrency: 'CAD' }], activities: [{ orgId: 'b', type: 'reply' }], tasks: [{ status: 'open', dueDate: '2026-10-19' }, { status: 'open', dueDate: '2026-10-20' }, { status: 'done', dueDate: '2026-10-18' }], suggestions: [{ status: 'pending' }] };
  assert.deepEqual(metrics(db, '2026-10-20'), { organizations: 4, contacted: 3, replies: 3, overdue: 1, dueToday: 1, partners: 1, purchases: 0, live: 1, orders: 2, attributedRevenue: 125, pendingSuggestions: 1 });
});

test('the next-step buttons follow the deal steps, with purchases for teams and displays for shops', () => {
  assert.deepEqual(nextStages({ segment: 'rink', stage: 'not_contacted' }).slice(0, 1), ['contacted']);
  assert.deepEqual(nextStages({ segment: 'team', stage: 'contacted' }).slice(0, 2), ['follow_up_1', 'interested']);
  assert.equal(nextStages({ segment: 'team', stage: 'interested' })[0], 'purchased');
  assert.equal(nextStages({ segment: 'pro_shop', stage: 'interested' })[0], 'agreement_signed');
  assert.ok(nextStages({ segment: 'pro_shop', stage: 'interested' }).includes('purchased'));
  assert.deepEqual(nextStages({ segment: 'team', stage: 'purchased' }), ['purchase_follow_up']);
});
