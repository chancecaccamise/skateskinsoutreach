export const SEGMENTS = ['team', 'rink', 'pro_shop', 'wholesale'];
// The Deal Steps from the Outreach Plan workbook, plus the purchase steps for teams and direct orders.
// After "interested" a lead either buys (purchased → followed up after purchase) or becomes a display partner (agreement → installed → live).
export const STAGES = ['not_contacted', 'finding_contact', 'contacted', 'follow_up_1', 'follow_up_2', 'visit_booked', 'interested', 'purchased', 'purchase_follow_up', 'agreement_signed', 'display_installed', 'live', 'paused', 'not_a_fit'];
export const BASIS = ['unknown', 'public_business', 'inquiry', 'referral', 'existing_customer', 'consent'];
export const PRIORITIES = ['A', 'B', 'C', 'D', 'E'];
export const LABELS = {
  pro_shop: 'Pro shop', wholesale: 'Wholesale & chains',
  not_contacted: 'Not contacted', finding_contact: 'Finding contact', follow_up_1: 'Follow-up 1', follow_up_2: 'Follow-up 2', visit_booked: 'Visit / call booked',
  purchased: 'Purchased', purchase_follow_up: 'Followed up after purchase',
  agreement_signed: 'Agreement signed', display_installed: 'Display installed', live: 'Live – producing', not_a_fit: 'Not a fit',
  public_business: 'Public business', existing_customer: 'Existing customer'
};
// Stages from the first version of this app, kept so older CSVs and local data still load.
const LEGACY_STAGES = { researched: 'not_contacted', qualified: 'finding_contact', replied: 'interested', quoted: 'interested', won: 'agreement_signed', lost: 'not_a_fit' };
const CONTACTED = STAGES.slice(STAGES.indexOf('contacted'));
const ENGAGED = ['visit_booked', 'interested', 'purchased', 'purchase_follow_up', 'agreement_signed', 'display_installed', 'live'];
const SIGNED = ['agreement_signed', 'display_installed', 'live'], PURCHASED = ['purchased', 'purchase_follow_up'];

