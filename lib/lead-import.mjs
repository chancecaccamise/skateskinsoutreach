// Turns the SkateSkins lead spreadsheets into organizations and contacts. Pure functions: no file or network access.
// Ids are derived from each row's source id, so re-running an import skips what is already there and never overwrites edits.
import { createHash } from 'node:crypto';
import { PRIORITIES, clean, isoDate, loose, orgKey, parseCsvRows, stageFrom, validEmail, validUrl, validateContact, validateOrg, withScheme } from './outreach.mjs';
import { readXlsx } from './xlsx.mjs';

export const SOURCES = {
  prospects: { label: 'Prospect list', dataset: 'Prospect list (built 2026-10-02)', researchDate: '2026-10-02' },
  venues: { label: 'Venues', dataset: 'OpenStreetMap venues (built 2026-10-12)', researchDate: '2026-10-12' },
  klaviyo: { label: 'Klaviyo WNY teams', dataset: 'Klaviyo WNY teams export (2026-10-09)', researchDate: '2026-10-09' }
};
const TEAMS = ['NHL Team', 'AHL Team', 'Minor Pro Team', 'Junior Team', 'NCAA D1', 'NCAA D3', 'ACHA Club', 'U SPORTS'];
const SHOPS = ['Rink Pro Shop', 'Independent Hockey Shop', 'Chain Store Location', 'Hockey shop', 'Sports store (check hockey)'];
export function segmentFor(category) { return TEAMS.includes(category) ? 'team' : SHOPS.includes(category) ? 'pro_shop' : /rink|arena|centre|center|stadium/i.test(category) ? 'rink' : 'wholesale'; }

