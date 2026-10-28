import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readXlsx } from '../lib/xlsx.mjs';
import { applyUpdates, planImport, records } from '../lib/lead-import.mjs';
import { orgKey } from '../lib/outreach.mjs';

// Builds a minimal zip (CRCs are not checked by the reader). Entries are deflated except the workbook, to cover both methods.
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text), stored = name === 'xl/workbook.xml', data = stored ? raw : deflateRawSync(raw), n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(stored ? 0 : 8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(stored ? 0 : 8, 10); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42);
    locals.push(local, n, data); central.push(dir, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('xlsx reader handles shared, rich, inline and numeric cells with gaps', () => {
  const book = zip({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Venues – North America" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>ID</t></si><si><r><t>Na</t></r><r><t xml:space="preserve">me</t></r></si><si><t>Rink &amp; Arena_x000D_</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Miles</t></is></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="D2"><v>14</v></c><c r="E2"/></row><row r="3"></row></sheetData></worksheet>'
  });
  assert.deepEqual([...readXlsx(book)], [['Venues – North America', [['ID', 'Name', '', 'Miles'], ['Rink & Arena\r', '', '', '14', '']]]]);
});

const prospectRows = [
  ['Lead ID', 'Priority', 'Segment', 'Organization', 'Location Name', 'Contact Name', 'Title', 'Email', 'Phone', 'Website', 'Address', 'City', 'State/Province', 'Country', 'League/Chain', 'Notes', 'Source URL', 'Status'],
  ['SS-0002', 'B', 'AHL Team', 'Rochester Americans', 'Blue Cross Arena', 'Pat Lee', 'Equipment Manager', 'pat@amerks.example', '', 'www.amerks.example', '', 'Rochester', 'NY', 'USA', 'AHL', '', 'https://src.example/amerks', ''],
  ['SS-0001', 'A', 'AHL Team', 'Rochester Americans', 'Blue Cross Arena', 'Sam Roe', 'Assistant Equipment Manager', '', '585-555-0100', '', '', 'Rochester', 'NY', 'USA', 'AHL', 'Team store on site', 'https://src.example/amerks', ''],
  ['SS-0003', 'B', 'Chain Store Location', 'Pure Hockey', 'Pure Hockey - Amherst', '', 'Store', 'shop@pure.example', '', 'https://pure.example', '', 'Amherst', 'NY', 'USA', 'Pure Hockey', '', 'https://src.example/pure', ''],
  ['SS-0004', 'B', 'Chain Store Location', 'Pure Hockey', 'Pure Hockey - Albany', '', 'Store', 'shop@pure.example', '', 'https://pure.example', '', 'Albany', 'NY', 'USA', 'Pure Hockey', '', 'https://src.example/pure', ''],
  ['SS-0005', 'C', 'Buying Group', 'Sports Excellence', 'National office', '', '', '', '', 'not a url', '', '', '', 'Canada', '', '', 'https://src.example/sec', ''],
  ['SS-0006', 'B', 'Junior Team', 'No Source Juniors', '', '', '', '', '', '', '', 'Erie', 'PA', 'USA', '', '', 'n/a', '']
];
const venueRows = [
  ['ID', 'Tier', 'Zone', 'Type', 'Name', 'City', 'State/Prov', 'Country', 'Miles from Buffalo', 'Street', 'Postcode', 'Phone (map)', 'Website (map)', 'Email (map)', 'Facebook / Instagram', 'Operator / brand', 'In existing list?', 'Status', 'Owner', 'Contact name', 'Contact title', 'Contact email', 'Contact phone', 'Last contacted', 'Next step'],
  ['NA-00001', 'A', '1 · Home', 'Hockey shop', 'Pure Hockey - Amherst', 'Town of Amherst', 'NY', 'USA', '8', '1 Main St', '14221', '716-555-0199', '', '', '', '', 'Yes', 'Not contacted', '', '', '', '', '', '', ''],
  ['NA-00002', 'B', '2 · Drive radius', 'Arena / stadium', 'Blue Cross Arena', 'Rochester', 'NY', 'USA', '70', '1 War Memorial Sq', '', '', '', '', '', '', 'Yes', 'Not contacted', '', '', '', '', '', '', ''],
  ['NA-00003', 'A', '1 · Home', 'Indoor rink / arena', 'Twin Rinks', 'Buffalo', 'NY', 'USA', '5', '10 North Rd', '', '', '', '', '', '', '', 'Contacted', 'Jo', 'Kim Ng', 'Manager', 'kim@rinks.example', '', '2026-10-20', 'Visit Friday'],
  ['NA-00004', 'A', '1 · Home', 'Indoor rink / arena', 'Twin Rinks', 'Buffalo', 'NY', 'USA', '6', '99 South Rd', '', '', '', '', '', '', '', 'Not contacted', '', '', '', '', '', '', '']
];
const klaviyoRows = [
  ['email', 'first_name', 'last_name', 'organization', 'title', 'phone', 'city', 'region', 'shopify_tags', 'klaviyo_profile_id'],
  ['coach@club.example', 'Ann', 'Diaz', 'Hamburg Hawks 12U', '', '+17165550000', 'Hamburg', 'New York', '', 'P1'],
  ['parent@club.example', 'Bo', '', 'Hamburg Hawks 12U', '', '', '', '', 'newsletter', 'P2']
];
const sources = () => ({ prospects: records(prospectRows), venues: records(venueRows), klaviyo: records(klaviyoRows) });
const emptyDb = () => ({ orgs: [], contacts: [], activities: [], tasks: [], suggestions: [] });

test('import groups contacts, keeps chain locations apart, and merges or cross-references venues', () => {
  const { orgs, contacts, report } = planImport(emptyDb(), sources(), '2026-10-27T00:00:00.000Z');
  const byName = name => orgs.find(o => o.name === name), people = org => contacts.filter(c => c.orgId === org.id);

  const amerks = byName('Rochester Americans');
  assert.equal(amerks.externalId, 'SS-0001'); assert.equal(amerks.priority, 'A'); assert.equal(amerks.website, 'https://www.amerks.example');
  assert.equal(amerks.segment, 'team'); assert.equal(amerks.jurisdiction, 'US-NY'); assert.equal(people(amerks).length, 2);

  const amherst = byName('Pure Hockey - Amherst'), albany = byName('Pure Hockey - Albany');
  assert.ok(amherst && albany && amherst.id !== albany.id, 'chain locations sharing a website stay separate');
  assert.equal(amherst.zone, '1 · Home'); assert.equal(amherst.milesFromHub, 8); assert.equal(amherst.phone, '716-555-0199'); assert.match(amherst.notes, /NA-00001/);
  assert.equal(people(albany)[0].email, '', 'shared email is kept once'); assert.match(people(albany)[0].notes, /Same email as Store at Pure Hockey - Amherst/);

  const arena = byName('Blue Cross Arena');
  assert.equal(arena.segment, 'rink'); assert.match(arena.notes, /based here: Rochester Americans \(AHL Team\)/);

  const rinks = orgs.filter(o => o.name.startsWith('Twin Rinks'));
  assert.deepEqual(rinks.map(o => o.name).sort(), ['Twin Rinks', 'Twin Rinks (99 South Rd)']);
  const worked = rinks.find(o => o.externalId === 'NA-00003');
  assert.equal(worked.stage, 'contacted'); assert.equal(worked.owner, 'Jo'); assert.equal(worked.lastContacted, '2026-10-20'); assert.equal(worked.nextStep, 'Visit Friday');
  assert.equal(people(worked)[0].name, 'Kim Ng');

  const sec = byName('Sports Excellence');
  assert.equal(sec.segment, 'wholesale'); assert.equal(sec.website, ''); assert.match(sec.notes, /Website \(unreadable\): not a url/);

  const club = byName('Hamburg Hawks 12U');
  assert.equal(club.contactBasis, 'existing_customer'); assert.equal(people(club).length, 2);
  assert.ok(people(club).every(c => c.contactBasis === 'existing_customer')); assert.match(people(club)[0].notes, /Hamburg, New York/);

  assert.deepEqual(report.errors.map(e => e.id), ['SS-0006']);
  assert.equal(report.venues.merged, 1); assert.equal(report.venues.renamed, 1); assert.equal(report.sharedEmails, 1);
});

test('re-running an import adds nothing and leaves edits alone; existing records are matched, not duplicated', () => {
  const first = planImport(emptyDb(), sources());
  const db = { ...emptyDb(), orgs: first.orgs.map(o => ({ ...o })), contacts: first.contacts };
  db.orgs.find(o => o.name === 'Rochester Americans').stage = 'interested';
  const again = planImport(db, sources());
  assert.equal(again.orgs.length, 0); assert.equal(again.contacts.length, 0);
  assert.equal(again.report.prospects.alreadyImported, first.report.prospects.orgs);

  const manual = { id: 'manual-1', name: 'Rochester Americans', city: 'Rochester', region: 'NY', stage: 'contacted' };
  const merged = planImport({ ...emptyDb(), orgs: [manual] }, { prospects: records(prospectRows) });
  assert.equal(merged.orgs.some(o => o.name === 'Rochester Americans'), false);
  assert.equal(merged.contacts.filter(c => c.orgId === 'manual-1').length, 2);
  assert.equal(merged.report.prospects.matchedExisting, 1);
});

test('uploading the files one at a time gives the same records as uploading them together', () => {
  const strip = ({ createdAt, updatedAt, ...o }) => o, now = '2026-10-28T00:00:00.000Z';
  const apply = (db, sources) => { const p = planImport(db, sources, now); db.orgs.push(...p.orgs); db.contacts.push(...p.contacts); applyUpdates(db, p.updates, now); return p; };
  const together = emptyDb(); apply(together, sources());
  const separate = emptyDb(); for (const key of ['prospects', 'venues', 'klaviyo']) apply(separate, { [key]: sources()[key] });
  assert.deepEqual(separate.orgs.map(strip).sort((a, b) => a.id.localeCompare(b.id)), together.orgs.map(strip).sort((a, b) => a.id.localeCompare(b.id)));
  const amherst = separate.orgs.find(o => o.name === 'Pure Hockey - Amherst');
  assert.equal(amherst.zone, '1 · Home'); assert.equal(amherst.priority, 'A');
  const again = planImport(separate, sources());
  assert.equal(again.orgs.length + again.contacts.length + again.updates.length, 0);
});

test('names in other alphabets are compared by their letters, not dropped', () => {
  assert.notEqual(orgKey({ name: 'Лядовы палац', city: 'Гродна', region: '' }), orgKey({ name: 'MySPORT', city: 'Рэчыца', region: '' }));
  assert.notEqual(orgKey({ name: 'Лядовы палац', city: 'Гродна' }), orgKey({ name: 'Лядовы палац', city: 'Быхаў' }));
  assert.equal(orgKey({ name: 'Zürich Eishalle' }), orgKey({ name: 'zurich  eishalle' }));
});