// One-click outreach. Each button moves a lead to a stage; the label is what the employee just did.
export const ACTION_LABELS = {
  not_contacted: 'Reset to not contacted', finding_contact: 'Finding contact', contacted: 'Contacted', follow_up_1: 'Followed up', follow_up_2: 'Followed up again',
  visit_booked: 'Booked visit / call', interested: 'Interested', purchased: 'Purchased', purchase_follow_up: 'Followed up after purchase',
  agreement_signed: 'Agreement signed', display_installed: 'Display installed', live: 'Live – producing', paused: 'Pause', not_a_fit: 'Not a fit'
};
// The buttons offered at each stage, most likely first. Teams buy; rinks, shops and chains usually sign up for a display first.
export function nextStages(org) {
  const wins = org.segment === 'team' ? ['purchased'] : ['agreement_signed', 'purchased'];
  return {
    not_contacted: ['contacted', 'finding_contact', 'not_a_fit'], finding_contact: ['contacted', 'not_a_fit'],
    contacted: ['follow_up_1', 'interested', 'visit_booked', 'not_a_fit'], follow_up_1: ['follow_up_2', 'interested', 'visit_booked', 'not_a_fit'],
    follow_up_2: ['interested', 'visit_booked', 'paused', 'not_a_fit'], visit_booked: ['interested', ...wins, 'not_a_fit'],
    interested: [...wins, 'paused', 'not_a_fit'], purchased: ['purchase_follow_up'], purchase_follow_up: ['purchased'],
    agreement_signed: ['display_installed'], display_installed: ['live'], live: [], paused: ['contacted', 'not_a_fit'], not_a_fit: ['not_contacted']
  }[org.stage] || ['contacted'];
}
// Moving to these stages counts as reaching out, so "last contacted" becomes today.
export const TOUCH_STAGES = ['contacted', 'follow_up_1', 'follow_up_2', 'visit_booked', 'purchase_follow_up'];
// The follow-up scheduled automatically when a lead reaches a stage (Deal Steps timing: 3 days, then 1 week, retry in 60 days).
export const FOLLOW_UPS = {
  contacted: { days: 3, title: 'Follow up (second touch)' }, follow_up_1: { days: 7, title: 'Follow up again (last try for now)' },
  follow_up_2: { days: 7, title: 'No reply? Pause and retry in 60 days' }, interested: { days: 2, title: 'Send the quote or partner agreement' },
  purchased: { days: 7, title: 'Follow up after the purchase' }, agreement_signed: { days: 7, title: 'Build and deliver the display kit' },
  display_installed: { days: 14, title: 'Check for the first order through their code' }, paused: { days: 60, title: 'Try again after the pause' }
};
export const AUTO_TASK_TITLES = Object.values(FOLLOW_UPS).map(f => f.title);
export function addDays(isoDay, days) { const d = new Date(`${isoDay}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

export function clean(value) { return String(value ?? '').trim(); }
export function norm(value) { return clean(value).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, ''); }
// Loose comparison key: case, accents, punctuation and spacing are ignored. Letters in any alphabet count.
export function loose(value) { return clean(value).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/&|\band\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ''); }
export function domain(value) {
  if (!clean(value)) return '';
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}
// Chain stores share a website, so identity is the name plus where it is.
export function orgKey(org) { return `${loose(org.name)}|${loose(org.city)}|${loose(org.region || org.jurisdiction)}`; }
export function contactKey(contact) { return norm(contact.email) || `${contact.orgId}:${norm(contact.name)}`; }
export function isoDate(value) { const s = clean(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''; const d = new Date(`${s}T12:00:00Z`); return Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== s ? '' : s; }
export function validUrl(value) { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol); } catch { return false; } }
export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
export function withScheme(value) { const s = clean(value); return s && !/^[a-z]+:/i.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s) ? `https://${s}` : s; }
export function stageFrom(value) {
  const s = clean(value); if (!s) return '';
  const key = s.toLowerCase().replace(/[\s/–-]+/g, '_');
  if (STAGES.includes(key)) return key;
  if (LEGACY_STAGES[key]) return LEGACY_STAGES[key];
  return STAGES.find(stage => loose(LABELS[stage] || stage) === loose(s)) || s;
}
function number(value) { if (value === '' || value == null) return null; const n = Number(value); return Number.isFinite(n) ? n : NaN; }

export function parseCsvRows(input) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field); if (row.some(x => x.trim())) rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field');
  row.push(field); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
export function parseCsv(input) {
  const rows = parseCsvRows(input);
  if (!rows.length) return [];
  const headers = rows.shift().map(x => norm(x.replace(/^﻿/, '')).replace(/[\s-]+/g, '_'));
  if (!headers.includes('name') || !headers.includes('segment') || !headers.includes('source_url') || !headers.includes('research_date'))
    throw new Error('CSV needs name, segment, source_url, and research_date columns');
  return rows.map((values, index) => ({ _row: index + 2, ...Object.fromEntries(headers.map((h, i) => [h, clean(values[i])])) }));
}

const TEXT_FIELDS = ['category', 'owner', 'phone', 'address', 'region', 'postalCode', 'country', 'jurisdiction', 'zone', 'leagueChain', 'social', 'sourceDataset', 'externalId', 'notes', 'nextStep', 'inquiryId', 'designId', 'checkoutLinkId', 'orderId'];
export function validateOrg(raw) {
  const org = {
    name: clean(raw.name), segment: clean(raw.segment), stage: stageFrom(raw.stage) || 'not_contacted', priority: clean(raw.priority).toUpperCase(),
    ...Object.fromEntries(TEXT_FIELDS.map(k => [k, clean(raw[k])])),
    city: clean(raw.city || raw.location), website: withScheme(raw.website), email: clean(raw.email).toLowerCase(),
    milesFromHub: number(raw.milesFromHub), lastContacted: isoDate(raw.lastContacted),
    sourceUrl: clean(raw.sourceUrl), researchDate: isoDate(raw.researchDate),
    contactBasis: clean(raw.contactBasis || 'unknown'), optOut: !!raw.optOut, suppressed: !!raw.suppressed,
    orderAmount: number(raw.orderAmount), orderCurrency: clean(raw.orderCurrency || 'USD').toUpperCase()
  };
  if (!org.name) throw new Error('Organization name is required');
  if (!SEGMENTS.includes(org.segment)) throw new Error('Choose team, rink, pro shop, or wholesale & chains');
  if (!STAGES.includes(org.stage)) throw new Error('Invalid pipeline stage');
  if (org.priority && !PRIORITIES.includes(org.priority)) throw new Error('Priority must be A, B, C, D, or E');
  if (!BASIS.includes(org.contactBasis)) throw new Error('Invalid contact basis');
  if (!validUrl(org.sourceUrl)) throw new Error('A valid source URL is required');
  if (!org.researchDate) throw new Error('Research date is required');
  if (org.website && !validUrl(org.website)) throw new Error('Website must be a valid URL');
  if (org.email && !validEmail(org.email)) throw new Error('Invalid organization email');
  if (clean(raw.lastContacted) && !org.lastContacted) throw new Error('Last contacted must be a date');
  if (Number.isNaN(org.milesFromHub) || org.milesFromHub < 0) throw new Error('Miles must be a nonnegative number');
  if (org.orderAmount !== null && (!Number.isFinite(org.orderAmount) || org.orderAmount < 0)) throw new Error('Order amount must be nonnegative');
  if (org.orderAmount !== null && !org.orderId) throw new Error('An order reference is required with an amount');
  return org;
}
export function validateContact(raw) {
  const contact = { orgId: raw.orgId, name: clean(raw.name), role: clean(raw.role), email: clean(raw.email).toLowerCase(), phone: clean(raw.phone), contactBasis: clean(raw.contactBasis || 'unknown'), sourceUrl: clean(raw.sourceUrl), optOut: !!raw.optOut, suppressed: !!raw.suppressed, notes: clean(raw.notes) };
  if (!contact.name) throw new Error('Contact name is required');
  if (!BASIS.includes(contact.contactBasis)) throw new Error('Invalid contact basis');
  if (contact.email && !validEmail(contact.email)) throw new Error('Invalid email');
  if (contact.sourceUrl && !validUrl(contact.sourceUrl)) throw new Error('Invalid contact source URL');
  return contact;
}

export function metrics(db, today = new Date().toISOString().slice(0, 10)) {
  const openTasks = db.tasks.filter(t => t.status !== 'done');
  const orders = db.orgs.filter(o => o.orderId);
  const replied = new Set(db.activities.filter(a => a.type === 'reply').map(a => a.orgId));
  return {
    organizations: db.orgs.length,
    contacted: db.orgs.filter(o => CONTACTED.includes(o.stage)).length,
    replies: db.orgs.filter(o => replied.has(o.id) || ENGAGED.includes(o.stage)).length,
    overdue: openTasks.filter(t => t.dueDate < today).length,
    dueToday: openTasks.filter(t => t.dueDate === today).length,
    partners: db.orgs.filter(o => SIGNED.includes(o.stage)).length,
    purchases: db.orgs.filter(o => PURCHASED.includes(o.stage)).length,
    live: db.orgs.filter(o => o.stage === 'live').length,
    orders: orders.length,
    attributedRevenue: orders.reduce((sum, o) => sum + (o.orderCurrency === 'USD' ? Number(o.orderAmount || 0) : 0), 0),
    pendingSuggestions: db.suggestions.filter(s => s.status === 'pending').length
  };
}