export function stableId(key) {
  const h = createHash('sha1').update(`skateskins-outreach:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
// Sheet or CSV rows (first row = headers) → objects keyed by snake_case header: 'State/Province' → state_province.
export function records(rows) {
  const [headers = [], ...body] = rows, keys = headers.map(h => clean(h).replace(/^﻿/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return body.map(values => Object.fromEntries(keys.map((k, i) => [k, clean(values[i])])));
}
function jurisdiction(country, region) { const code = { USA: 'US', 'United States': 'US', Canada: 'CA' }[country]; return code && /^[A-Z]{2}$/.test(region) ? `${code}-${region}` : country; }
// Joins note lines, dropping repeats, so adding the same note twice changes nothing.
const join = (...parts) => [...new Set(parts.flat().filter(Boolean).flatMap(p => clean(p).split('\n')).map(clean).filter(Boolean))].join('\n');
const best = (...letters) => letters.filter(l => PRIORITIES.includes(l)).sort()[0] || '';
const looseCity = city => loose(clean(city).replace(/^(town|city|village|township|municipality) of /i, ''));
// A website or email that fails validation is kept in the notes rather than dropped.
function checked(draft, field, valid, note) { if (draft[field] && !valid(draft[field])) { draft.notes = join(draft.notes, `${note}: ${draft[field]}`); draft[field] = ''; } }
function base(source) { return { sourceDataset: SOURCES[source].dataset, researchDate: SOURCES[source].researchDate, contactBasis: 'public_business', stage: 'not_contacted' }; }

export function prospectDrafts(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.organization) continue;
    const name = r.segment === 'Chain Store Location' && r.location_name ? r.location_name : r.organization;
    const key = orgKey({ name, city: r.city, region: r.state_province });
    if (!groups.has(key)) groups.set(key, { name, rows: [] });
    groups.get(key).rows.push(r);
  }
  return [...groups.values()].map(({ name, rows: g }) => {
    const first = field => g.find(r => r[field])?.[field] || '', r0 = g[0];
    const locations = [...new Set(g.map(r => r.location_name).filter(l => l && l !== name))];
    const address = first('address'), place = locations.find(l => !address.includes(l));
    const draft = {
      ...base('prospects'), externalId: g.map(r => r.lead_id).sort()[0], name, organization: r0.organization, venueNames: g.map(r => r.location_name).filter(Boolean), segment: segmentFor(r0.segment), category: r0.segment,
      priority: best(...g.map(r => r.priority)), website: withScheme(first('website')), address: place ? join(place, address).replace('\n', ', ') : address,
      city: r0.city, region: r0.state_province, country: r0.country, jurisdiction: jurisdiction(r0.country, r0.state_province), leagueChain: first('league_chain'),
      sourceUrl: g.find(r => validUrl(r.source_url))?.source_url || '', stage: stageFrom(first('status')) || 'not_contacted', owner: first('owner'),
      nextStep: first('next_step'), lastContacted: isoDate(first('last_contacted')),
      notes: join(g.map(r => r.notes), first('also_listed_in') && `Also listed in: ${first('also_listed_in')}`, locations.length > 1 && `Locations: ${locations.join('; ')}`)
    };
    checked(draft, 'website', validUrl, 'Website (unreadable)');
    draft.contacts = g.filter(r => r.contact_name || r.email || r.phone).map(r => ({
      externalId: r.lead_id, name: r.contact_name || r.title || 'General contact', role: r.contact_name ? r.title : '', email: r.email.toLowerCase(), phone: r.phone,
      contactBasis: 'public_business', sourceUrl: validUrl(r.source_url) ? r.source_url : ''
    }));
    return draft;
  });
}

export function venueDrafts(rows) {
  return rows.filter(r => r.id && r.name).map(r => {
    const draft = {
      ...base('venues'), externalId: r.id, name: r.name, segment: segmentFor(r.type), category: r.type, priority: r.tier, zone: r.zone,
      milesFromHub: r.miles_from_buffalo === '' ? null : Number(r.miles_from_buffalo), address: r.street, postalCode: r.postcode, city: r.city, region: r.state_prov,
      country: r.country, jurisdiction: jurisdiction(r.country, r.state_prov), phone: r.phone_map, website: withScheme(r.website_map), email: r.email_map.toLowerCase(),
      social: r.facebook_instagram, leagueChain: r.operator_brand, stage: stageFrom(r.status) || 'not_contacted', owner: r.owner, nextStep: r.next_step,
      lastContacted: isoDate(r.last_contacted), inExistingList: /^yes$/i.test(r.in_existing_list),
      sourceUrl: `https://www.openstreetmap.org/search?query=${encodeURIComponent([r.name, r.city, r.state_prov, r.country].filter(Boolean).join(', '))}`
    };
    checked(draft, 'website', validUrl, 'Website on map (unreadable)'); checked(draft, 'email', validEmail, 'Email on map (unreadable)');
    draft.contacts = r.contact_name || r.contact_email || r.contact_phone ? [{ externalId: `${r.id}:contact`, name: r.contact_name || r.contact_title || 'General contact', role: r.contact_name ? r.contact_title : '', email: r.contact_email.toLowerCase(), phone: r.contact_phone, contactBasis: 'public_business', sourceUrl: '' }] : [];
    return draft;
  });
}

export function klaviyoDrafts(rows) {
  const groups = new Map();
  for (const r of rows) { const key = loose(r.organization); if (!key || !r.klaviyo_profile_id) continue; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  const profile = r => `https://www.klaviyo.com/profile/${encodeURIComponent(r.klaviyo_profile_id)}`;
  return [...groups.entries()].map(([key, g]) => ({
    ...base('klaviyo'), externalId: `klaviyo:${key}`, name: g[0].organization, segment: 'team', category: 'Existing customer (Klaviyo)', contactBasis: 'existing_customer',
    sourceUrl: profile(g[0]), notes: 'Existing SkateSkins customer or subscriber from the Klaviyo WNY teams export. Not a cold prospect.',
    contacts: g.map(r => ({
      externalId: `klaviyo:${r.klaviyo_profile_id}`, name: join(r.first_name, r.last_name).replace('\n', ' ') || r.email || 'Customer', role: r.title, email: r.email.toLowerCase(), phone: r.phone,
      contactBasis: 'existing_customer', sourceUrl: profile(r), notes: join([r.city, r.region].filter(Boolean).join(', ') && `Klaviyo profile location: ${[r.city, r.region].filter(Boolean).join(', ')}`, r.shopify_tags && `Shopify tags: ${r.shopify_tags}`)
    }))
  }));
}

// Recognizes the lead files by name. files: [{ name, data: Buffer }]. The prospect list exists in three identical copies
// (All Leads CSV, Prospect List workbook, Existing Leads tab); only the first one found is used.
export function sourcesFromFiles(files) {
  const find = pattern => files.find(f => !f.name.startsWith('~$') && pattern.test(f.name));
  const csv = f => parseCsvRows(f.data.toString('utf8')), workbook = f => readXlsx(f.data);
  const plan = find(/outreach plan.*\.xlsx$/i), prospectCsv = find(/all leads.*\.csv$/i), prospectXlsx = find(/prospect list.*\.xlsx$/i), klaviyoCsv = find(/klaviyo.*\.csv$/i);
  const sources = { prospects: [], venues: [], klaviyo: [] }, used = [];
  if (prospectCsv) { sources.prospects = records(csv(prospectCsv)); used.push(`Prospects: ${prospectCsv.name}`); }
  else if (prospectXlsx) { sources.prospects = records(workbook(prospectXlsx).get('All Leads') || []); used.push(`Prospects: ${prospectXlsx.name} (All Leads tab)`); }
  if (plan) {
    const sheets = workbook(plan);
    for (const [name, rows] of sheets) if (/^venues/i.test(name)) { sources.venues.push(...records(rows)); used.push(`Venues: ${plan.name} (${name} tab)`); }
    if (!sources.prospects.length && sheets.get('Existing Leads')) { sources.prospects = records(sheets.get('Existing Leads')); used.push(`Prospects: ${plan.name} (Existing Leads tab)`); }
  }
  if (klaviyoCsv) { sources.klaviyo = records(csv(klaviyoCsv)); used.push(`Customers: ${klaviyoCsv.name}`); }
  return { sources, used };
}
// Plain-language summary of an import plan, shared by the import command and the in-app import.
export function summarize({ orgs, contacts, report }) {
  const lines = [];
  for (const s of [report.prospects, report.venues, report.klaviyo]) if (s.rows)
    lines.push(`${s.source}: ${s.rows.toLocaleString()} rows → ${s.orgs.toLocaleString()} new organizations, ${s.contacts.toLocaleString()} new contacts`, ...[s.merged && `${s.merged} merged into matching records`, s.renamed && `${s.renamed} same-name places renamed with their street`, s.matchedExisting && `${s.matchedExisting} matched organizations already in the app`, s.alreadyImported && `${s.alreadyImported.toLocaleString()} already imported`].filter(Boolean).map(t => `    ${t}`));
  if (report.sharedEmails) lines.push(`${report.sharedEmails} contacts share an email with another contact. The email is kept once and noted on the others.`);
  if (report.contactsAlreadyImported) lines.push(`${report.contactsAlreadyImported.toLocaleString()} contacts were already imported.`);
  if (report.errors.length) lines.push(`${report.errors.length} rows could not be imported:`, ...report.errors.slice(0, 25).map(e => `    ${e.source} ${e.id} ${e.name}: ${e.reason}`), ...(report.errors.length > 25 ? [`    …and ${report.errors.length - 25} more`] : []));
  if (report.updated) lines.push(`${report.updated.toLocaleString()} organizations already in the app get missing venue details filled in (tier, zone, distance, phone…). Nothing already filled in is changed.`);
  lines.push(`Total: ${orgs.length.toLocaleString()} organizations and ${contacts.length.toLocaleString()} contacts to add${report.updated ? `, ${report.updated.toLocaleString()} to fill in` : ''}.`);
  return lines;
}
// Applies planned fill-ins to the loaded organizations. The caller saves them.
export function applyUpdates(db, updates, now = new Date().toISOString()) {
  const byId = new Map(db.orgs.map(o => [o.id, o]));
  for (const { id, changes } of updates) Object.assign(byId.get(id), changes, { updatedAt: now });
}

// Venue fields fill gaps in an organization that is the same place (e.g. a pro shop in both the prospect list and the map pull).
// For an organization already in the app (fillOnly), its tier is kept if it has one, since it may have been edited.
// Country and jurisdiction are left alone: they are part of an organization's identity (see orgKey).
const VENUE_FIELDS = ['zone', 'milesFromHub', 'phone', 'email', 'social', 'postalCode', 'website', 'address', 'leagueChain'];
function absorb(target, venue, fillOnly = false) {
  for (const k of VENUE_FIELDS) if ((target[k] === '' || target[k] == null) && venue[k] !== '' && venue[k] != null) target[k] = venue[k];
  target.priority = fillOnly ? target.priority || venue.priority : best(target.priority, venue.priority);
  target.notes = join(target.notes, `Also on the OpenStreetMap venue list as ${venue.externalId} (${venue.category}${venue.zone ? `, zone ${venue.zone}` : ''}).`);
  if (target.contacts) target.contacts.push(...venue.contacts);
}

export function planImport(db, { prospects = [], venues = [], klaviyo = [] }, now = new Date().toISOString()) {
  const stats = source => ({ source: SOURCES[source].label, rows: 0, orgs: 0, merged: 0, alreadyImported: 0, matchedExisting: 0, contacts: 0, renamed: 0 });
  const report = { prospects: stats('prospects'), venues: stats('venues'), klaviyo: stats('klaviyo'), sharedEmails: 0, contactsAlreadyImported: 0, updated: 0, errors: [] };
  const drafts = { prospects: prospectDrafts(prospects), venues: venueDrafts(venues), klaviyo: klaviyoDrafts(klaviyo) };
  report.prospects.rows = prospects.length; report.venues.rows = venues.length; report.klaviyo.rows = klaviyo.length;

  // Venues the workbook flags as "in existing list" are merged into the matching prospect organization by name and city.
  // Prospect organizations already in the app are matched too, for when the venue file is uploaded on its own.
  const index = new Map(), add = (k, item) => { if (!index.has(k)) index.set(k, []); index.get(k).push(item); };
  for (const p of drafts.prospects) for (const n of new Set([p.name, p.organization])) add(`${loose(n)}|${looseCity(p.city)}`, p);
  for (const o of db.orgs) if (!/^(NA|EU)-/.test(o.externalId || '')) add(`${loose(o.name)}|${looseCity(o.city)}`, { existing: o, region: o.region });
  const existingMatches = [];
  drafts.venues = drafts.venues.filter(v => {
    if (!v.inExistingList) return true;
    const match = (index.get(`${loose(v.name)}|${looseCity(v.city)}`) || []).find(p => !p.absorbed && (!p.region || !v.region || p.region === v.region));
    if (match?.existing) { match.absorbed = true; existingMatches.push([match.existing, v]); report.venues.merged++; return false; }
    if (match) { match.ownPriority ??= match.priority; absorb(match, v); match.absorbed = true; (match.venues ||= []).push(v); report.venues.merged++; return false; }
    // Usually an arena that a team in the prospect list plays at: a different organization, so it is cross-referenced instead.
    const name = loose(v.name), sameCity = o => looseCity(o.city) === looseCity(v.city);
    const based = [...drafts.prospects.filter(p => sameCity(p) && p.venueNames.some(n => loose(n) === name)),
      ...(name.length >= 6 ? db.orgs.filter(o => /^SS-/.test(o.externalId || '') && sameCity(o) && loose(`${o.address} ${o.notes}`).includes(name) && !drafts.prospects.some(p => p.externalId === o.externalId)) : [])];
    v.notes = join(v.notes, based.length ? `Prospect-list organizations based here: ${based.map(p => `${p.name} (${p.category})`).join(', ')}.` : 'The workbook marks this venue as in the prospect list, but no match was found by name and city.');
    return true;
  });

  const byId = new Map(db.orgs.map(o => [o.id, o])), byKey = new Map(db.orgs.map(o => [orgKey(o), o])), created = new Map();
  const contactIds = new Set(db.contacts.map(c => c.id)), orgNames = new Map(db.orgs.map(o => [o.id, o.name]));
  const emails = new Map(db.contacts.filter(c => c.email).map(c => [c.email.toLowerCase(), c]));
  const orgs = [], contacts = [], pending = new Map();
  // Venue details for an organization that was imported earlier (e.g. the files were uploaded one at a time) fill its empty fields.
  // The venue's better tier still applies when the tier is the one it was imported with (not edited since).
  const fill = (target, venue, keepTier = true) => { if (!pending.has(target.id)) pending.set(target.id, { ...target }); absorb(pending.get(target.id), { ...venue, contacts: [] }, keepTier); };
  for (const [org, venue] of existingMatches) fill(org, venue, false);
  for (const source of ['prospects', 'venues', 'klaviyo']) for (const draft of drafts[source]) {
    const { contacts: people, organization, venueNames, inExistingList, absorbed, ownPriority, venues: matchedVenues = [], ...raw } = draft, s = report[source];
    let values; try { values = validateOrg(raw); } catch (e) { report.errors.push({ source: s.source, id: draft.externalId, name: draft.name, reason: e.message }); continue; }
    let id = stableId(`org:${values.externalId}`), target = byId.get(id);
    if (target) s.alreadyImported++;
    else {
      target = byKey.get(orgKey(values));
      // Two map entries with the same name in the same town are different places when their streets differ.
      if (target && source === 'venues' && created.get(target.id) === 'venues' && values.address && target.address && loose(values.address) !== loose(target.address)) { values.name = `${values.name} (${values.address})`; target = byKey.get(orgKey(values)); s.renamed++; }
      if (target && created.has(target.id) && source === 'venues') { absorb(target, { ...values, contacts: [] }); s.merged++; }
      else if (target) { s.matchedExisting++; if (source === 'venues') fill(target, values); }
      else { target = { id, ...values, createdAt: now, updatedAt: now }; orgs.push(target); created.set(id, source); byId.set(id, target); byKey.set(orgKey(target), target); orgNames.set(id, target.name); s.orgs++; }
    }
    if (!created.has(target.id)) for (const v of matchedVenues) fill(target, v, target.priority !== (ownPriority ?? values.priority));
    for (const person of people) {
      const contactId = stableId(`contact:${person.externalId}`);
      if (contactIds.has(contactId)) { report.contactsAlreadyImported++; continue; }
      const other = person.email && emails.get(person.email);
      if (other) { person.notes = join(person.notes, `Same email as ${other.name} at ${orgNames.get(other.orgId) || 'another organization'}: ${person.email}`); person.email = ''; report.sharedEmails++; }
      let values; try { values = validateContact({ ...person, orgId: target.id }); } catch (e) { report.errors.push({ source: s.source, id: person.externalId, name: person.name, reason: e.message }); continue; }
      const contact = { id: contactId, externalId: person.externalId, ...values, createdAt: now, updatedAt: now };
      contacts.push(contact); contactIds.add(contactId); if (contact.email) emails.set(contact.email, contact); s.contacts++;
    }
  }
  const updates = [...pending].map(([id, next]) => ({ id, changes: Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== byId.get(id)[k])) })).filter(u => Object.keys(u.changes).length);
  report.updated = updates.length;
  return { orgs, contacts, updates, report };
}
