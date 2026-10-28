const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let labels = {};
const title = s => labels[s] || String(s || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const today = () => new Date().toLocaleDateString('en-CA');
const dateLabel = s => s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const dollars = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
const PAGE = 100;
const blankFilter = () => ({ search: '', segment: '', category: '', stage: '', priority: '', zone: '', country: '', owner: '', suppression: '', reach: '', sort: 'updated' });
let state = null, view = 'dashboard', selected = null, playbook = null, limit = PAGE, filter = blankFilter(), listKey = null, listTab = '', back = null;
const zoneTab = n => [String(n), o => o.zone?.startsWith(`${n} `)];
// One page per source list. Tabs mirror the source workbook's tabs (prospects) or the plan's target zones (venues).
// A venue merged into a prospect record appears on both pages; its notes carry the venue id.
const LISTS = {
  prospects: { title: 'Prospect list', icon: '☰', source: 'SkateSkins Prospect List – USA and Canada (All Leads)', blurb: 'NHL/AHL, junior and college equipment staff, chains, buying groups, and shops, researched from public sources (built Oct 2, 2026). Counts are organizations; the workbook lists one row per contact.',
    match: o => /^SS-/.test(o.externalId || ''), tabs: [
      ['NHL & AHL', o => ['NHL Team', 'AHL Team'].includes(o.category)], ['Minor Pro & Junior', o => ['Minor Pro Team', 'Junior Team'].includes(o.category)],
      ['College', o => ['NCAA D1', 'NCAA D3', 'ACHA Club', 'U SPORTS'].includes(o.category)],
      ['Chains & Buyers', o => ['Chain Store Location', 'Chain HQ / Buyer', 'Big Box', 'Buying Group', 'Online Retailer', 'Distributor / Rep', 'Team Dealer', 'Trade Show'].includes(o.category)],
      ['US Shops', o => ['Independent Hockey Shop', 'Rink Pro Shop'].includes(o.category) && o.country === 'USA'], ['Canada Shops', o => ['Independent Hockey Shop', 'Rink Pro Shop'].includes(o.category) && o.country === 'Canada']] },
  venuesNA: { title: 'Venues – North America', icon: '⌂', source: 'Outreach Plan & Rink List – Venues – North America', blurb: 'Rinks, arenas, rec centres, and hockey shops from OpenStreetMap (built Oct 12, 2026). Work them top-down by tier.',
    match: o => /^NA-/.test(o.externalId || '') || /venue list as NA-/.test(o.notes || ''), tabs: [1, 2, 3, 4].map(zoneTab) },
  venuesEU: { title: 'Venues – Europe', icon: '◎', source: 'Outreach Plan & Rink List – Venues – Europe', blurb: 'European rinks and hockey shops from OpenStreetMap. Held for phase 3.',
    match: o => /^EU-/.test(o.externalId || '') || /venue list as EU-/.test(o.notes || ''), tabs: [5, 6].map(zoneTab) },
  customers: { title: 'Klaviyo customers', icon: '★', source: 'WNY teams from Klaviyo (Oct 9, 2026)', blurb: 'Existing SkateSkins customers and subscribers. Not cold prospects: treat outreach as account follow-up.',
    match: o => (o.externalId || '').startsWith('klaviyo:'), tabs: [] }
};
// Rebuilt on every refresh so search, counts and lookups stay fast with thousands of records.
let index = { orgs: new Map(), contacts: new Map(), haystack: new Map(), stages: new Map(), options: {} };

async function api(path, method = 'GET', data) {
  const res = await fetch(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const body = await res.json();
  if (res.status === 401 && !path.startsWith('login')) showLogin();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
async function refresh() { state = await api('state'); labels = state.labels || {}; buildIndex(); render(); }
function buildIndex() {
  const contacts = new Map(), stages = new Map(), distinct = key => [...new Set(state.orgs.map(o => o[key]).filter(Boolean))].sort();
  for (const c of state.contacts) { if (!contacts.has(c.orgId)) contacts.set(c.orgId, []); contacts.get(c.orgId).push(c); }
  for (const o of state.orgs) stages.set(o.stage, (stages.get(o.stage) || 0) + 1);
  const haystack = new Map(state.orgs.map(o => [o.id, [o.name, o.website, o.address, o.city, o.region, o.country, o.jurisdiction, o.owner, o.notes, o.category, o.leagueChain, o.externalId, o.email, o.phone, ...(contacts.get(o.id) || []).flatMap(c => [c.name, c.email, c.role])].join(' ').toLowerCase()]));
  const lists = Object.fromEntries(Object.entries(LISTS).map(([key, l]) => [key, state.orgs.filter(l.match).length]));
  index = { orgs: new Map(state.orgs.map(o => [o.id, o])), contacts, haystack, stages, lists, options: { category: distinct('category'), zone: distinct('zone'), country: distinct('country'), owner: distinct('owner') } };
}
function showLogin() { $('#modal').open && $('#modal').close(); $('#login').classList.remove('hidden'); $('#login-form [name=email]').focus(); }
async function start() {
  const session = await api('session');
  if (session.mode === 'supabase') {
    $('#mode-badge').textContent = 'SUPABASE'; $('#mode-title').textContent = 'Shared workspace';
    $('#mode-text').textContent = `${session.user ? `Signed in as ${session.user.email}. ` : ''}Records are stored in Supabase. Outreach is never sent from here.`;
    $('#sign-out').classList.toggle('hidden', !session.user);
    if (!session.user) return showLogin();
  }
  $('#login').classList.add('hidden'); await refresh();
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 3600); }
function empty(icon, heading, text, action = '') { return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${heading}</h3><p>${text}</p>${action}</div>`; }
function badge(value) { return `<span class="badge ${esc(value)}">${esc(title(value))}</span>`; }
function tier(value) { return value ? `<span class="badge tier tier-${esc(value)}" title="Priority / tier">${esc(value)}</span>` : '<span class="muted">—</span>'; }
function orgName(id) { return index.orgs.get(id)?.name || 'Unknown organization'; }
function place(o) { return [o.city, o.region, ['USA', 'Canada'].includes(o.country) ? '' : o.country].filter(Boolean).join(', '); }
function openTasks() { return state.tasks.filter(t => t.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate)); }
function linkOrDash(value, label = value) { return value ? `<a href="${esc(value)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : '—'; }
function zoneCounts(zone) { const items = state.orgs.filter(o => o.zone === zone); return { all: items.length, rinks: items.filter(o => o.segment === 'rink').length, shops: items.filter(o => o.segment === 'pro_shop').length, contacted: items.filter(o => !['not_contacted', 'finding_contact'].includes(o.stage)).length, live: items.filter(o => o.stage === 'live').length }; }

function render() {
  const crumb = selected && view === 'organizations' ? 'ORGANIZATION' : view === 'dashboard' ? 'OVERVIEW' : view === 'list' ? LISTS[listKey].title.toUpperCase() : view.toUpperCase();
  $('#crumb').textContent = crumb;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view && (!el.dataset.list || el.dataset.list === listKey)));
  document.querySelectorAll('[data-list-count]').forEach(el => { el.textContent = (index.lists[el.dataset.listCount] || 0).toLocaleString(); });
  $('#nav-pending').textContent = state.metrics.pendingSuggestions;
  $('#nav-pending').classList.toggle('hidden', !state.metrics.pendingSuggestions);
  if (view === 'playbook' && !playbook) { $('#content').innerHTML = empty('❏', 'Loading playbook…', ''); api('playbook').then(p => { playbook = p; render(); }).catch(err => toast(err.message)); return; }
  $('#content').innerHTML = view === 'dashboard' ? dashboard() : view === 'pipeline' ? pipeline() : view === 'tasks' ? tasksView() : view === 'research' ? researchView() : view === 'playbook' ? playbookView() : view === 'list' ? listView() : selected ? detail() : organizations();
}
function dashboard() {
  const m = state.metrics, due = openTasks().slice(0, 5), recent = [...state.orgs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const tierA = state.orgs.filter(o => o.priority === 'A' && o.stage === 'not_contacted').length;
  return `<div class="page-head"><div><div class="eyebrow">GROWTH / TEAM ORDERS & PARTNERSHIPS</div><h1>Outreach overview</h1><p>One place to track opportunities, replies, and next actions.</p></div><div class="head-actions">${state.orgs.length ? '' : '<button class="button primary" data-action="import-leads">Import lead files</button>'}${tierA ? `<button class="button primary" data-preset="tier-a">Start with Tier A (${tierA}) →</button>` : ''}<button class="button ghost" data-view="playbook">Playbook ↗</button></div></div>
    <div class="metric-grid">
      <div class="metric"><div class="label">CONTACTED</div><div class="value">${m.contacted}</div><div class="hint">of ${m.organizations.toLocaleString()} organizations</div></div>
      <div class="metric"><div class="label">REPLIES</div><div class="value">${m.replies}</div><div class="hint">Reply logged, or visit booked and beyond</div></div>
      <div class="metric red"><div class="label">OVERDUE ACTIONS</div><div class="value">${m.overdue}</div><div class="hint">${m.dueToday} due today</div></div>
      <div class="metric"><div class="label">WON</div><div class="value">${m.purchases + m.partners}</div><div class="hint">${m.purchases} purchased · ${m.partners} display partners (${m.live} live)</div></div>
      <div class="metric accent"><div class="label">ATTRIBUTED REVENUE</div><div class="value">${dollars(m.attributedRevenue)}</div><div class="hint">${m.orders} manual order references</div></div>
    </div>
    <div class="grid-two"><section class="panel"><div class="panel-head"><h3>Pipeline pulse</h3><small>${m.organizations.toLocaleString()} organizations</small></div><div class="panel-body"><div class="pipeline-strip">${state.stages.map(s => `<button class="stage-tile" data-stage-jump="${s}"><span class="count">${(index.stages.get(s) || 0).toLocaleString()}</span><span class="name">${title(s)}</span></button>`).join('')}</div></div></section>
    <section class="panel"><div class="panel-head"><h3>Next follow-ups</h3><button class="table-link" data-view="tasks">View all →</button></div><div class="panel-body">${due.length ? due.map(t => `<div class="task-row"><div class="task-main"><b>${esc(t.title)}</b><small>${esc(orgName(t.orgId))}</small></div><span class="date-badge ${t.dueDate < today() ? 'overdue' : ''}">${dateLabel(t.dueDate)}</span></div>`).join('') : empty('◷', 'Nothing due', 'Scheduled follow-ups will appear here.')}</div></section></div>
    <section class="panel" style="margin-top:17px"><div class="panel-head"><h3>Recently updated</h3><button class="table-link" data-view="organizations">All organizations →</button></div>${recent.length ? orgTable(recent, { reach: false }) : empty('◈', 'Build your first lead list', 'Import the lead spreadsheets, or add a researched organization.', '<button class="button primary" data-action="import-leads">Import lead files</button> <button class="button ghost" data-action="new-org">+ Add lead</button>')}</section>`;
}
function orgTable(items, { reach = true } = {}) { return `<div class="table-wrap"><table class="data-table${reach ? ' reach-table' : ''}">${reach ? '<colgroup><col style="width:18%"><col style="width:21%"><col style="width:48px"><col></colgroup>' : ''}<thead><tr><th>Organization</th>${reach ? '<th>Contact</th>' : '<th>Segment</th>'}<th>Tier</th>${reach ? '<th>Pipeline stage <span class="th-hint">click the step that just happened</span></th>' : '<th>Stage</th><th>Owner</th><th>Updated</th>'}</tr></thead><tbody>${items.map(o => orgRow(o, reach)).join('')}</tbody></table></div>`; }
// Best person to reach first: someone with an email, then a phone, then a named role.
function people(o) { const score = c => (c.email ? 4 : 0) + (c.phone ? 2 : 0) + (c.role ? 1 : 0); return [...(index.contacts.get(o.id) || [])].sort((a, b) => score(b) - score(a)); }
const mail = email => `<a href="mailto:${esc(email)}" title="${esc(email)}">${esc(email)}</a>`, call = phone => `<a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">${esc(phone)}</a>`;
function reachCells(o) {
  const list = people(o), c = list[0], email = c?.email || o.email, phone = c?.phone || o.phone;
  const who = c ? `<b>${esc(c.name)}</b>${c.role ? `<span class="subline">${esc(c.role)}</span>` : ''}${list.length > 1 ? `<button class="more-contacts" data-open-org="${o.id}">+${list.length - 1} more</button>` : ''}` : `<span class="muted-text">${email || phone ? 'General line, no named contact' : 'No contact yet'}</span>`;
  const ways = [email && mail(email), phone && call(phone), !email && !phone && o.website && `<a href="${esc(o.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>`, !email && !phone && o.social && `<span class="subline">${esc(o.social)}</span>`].filter(Boolean);
  return `<td class="contact-cell">${who}${ways.length ? `<div class="reach-cell">${ways.join('')}</div>` : ''}</td>`;
}
// One-click outreach buttons. The first is the most likely next step; quiet ones (pause, not a fit, reset) are de-emphasized.
const QUIET = ['paused', 'not_a_fit', 'not_contacted', 'finding_contact'];
function nextFor(o) { return state.flow[o.segment === 'team' ? 'team' : 'other'][o.stage] || []; }
function actionButtons(o, max = Infinity) { return nextFor(o).slice(0, max).map((s, i) => `<button class="button small act ${i === 0 && !QUIET.includes(s) ? 'act-primary' : QUIET.includes(s) ? 'act-quiet' : ''}" data-advance="${o.id}" data-stage="${s}">${esc(state.flow.actions[s])}</button>`).join(''); }
function stageGroup(s) { return { not_contacted: 'new', interested: 'engaged', paused: 'paused', not_a_fit: 'lost' }[s] || (['purchased', 'purchase_follow_up', 'agreement_signed', 'display_installed', 'live'].includes(s) ? 'won' : 'working'); }
function orgRow(o, reach = false) { return `<tr class="stage-${stageGroup(o.stage)}"><td><button class="table-link name-cell" data-open-org="${o.id}">${esc(o.name)}</button><span class="subline">${esc([place(o) || (reach ? '' : o.website) || 'No location recorded', o.category, reach && o.owner && `Owner: ${o.owner}`].filter(Boolean).join(' · '))}</span></td>${reach ? reachCells(o) : `<td>${badge(o.segment)}</td>`}<td>${tier(o.priority)}</td>${reach ? `<td class="stage-cell">${stageBar(o)}</td>` : `<td>${badge(o.stage)}</td><td>${esc(o.owner || 'Unassigned')}</td><td>${dateLabel(o.updatedAt)}</td>`}</tr>`; }
const miles = o => o.milesFromHub ?? Infinity;
const sorts = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  priority: (a, b) => (a.priority || 'Z').localeCompare(b.priority || 'Z') || miles(a) - miles(b) || a.name.localeCompare(b.name),
  miles: (a, b) => miles(a) - miles(b) || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name)
};
function reachable(o, how) {
  const list = index.contacts.get(o.id) || [], email = !!o.email || list.some(c => c.email), phone = !!o.phone || list.some(c => c.phone);
  return how === 'email' ? email : how === 'phone' ? phone : how === 'named' ? list.some(c => c.role || !/general contact/i.test(c.name)) : how === 'any' ? email || phone : !email && !phone;
}
function filteredOrgs(sort = filter.sort, base = () => true) {
  const q = filter.search.trim().toLowerCase(), f = filter;
  return state.orgs.filter(o => base(o) && (!q || index.haystack.get(o.id).includes(q))
    && (!f.segment || o.segment === f.segment) && (!f.category || o.category === f.category) && (!f.stage || o.stage === f.stage)
    && (!f.priority || (f.priority === 'none' ? !o.priority : o.priority === f.priority)) && (!f.zone || o.zone === f.zone) && (!f.country || o.country === f.country)
    && (!f.owner || o.owner === f.owner) && (!f.suppression || (f.suppression === 'suppressed' ? o.suppressed || o.optOut : !o.suppressed && !o.optOut))
    && (!f.reach || reachable(o, f.reach))
  ).sort(sorts[sort] || sorts.updated);
}
function select(id, key, allLabel, values, labelFor = title) { return `<select id="${id}" aria-label="${esc(allLabel)}"><option value="">${esc(allLabel)}</option>${values.map(v => `<option value="${esc(v)}" ${filter[key] === v ? 'selected' : ''}>${esc(labelFor(v))}</option>`).join('')}</select>`; }
function filterBar({ sort = true } = {}) {
  const active = Object.entries(filter).some(([k, v]) => k !== 'sort' && v), same = v => v;
  return `<div class="filters"><input id="search" type="search" placeholder="Search organizations, contacts, notes…" value="${esc(filter.search)}" aria-label="Search organizations">
    ${select('segment-filter', 'segment', 'All segments', state.segments)}${select('category-filter', 'category', 'All categories', index.options.category, same)}
    ${select('stage-filter', 'stage', 'All stages', state.stages)}${select('priority-filter', 'priority', 'All tiers', [...state.priorities, 'none'], v => v === 'none' ? 'No tier' : `Tier ${v}`)}
    ${select('zone-filter', 'zone', 'All zones', index.options.zone, same)}${select('country-filter', 'country', 'All countries', index.options.country, same)}
    ${select('owner-filter', 'owner', 'All owners', index.options.owner, same)}${select('reach-filter', 'reach', 'Any contact info', ['email', 'phone', 'any', 'named', 'none'], v => ({ email: 'Has email', phone: 'Has phone', any: 'Has email or phone', named: 'Has a named contact', none: 'No email or phone' })[v])}
    <select id="suppression-filter" aria-label="Filter compliance"><option value="">All compliance</option><option value="active" ${filter.suppression === 'active' ? 'selected' : ''}>Not suppressed</option><option value="suppressed" ${filter.suppression === 'suppressed' ? 'selected' : ''}>Opted out / suppressed</option></select>
    ${sort ? `<select id="sort-filter" aria-label="Sort"><option value="updated" ${filter.sort === 'updated' ? 'selected' : ''}>Sort: recently updated</option><option value="priority" ${filter.sort === 'priority' ? 'selected' : ''}>Sort: tier, then distance</option><option value="miles" ${filter.sort === 'miles' ? 'selected' : ''}>Sort: miles from Buffalo</option><option value="name" ${filter.sort === 'name' ? 'selected' : ''}>Sort: name</option></select>` : ''}
    ${active ? '<button class="button ghost small" data-clear-filters>Clear filters</button>' : ''}</div>`;
}
function results(items, emptyAction = '<button class="button primary" data-action="import-leads">Import lead files</button> <button class="button ghost" data-action="new-org">+ Add lead</button>') {
  const shown = items.slice(0, limit);
  return `<section class="panel">${items.length ? `${orgTable(shown)}<div class="list-foot"><small>Showing ${shown.length.toLocaleString()} of ${items.length.toLocaleString()}</small>${items.length > shown.length ? `<button class="button small" data-more>Show ${Math.min(PAGE, items.length - shown.length)} more</button>` : ''}</div>` : empty('◈', state.orgs.length ? 'No matching records' : 'No organizations yet', state.orgs.length ? 'Try another search, tab, or filter.' : 'Import the lead spreadsheets, or add a researched lead.', state.orgs.length ? '' : emptyAction)}</section>`;
}
function listView() {
  const list = LISTS[listKey], inList = state.orgs.filter(list.match), tab = list.tabs.find(([name]) => name === listTab), base = o => list.match(o) && (!tab || tab[1](o));
  const zoneName = n => index.options.zone.find(z => z.startsWith(`${n} `)) || n, tabLabel = name => /^\d$/.test(name) ? zoneName(name) : name;
  const people = inList.reduce((n, o) => n + (index.contacts.get(o.id)?.length || 0), 0);
  const stat = (label, value) => `<div class="list-stat"><b>${value.toLocaleString()}</b><span>${label}</span></div>`;
  return `<div class="page-head"><div><div class="eyebrow">LEAD LIST / ${esc(list.source.toUpperCase())}</div><h1>${esc(list.title)}</h1><p>${esc(list.blurb)}</p></div><div class="head-actions"><button class="button ghost" data-action="import-leads">Import lead files</button></div></div>
    <div class="list-stats">${stat('organizations', inList.length)}${stat('contacts', people)}${stat('tier A', inList.filter(o => o.priority === 'A').length)}${stat('not contacted', inList.filter(o => o.stage === 'not_contacted').length)}${stat('in progress or won', inList.filter(o => !['not_contacted', 'paused', 'not_a_fit'].includes(o.stage)).length)}</div>
    ${list.tabs.length ? `<div class="list-tabs" role="tablist"><button role="tab" class="${!tab ? 'active' : ''}" data-list-tab="">All <span>${inList.length.toLocaleString()}</span></button>${list.tabs.map(([name, test]) => `<button role="tab" class="${tab?.[0] === name ? 'active' : ''}" data-list-tab="${esc(name)}">${esc(tabLabel(name))} <span>${inList.filter(test).length.toLocaleString()}</span></button>`).join('')}</div>` : ''}
    <div class="stage-chips">${state.stages.map(st => { const n = inList.filter(o => o.stage === st && (!tab || tab[1](o))).length; return n || filter.stage === st ? `<button class="stage-chip stage-${stageGroup(st)} ${filter.stage === st ? 'active' : ''}" data-stage-chip="${st}">${esc(title(st))} <b>${n.toLocaleString()}</b></button>` : ''; }).join('')}</div>
    ${filterBar()}${results(filteredOrgs(filter.sort, base))}`;
}
function organizations() {
  const items = filteredOrgs(), shown = items.slice(0, limit);
  return `<div class="page-head"><div><div class="eyebrow">RELATIONSHIPS / ${state.orgs.length.toLocaleString()} TOTAL</div><h1>Organizations</h1><p>Teams, rinks, pro shops, and wholesale accounts across your pipeline.</p></div><div class="head-actions"><button class="button ghost" data-action="import-leads">Import lead files</button><button class="button ghost" data-action="import">Import CSV</button><button class="button primary" data-action="new-org">+ Add lead</button></div></div>${filterBar()}
    <div id="org-results"><section class="panel">${items.length ? `${orgTable(shown)}<div class="list-foot"><small>Showing ${shown.length.toLocaleString()} of ${items.length.toLocaleString()}</small>${items.length > shown.length ? `<button class="button small" data-more>Show ${Math.min(PAGE, items.length - shown.length)} more</button>` : ''}</div>` : empty('◈', state.orgs.length ? 'No matching records' : 'No organizations yet', state.orgs.length ? 'Try another search or filter.' : 'Import the lead spreadsheets, or add a researched lead.', '<button class="button primary" data-action="import-leads">Import lead files</button> <button class="button ghost" data-action="new-org">+ Add lead</button>')}</section></div>`;
}
const BOARD = 20;
function pipeline() {
  const items = filteredOrgs('priority'), byStage = new Map(state.stages.map(s => [s, []]));
  for (const o of items) byStage.get(o.stage)?.push(o);
  return `<div class="page-head"><div><div class="eyebrow">OPPORTUNITIES / ${items.length.toLocaleString()} SHOWN</div><h1>Pipeline</h1><p>Follow each relationship through the deal steps. Each column lists its top ${BOARD} by tier, then distance.</p></div></div>${filterBar({ sort: false })}
    <div class="pipeline-board">${state.stages.map(stage => { const list = byStage.get(stage); return `<div class="pipeline-col"><div class="pipeline-col-head">${title(stage)} <span>${list.length.toLocaleString()}</span></div>${list.slice(0, BOARD).map(o => `<div class="pipeline-lead" data-open-org="${o.id}"><b>${esc(o.name)}</b><div style="margin-top:8px">${badge(o.segment)} ${tier(o.priority)}</div><small>${esc(place(o) || o.owner || 'Unassigned')}</small>${nextFor(o).length ? `<div class="stage-actions">${actionButtons(o, 1)}</div>` : ''}</div>`).join('')}${list.length > BOARD ? `<button class="table-link more-link" data-stage-jump="${stage}">+${(list.length - BOARD).toLocaleString()} more in list →</button>` : ''}</div>`; }).join('')}</div>`;
}
function tasksView() { const items = openTasks(); const done = state.tasks.filter(t => t.status === 'done').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); return `<div class="page-head"><div><div class="eyebrow">ACTIONS / ${items.length} OPEN</div><h1>Follow-ups</h1><p>Keep dated next steps tied to each organization.</p></div></div><section class="panel"><div class="panel-head"><h3>Open actions</h3><small>${state.metrics.overdue} overdue</small></div>${items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Due</th><th>Task</th><th>Organization</th><th>Log what happened</th><th></th></tr></thead><tbody>${items.map(t => `<tr><td><span class="date-badge ${t.dueDate < today() ? 'overdue' : ''}">${dateLabel(t.dueDate)}</span></td><td class="name-cell">${esc(t.title)}</td><td><button class="table-link" data-open-org="${t.orgId}">${esc(orgName(t.orgId))}</button></td><td>${index.orgs.get(t.orgId) ? stageBar(index.orgs.get(t.orgId)) : ''}</td><td><button class="button small" data-task-done="${t.id}">Mark done</button></td></tr>`).join('')}</tbody></table></div>` : empty('◷', 'All caught up', 'Add a follow-up from an organization record.')}</section>${done.length ? `<section class="panel" style="margin-top:17px"><div class="panel-head"><h3>Completed</h3></div><div class="panel-body">${done.slice(0, 10).map(t => `<div class="task-row"><div class="task-main"><b>${esc(t.title)}</b><small>${esc(orgName(t.orgId))}</small></div><button class="button small" data-task-open="${t.id}">Reopen</button></div>`).join('')}</div></section>` : ''}`; }
function researchView() { const pending = state.suggestions.filter(s => s.status === 'pending'), reviewed = state.suggestions.filter(s => s.status !== 'pending'); return `<div class="page-head"><div><div class="eyebrow">EVIDENCE / HUMAN APPROVAL</div><h1>Research review</h1><p>Suggestions become leads only after a person checks the source and approves them.</p></div><button class="button primary" data-action="new-suggestion">+ Add suggestion</button></div><div class="notice">No research or mailbox integration is connected. This queue accepts manually entered, sourced suggestions and never sends outreach.</div><section class="panel"><div class="panel-head"><h3>Pending suggestions</h3><small>${pending.length} waiting</small></div><div class="panel-body">${pending.length ? pending.map(s => `<div class="review-card"><div style="display:flex;justify-content:space-between;gap:12px"><div><div class="eyebrow" style="margin:0">${esc(title(s.segment))} · ${esc(s.jurisdiction || 'Jurisdiction unrecorded')}</div><h3 style="margin:5px 0">${esc(s.name)}</h3></div><span class="date-badge">${dateLabel(s.researchDate)}</span></div><div class="review-evidence">${esc(s.evidence)}</div><p>Source: ${linkOrDash(s.sourceUrl)} · Basis: ${esc(title(s.contactBasis))}</p><div class="review-actions"><button class="button primary small" data-review="approve" data-id="${s.id}">Approve as lead</button><button class="button danger small" data-review="reject" data-id="${s.id}">Reject</button></div></div>`).join('') : empty('✧', 'No suggestions waiting', 'Add a sourced suggestion to review before it enters the pipeline.')}</div></section>${reviewed.length ? `<section class="panel" style="margin-top:17px"><div class="panel-head"><h3>Reviewed</h3></div><div class="panel-body">${reviewed.slice(0, 10).map(s => `<div class="task-row"><div class="task-main"><b>${esc(s.name)}</b><small>${dateLabel(s.reviewedAt)}</small></div>${badge(s.status)}</div>`).join('')}</div></section>` : ''}`; }
const PURCHASE_STEPS = [{ stage: 'purchased', meaning: 'They placed an order (team order or direct purchase).', doneWhen: 'Follow up within a week of delivery.' }, { stage: 'purchase_follow_up', meaning: 'Checked in after the order: fit, feedback, photos, and a reorder or referral.', doneWhen: '—' }];
function playbookView() {
  const p = playbook, steps = new Map([...p.dealSteps, ...PURCHASE_STEPS].map(s => [s.stage, s]));
  const tierCounts = t => { const items = state.orgs.filter(o => o.priority === t); return `${items.length.toLocaleString()} organizations · ${items.filter(o => o.stage === 'not_contacted').length.toLocaleString()} not contacted`; };
  return `<div class="page-head"><div><div class="eyebrow">SALES PLAYBOOK / FROM ${esc(p.source.toUpperCase())}</div><h1>Playbook</h1><p>Where to go first, who decides, what to say, and when a deal moves forward.</p></div></div>
    <div class="grid-two"><section class="panel"><div class="panel-head"><h3>Plan of attack</h3></div><div class="panel-body"><p class="lead-text">${esc(p.plan)}</p>
      <div class="tier-list">${p.tiers.map(t => `<button class="tier-row" data-set-filter="priority" data-value="${esc(t.tier)}">${tier(t.tier)}<span><b>${esc(t.text.split('. ')[0])}.</b> ${esc(t.text.split('. ').slice(1).join('. '))}<small>${tierCounts(t.tier)}</small></span></button>`).join('')}</div></div></section>
    <section class="panel"><div class="panel-head"><h3>Weekly targets</h3><small>Part-time coordinator</small></div><div class="panel-body"><ul class="plain-list">${p.weeklyTargets.map(t => `<li>${esc(t)}</li>`).join('')}</ul><h4>What goes into a deal</h4><ol class="plain-list">${p.dealIncludes.map(t => `<li>${esc(t.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol></div></section></div>
    <section class="panel playbook-section"><div class="panel-head"><h3>Target areas</h3><small>Live counts from your records. Click a zone to open it.</small></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Zone</th><th>Approach</th><th>When</th><th>All</th><th>Rinks</th><th>Shops</th><th>Contacted+</th><th>Live</th></tr></thead><tbody>${p.zones.map(z => { const c = zoneCounts(z.zone); return `<tr><td><button class="table-link" data-set-filter="zone" data-value="${esc(z.zone)}">${esc(z.zone)}</button></td><td class="wrap-cell">${esc(z.approach)}</td><td>${esc(z.when)}</td><td>${c.all.toLocaleString()}</td><td>${c.rinks.toLocaleString()}</td><td>${c.shops.toLocaleString()}</td><td>${c.contacted}</td><td>${c.live}</td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="panel playbook-section"><div class="panel-head"><h3>Deal steps</h3><small>A lead only moves forward when "done when" is true.</small></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Stage</th><th>What it means</th><th>Done when</th><th>Now</th></tr></thead><tbody>${state.stages.map(s => { const d = steps.get(s) || {}; return `<tr><td>${badge(s)}</td><td class="wrap-cell">${esc(d.meaning || '')}</td><td class="wrap-cell">${esc(d.doneWhen || '')}</td><td><button class="table-link" data-stage-jump="${s}">${(index.stages.get(s) || 0).toLocaleString()}</button></td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="playbook-section"><h2 class="section-title">Contact playbook</h2><div class="place-grid">${p.places.map(x => `<article class="panel place-card"><div class="panel-head"><h3>${esc(x.place)}</h3></div><div class="panel-body"><dl>${[['Who decides', x.whoDecides], ['How to find them', x.howToFind], ['Best way in', x.bestWayIn], ['What to offer', x.offer], ['Follow-up rhythm', x.followUp]].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></article>`).join('')}</div>
      <section class="panel" style="margin-top:17px"><div class="panel-head"><h3>Finding a contact when the map has nothing</h3></div><div class="panel-body"><ol class="plain-list">${p.findingContact.map(t => `<li>${esc(t.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol></div></section></section>
    <section class="playbook-section"><h2 class="section-title">Scripts</h2><div class="notice">${esc(p.scriptsNote)}</div><div class="script-grid">${p.scripts.map((s, i) => `<article class="panel script-card"><div class="panel-head"><div><h3>${esc(s.name)}</h3><small>${esc(s.when)}</small></div><button class="button small" data-copy-script="${i}">Copy</button></div><div class="panel-body"><p class="script-text">${esc(s.text)}</p></div></article>`).join('')}</div></section>
    <details class="panel playbook-section data-notes"><summary>Data notes and limits</summary><div class="panel-body"><p class="form-help">${esc(p.built)}</p><ul class="plain-list">${p.dataNotes.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div></details>`;
}
// The steps a lead walks through: teams (and anyone who bought) take the purchase path, others the display-partner path.
function stagePath(o) {
  const start = ['not_contacted', 'finding_contact', 'contacted', 'follow_up_1', 'follow_up_2', 'visit_booked', 'interested'];
  return [...start, ...(o.segment === 'team' || ['purchased', 'purchase_follow_up'].includes(o.stage) ? ['purchased', 'purchase_follow_up'] : ['agreement_signed', 'display_installed', 'live'])];
}
// The closing process as one row of equal buttons: done steps are checked, the current step is filled, the likely next step is outlined.
const STEP_LABELS = { contacted: 'Contacted', follow_up_1: 'Followed up', follow_up_2: 'Followed up again', visit_booked: 'Visit / call booked', interested: 'Interested', purchased: 'Purchased', purchase_follow_up: 'Followed up after purchase', agreement_signed: 'Agreement signed', display_installed: 'Display installed', live: 'Live', paused: 'Pause', not_a_fit: 'Not a fit' };
function stageBar(o, size = '') {
  const path = stagePath(o).filter(s => !['not_contacted', 'finding_contact'].includes(s)), at = path.indexOf(o.stage), next = nextFor(o)[0];
  const step = (s, cls) => { const current = s === o.stage; return `<button class="step ${cls} ${current ? 'current' : ''} ${!current && s === next ? 'next' : ''}" ${current ? 'disabled aria-current="step"' : `data-advance="${o.id}" data-stage="${s}"`} title="${current ? `Now: ${esc(title(s))}` : `Mark as ${esc(title(s))}`}">${cls === 'done' ? '<span class="tick">✓</span>' : ''}${esc(STEP_LABELS[s])}</button>`; };
  return `<div class="stage-bar ${size} stage-${stageGroup(o.stage)}" role="group" aria-label="Pipeline stage">${path.map((s, i) => step(s, at >= 0 && i < at ? 'done' : '')).join('')}<span class="sep"></span>${step('paused', 'quiet pause')}${step('not_a_fit', 'quiet stop')}</div>`;
}
function progress(o, nextTask) {
  const off = ['paused', 'not_a_fit'].includes(o.stage);
  return `<section class="panel progress-panel stage-${stageGroup(o.stage)}"><div class="panel-head"><div><h3>Outreach progress</h3><small>Now: <b>${esc(title(o.stage))}</b>${o.lastContacted ? ` · Last contacted ${dateLabel(o.lastContacted)}` : ''}${nextTask ? ` · Next: ${esc(nextTask.title)}, due ${dateLabel(nextTask.dueDate)}` : ''}</small></div></div>
    <div class="panel-body">${off ? `<div class="notice ${o.stage === 'not_a_fit' ? 'red' : ''}">${o.stage === 'paused' ? 'Paused. Try again later, or mark it contacted when you reach out.' : 'Marked not a fit. Reset it if that changes.'}</div>` : ''}<span class="field-label">Click the step that just happened</span>${stageBar(o, 'large')}
    ${o.stage === 'live' ? '<p class="form-help">Live and producing. Check in weekly and log it below.</p>' : ''}
    <label class="stage-correct">Set the stage directly <select data-set-stage="${o.id}">${state.stages.map(s => `<option value="${s}" ${s === o.stage ? 'selected' : ''}>${esc(title(s))}</option>`).join('')}</select></label></div></section>`;
}
async function moveStage(orgId, stage) {
  try {
    const { org, task } = await api(`orgs/${orgId}/stage`, 'POST', { stage });
    await refresh(); toast(`${org.name}: ${state.flow.actions[stage]} ✓${task ? ` · Next follow-up ${dateLabel(task.dueDate)}` : ''}`);
  } catch (err) { toast(err.message); }
}
function detail() {
  const o = index.orgs.get(selected); if (!o) { selected = null; return organizations(); }
  const contacts = index.contacts.get(o.id) || [], activities = state.activities.filter(a => a.orgId === o.id).sort((a, b) => b.date.localeCompare(a.date)), tasks = state.tasks.filter(t => t.orgId === o.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const field = (label, value) => `<div><span class="field-label">${label}</span><span class="field-value">${value || '—'}</span></div>`;
  const address = [o.address, [o.city, o.region, o.postalCode].filter(Boolean).join(' '), o.country].filter(Boolean).join(', ');
  const nextTask = tasks.find(t => t.status === 'open');
  return `<button class="detail-back" data-back-orgs>← ${back ? esc(LISTS[back.listKey].title) : 'All organizations'}</button><div class="page-head"><div><div class="eyebrow">${esc([title(o.segment), o.category, o.jurisdiction || 'Jurisdiction open'].filter(Boolean).join(' / ').toUpperCase())}</div><h1>${esc(o.name)}</h1><p>${badge(o.stage)} ${tier(o.priority)} &nbsp; ${esc(place(o) || o.website || 'No location recorded')} ${o.suppressed || o.optOut ? badge('suppressed') : ''}</p></div><div class="head-actions"><button class="button ghost" data-action="edit-org">Edit details</button><button class="button primary" data-action="add-task">+ Follow-up</button></div></div>
    ${o.suppressed || o.optOut ? '<div class="notice red">This organization is opted out or suppressed. Keep it out of any future sending workflow.</div>' : ''}
    ${o.contactBasis === 'existing_customer' ? '<div class="notice">Existing customer or subscriber. Not a cold prospect: treat outreach as account follow-up.</div>' : ''}
    ${progress(o, nextTask)}
    ${o.nextStep ? `<div class="next-step"><span class="field-label">Next step</span>${esc(o.nextStep)}</div>` : ''}
    <div class="detail-grid"><div><section class="panel detail-section"><div class="panel-head"><h3>Organization record</h3><button class="button small" data-action="edit-org">Edit</button></div><div class="panel-body"><div class="fields-list">${field('Owner', esc(o.owner))}${field('Stage', badge(o.stage))}${field('Tier', o.priority ? tier(o.priority) : '')}${field('Category', esc(o.category))}${field('Phone', o.phone ? `<a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>` : '')}${field('Email', o.email ? `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>` : '')}${field('Website', o.website ? linkOrDash(o.website) : '')}${field('Social', esc(o.social))}${field('Address', esc(address))}${field('Jurisdiction', esc(o.jurisdiction))}${field('Zone', esc(o.zone))}${field('Miles from Buffalo', o.milesFromHub == null ? '' : esc(o.milesFromHub))}${field('League / chain', esc(o.leagueChain))}${field('Last contacted', o.lastContacted ? dateLabel(o.lastContacted) : '')}${field('Contact basis', esc(title(o.contactBasis)))}${field('Source URL', linkOrDash(o.sourceUrl))}${field('Research date', dateLabel(o.researchDate))}${field('Source list', esc([o.sourceDataset, o.externalId].filter(Boolean).join(' · ')))}</div>${o.notes ? `<div style="margin-top:20px"><span class="field-label">Notes</span><p style="white-space:pre-wrap;margin:6px 0 0">${esc(o.notes)}</p></div>` : ''}</div></section>
    <section class="panel detail-section"><div class="panel-head"><h3>Contacts</h3><button class="button small" data-action="add-contact">+ Contact</button></div><div class="panel-body">${contacts.length ? contacts.map(c => `<div class="task-row"><div class="task-main"><b>${esc(c.name)} ${c.suppressed || c.optOut ? badge('suppressed') : ''}</b><small>${esc(c.role || 'Role not recorded')} · ${esc(title(c.contactBasis))}</small><small>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''} ${esc(c.phone)}</small>${c.notes ? `<small class="contact-note">${esc(c.notes)}</small>` : ''}</div><button class="button small" data-edit-contact="${c.id}">Edit</button></div>`).join('') : empty('◇', 'No contacts', 'Add a verified contact with its source and contact basis. The Playbook has tips for finding the decision-maker.')}</div></section>
    <section class="panel detail-section"><div class="panel-head"><h3>Existing system references</h3><button class="button small" data-action="edit-org">Edit</button></div><div class="panel-body"><div class="notice">These are manual references. No inquiry, studio, checkout, or order system is connected in this clone.</div><div class="fields-list">${field('Team inquiry ID', esc(o.inquiryId))}${field('Internal design ID', esc(o.designId))}${field('Checkout link ID', esc(o.checkoutLinkId))}${field('Order ID', esc(o.orderId))}${field('Order amount', o.orderAmount == null ? '' : `${dollars(o.orderAmount)} ${esc(o.orderCurrency)}`)}</div></div></section></div>
    <div><section class="panel detail-section"><div class="panel-head"><h3>Next actions</h3><button class="button small" data-action="add-task">+ Add</button></div><div class="panel-body">${tasks.length ? tasks.map(t => `<div class="task-row"><div class="task-main"><b style="${t.status === 'done' ? 'text-decoration:line-through;color:#8b8b8a' : ''}">${esc(t.title)}</b><small class="${t.status === 'open' && t.dueDate < today() ? 'date-badge overdue' : ''}">${dateLabel(t.dueDate)}</small></div><button class="button small" data-task-${t.status === 'done' ? 'open' : 'done'}="${t.id}">${t.status === 'done' ? 'Reopen' : 'Done'}</button></div>`).join('') : empty('◷', 'No follow-ups', 'Schedule the next action for this organization.')}</div></section>
    <section class="panel detail-section"><div class="panel-head"><h3>Activity history</h3><button class="button small" data-action="add-activity">+ Log activity</button></div><div class="panel-body">${activities.length ? activities.map(a => `<div class="timeline-item"><b>${esc(title(a.type))}</b><small>${dateLabel(a.date)} · ${new Date(a.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</small><p>${esc(a.note)}</p></div>`).join('') : empty('↗', 'No activity', 'Updates and logged interactions appear here.')}</div></section></div></div>`;
}

function options(values, current = '') { return values.map(v => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v ? title(v) : '—')}</option>`).join(''); }
function formField(label, name, value = '', opts = {}) { const required = opts.required ? 'required' : ''; const type = opts.type || 'text'; const full = opts.full ? ' full' : ''; return `<label class="${full}">${label}${opts.options ? `<select name="${name}" ${required}>${options(opts.options, value)}</select>` : opts.textarea ? `<textarea name="${name}" ${required}>${esc(value)}</textarea>` : `<input name="${name}" type="${type}" value="${esc(value)}" ${required} ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''} ${opts.list ? `list="${opts.list}"` : ''} ${opts.step ? `step="${opts.step}"` : ''}>`}</label>`; }
function modal(titleText, content, submitText, kind) { $('#modal-content').innerHTML = `<div class="modal-head"><div><div class="eyebrow">SKATESKINS / OUTREACH</div><h2>${esc(titleText)}</h2></div><button class="close" type="button" data-close aria-label="Close">×</button></div><form id="modal-form" data-kind="${kind}">${content}<div class="form-error" role="alert"></div><div class="modal-actions"><button class="button ghost" type="button" data-close>Cancel</button><button class="button primary" type="submit">${esc(submitText)}</button></div></form>`; $('#modal').showModal(); }
function orgForm(o = {}, suggestion = false) {
  const section = text => `<div class="form-section full">${text}</div>`;
  const content = `<div class="form-grid">
    ${formField('Organization name *', 'name', o.name, { required: true })}${formField('Segment *', 'segment', o.segment || 'team', { options: state.segments, required: true })}
    ${formField('Category', 'category', o.category, { placeholder: 'e.g. Junior Team, Hockey shop', list: 'category-options' })}${formField('Tier', 'priority', o.priority || '', { options: ['', ...state.priorities] })}
    ${!suggestion ? formField('Pipeline stage', 'stage', o.stage || 'not_contacted', { options: state.stages }) : ''}${formField('Owner', 'owner', o.owner, { placeholder: 'Internal owner' })}
    ${!suggestion ? formField('Next step', 'nextStep', o.nextStep, { full: true, placeholder: 'e.g. Walk in Thursday with a wrapped skate' }) : ''}
    ${!suggestion ? formField('Last contacted', 'lastContacted', o.lastContacted, { type: 'date' }) : ''}${formField('Contact basis', 'contactBasis', o.contactBasis || 'unknown', { options: state.bases })}
    ${section('Contact & location')}
    ${formField('Phone', 'phone', o.phone)}${formField('Email', 'email', o.email, { type: 'email' })}
    ${formField('Website', 'website', o.website, { type: 'url', placeholder: 'https://…' })}${formField('Social', 'social', o.social, { placeholder: 'Facebook / Instagram' })}
    ${formField('Street address', 'address', o.address, { full: true })}
    ${formField('City', 'city', o.city)}${formField('State / province', 'region', o.region, { placeholder: 'e.g. NY, ON' })}
    ${formField('Postal code', 'postalCode', o.postalCode)}${formField('Country', 'country', o.country, { placeholder: 'USA, Canada, …' })}
    ${formField('Jurisdiction', 'jurisdiction', o.jurisdiction, { placeholder: 'e.g. US-NY, CA-ON' })}${formField('Zone', 'zone', o.zone, { list: 'zone-options' })}
    ${formField('Miles from Buffalo', 'milesFromHub', o.milesFromHub ?? '', { type: 'number', step: 'any' })}${formField('League / chain', 'leagueChain', o.leagueChain)}
    ${section('Research')}
    ${formField('Source URL *', 'sourceUrl', o.sourceUrl, { type: 'url', required: true, full: true, placeholder: 'https://…' })}${formField('Research date *', 'researchDate', o.researchDate || today(), { type: 'date', required: true })}
    ${suggestion ? formField('Evidence summary *', 'evidence', o.evidence, { textarea: true, full: true, required: true, placeholder: 'What the cited source actually supports' }) : formField('Notes', 'notes', o.notes, { textarea: true, full: true })}
    <div class="checks"><label><input name="optOut" type="checkbox" ${o.optOut ? 'checked' : ''}> Opted out</label><label><input name="suppressed" type="checkbox" ${o.suppressed ? 'checked' : ''}> Suppressed</label></div>
    ${suggestion ? '' : `${section('External references are manual until those systems are integrated.')}${formField('Team inquiry ID', 'inquiryId', o.inquiryId)}${formField('Internal design ID', 'designId', o.designId)}${formField('Checkout link ID', 'checkoutLinkId', o.checkoutLinkId)}${formField('Order ID', 'orderId', o.orderId)}${formField('Order amount (USD)', 'orderAmount', o.orderAmount ?? '', { type: 'number', placeholder: '0' })}`}
  </div><datalist id="category-options">${index.options.category.map(v => `<option value="${esc(v)}">`).join('')}</datalist><datalist id="zone-options">${index.options.zone.map(v => `<option value="${esc(v)}">`).join('')}</datalist><p class="form-help">A source URL and research date are required. Cold prospects are separate from subscriber data.</p>`;
  modal(suggestion ? 'Add research suggestion' : o.id ? 'Edit organization' : 'Add organization', content, suggestion ? 'Queue for review' : o.id ? 'Save changes' : 'Add lead', suggestion ? 'suggestion' : o.id ? 'edit-org' : 'new-org');
}
function contactForm(c = {}) { modal(c.id ? 'Edit contact' : 'Add contact', `<div class="form-grid">${formField('Name *', 'name', c.name, { required: true })}${formField('Role', 'role', c.role)}${formField('Email', 'email', c.email, { type: 'email' })}${formField('Phone', 'phone', c.phone)}${formField('Contact basis', 'contactBasis', c.contactBasis || 'unknown', { options: state.bases })}${formField('Source URL', 'sourceUrl', c.sourceUrl, { type: 'url' })}${formField('Notes', 'notes', c.notes, { textarea: true, full: true })}<div class="checks"><label><input name="optOut" type="checkbox" ${c.optOut ? 'checked' : ''}> Opted out</label><label><input name="suppressed" type="checkbox" ${c.suppressed ? 'checked' : ''}> Suppressed</label></div></div>`, c.id ? 'Save contact' : 'Add contact', c.id ? `edit-contact:${c.id}` : 'contact'); }
function taskForm() { modal('Schedule follow-up', `<div class="form-grid">${formField('Action *', 'title', '', { required: true, full: true, placeholder: 'e.g. Follow up on quote' })}${formField('Due date *', 'dueDate', today(), { type: 'date', required: true })}</div>`, 'Schedule action', 'task'); }
function activityForm() { modal('Log activity', `<div class="form-grid">${formField('Type', 'type', 'note', { options: ['note', 'outreach', 'reply', 'quote', 'order', 'call', 'meeting'] })}${formField('What happened? *', 'note', '', { textarea: true, full: true, required: true })}</div><p class="form-help">Logging an activity does not send a message.</p>`, 'Log activity', 'activity'); }
const CSV_COLUMNS = 'name,segment,source_url,research_date,category,priority,stage,owner,website,phone,email,social,address,city,region,postal_code,country,jurisdiction,zone,miles_from_hub,league_chain,contact_basis,next_step,last_contacted,notes,opt_out,suppressed,external_id,contact_name,contact_role,contact_email,contact_phone,contact_source_url,contact_opt_out,contact_suppressed,inquiry_id,design_id,checkout_link_id,order_id,order_amount';
function importLeadsForm() { modal('Import lead files', `<p class="form-help">Choose the SkateSkins lead spreadsheets: the prospect list (All Leads CSV or Prospect List workbook), the Outreach Plan & Rink List workbook, and the Klaviyo WNY teams export. Select them all at once. Nothing is saved until you confirm the preview.</p><label class="full-label">Lead files<input name="files" type="file" accept=".csv,.xlsx" multiple required></label><div class="import-preview"></div><p class="form-help">Safe to repeat: records imported before are skipped, and edits made in the app are never overwritten.</p>`, 'Preview import', 'import-leads'); }
async function base64(file) { const bytes = new Uint8Array(await file.arrayBuffer()); let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); }
function importForm() { modal('Import organizations', `<p class="form-help">CSV columns required: <b>name, segment, source_url, research_date</b>. Segment is one of team, rink, pro_shop, wholesale. Optional columns: ${CSV_COLUMNS.split(',').slice(4).join(', ')}.</p><label class="full-label">Choose CSV file<input name="file" type="file" accept=".csv,text/csv" required></label><p class="form-help">Duplicates are skipped by organization name, city and state/province. Import never subscribes or emails contacts. For the full prospect, venue and Klaviyo spreadsheets, use <code>npm run import</code> (see README).</p><button class="table-link" type="button" data-template>Download blank template</button>`, 'Import CSV', 'import'); }
function reviewForm(s, action) { if (action === 'approve') { orgForm(s); $('#modal-form').dataset.kind = `approve:${s.id}`; $('#modal-content h2').textContent = 'Approve research suggestion'; $('#modal-form button[type=submit]').textContent = 'Approve as lead'; } else modal('Reject suggestion', `<p>Reject <b>${esc(s.name)}</b>? The suggestion remains in review history.</p>${formField('Review note', 'note', '', { textarea: true })}`, 'Reject suggestion', `reject:${s.id}`); }

document.addEventListener('click', async e => {
  const act = e.target.closest('[data-advance]'); if (act) { act.disabled = true; await moveStage(act.dataset.advance, act.dataset.stage); return; }
  const chip = e.target.closest('[data-stage-chip]'); if (chip) { filter.stage = filter.stage === chip.dataset.stageChip ? '' : chip.dataset.stageChip; limit = PAGE; render(); return; }
  const nav = e.target.closest('[data-view]'); if (nav) { view = nav.dataset.view; selected = null; back = null; if (nav.dataset.list) { listKey = nav.dataset.list; listTab = ''; filter = { ...blankFilter(), sort: 'priority' }; limit = PAGE; } render(); window.scrollTo(0, 0); return; }
  const tabButton = e.target.closest('[data-list-tab]'); if (tabButton) { listTab = tabButton.dataset.listTab; limit = PAGE; render(); return; }
  const open = e.target.closest('[data-open-org]'); if (open) { back = view === 'list' ? { listKey, listTab } : null; selected = open.dataset.openOrg; view = 'organizations'; render(); window.scrollTo(0, 0); return; }
  if (e.target.closest('[data-back-orgs]')) { selected = null; if (back) { view = 'list'; ({ listKey, listTab } = back); back = null; } render(); return; }
  const jump = e.target.closest('[data-stage-jump]'); if (jump) { filter.stage = jump.dataset.stageJump; filter.sort = 'priority'; limit = PAGE; selected = null; view = 'organizations'; render(); return; }
  const preset = e.target.closest('[data-set-filter]'); if (preset) { filter = { ...blankFilter(), [preset.dataset.setFilter]: preset.dataset.value, sort: 'priority' }; limit = PAGE; selected = null; view = 'organizations'; render(); return; }
  if (e.target.closest('[data-preset="tier-a"]')) { filter = { ...blankFilter(), priority: 'A', stage: 'not_contacted', sort: 'miles' }; limit = PAGE; selected = null; view = 'organizations'; render(); return; }
  if (e.target.closest('[data-more]')) { limit += PAGE; render(); return; }
  if (e.target.closest('[data-clear-filters]')) { filter = blankFilter(); limit = PAGE; render(); return; }
  const copy = e.target.closest('[data-copy-script]'); if (copy) { try { await navigator.clipboard.writeText(playbook.scripts[copy.dataset.copyScript].text); toast('Script copied'); } catch { toast('Copy failed. Select the text instead.'); } return; }
  if (e.target.closest('[data-close]')) { $('#modal').close(); return; }
  if (e.target.closest('[data-template]')) { const csv = `${CSV_COLUMNS}\n`; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'outreach-import-template.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return; }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'sign-out') { try { await api('logout', 'POST', {}); state = null; $('#content').innerHTML = ''; await start(); } catch (err) { toast(err.message); } return; }
  if (action === 'new-org') orgForm(); if (action === 'edit-org') orgForm(state.orgs.find(o => o.id === selected)); if (action === 'add-contact') contactForm(); if (action === 'add-task') taskForm(); if (action === 'add-activity') activityForm(); if (action === 'import') importForm(); if (action === 'import-leads') importLeadsForm(); if (action === 'new-suggestion') orgForm({}, true);
  const editContact = e.target.closest('[data-edit-contact]'); if (editContact) contactForm(state.contacts.find(c => c.id === editContact.dataset.editContact));
  const review = e.target.closest('[data-review]'); if (review) reviewForm(state.suggestions.find(s => s.id === review.dataset.id), review.dataset.review);
  const done = e.target.closest('[data-task-done]'), reopen = e.target.closest('[data-task-open]'); if (done || reopen) { try { await api(`tasks/${(done || reopen).dataset[done ? 'taskDone' : 'taskOpen']}`, 'PATCH', { status: done ? 'done' : 'open' }); await refresh(); toast('Follow-up updated'); } catch (err) { toast(err.message); } }
});
document.addEventListener('input', e => { if (e.target.id === 'search') { filter.search = e.target.value; limit = PAGE; const position = e.target.selectionStart; render(); const input = $('#search'); input.focus(); input.setSelectionRange(position, position); } });
document.addEventListener('change', e => {
  if (e.target.dataset.setStage) { moveStage(e.target.dataset.setStage, e.target.value); return; }
  if (e.target.name === 'files' && e.target.form?.dataset.kind?.startsWith('import-leads')) { const form = e.target.form, button = form.querySelector('button[type=submit]'); form.dataset.kind = 'import-leads'; form.querySelector('.import-preview').innerHTML = ''; button.disabled = false; button.textContent = 'Preview import'; return; } const map = { 'segment-filter': 'segment', 'category-filter': 'category', 'stage-filter': 'stage', 'priority-filter': 'priority', 'zone-filter': 'zone', 'country-filter': 'country', 'owner-filter': 'owner', 'suppression-filter': 'suppression', 'reach-filter': 'reach', 'sort-filter': 'sort' }; if (map[e.target.id]) { filter[map[e.target.id]] = e.target.value; limit = PAGE; render(); } });
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) $('#modal').close(); });
$('#modal').addEventListener('submit', async e => {
  if (e.target.id !== 'modal-form') return; e.preventDefault();
  const form = e.target, kind = form.dataset.kind, values = Object.fromEntries(new FormData(form));
  values.optOut = form.elements.optOut?.checked || false; values.suppressed = form.elements.suppressed?.checked || false;
  const errEl = form.querySelector('.form-error'); errEl.textContent = '';
  try {
    if (kind === 'new-org') await api('orgs', 'POST', values);
    else if (kind === 'edit-org') await api(`orgs/${selected}`, 'PATCH', values);
    else if (kind === 'suggestion') await api('suggestions', 'POST', values);
    else if (kind.startsWith('approve:')) await api(`suggestions/${kind.split(':')[1]}`, 'PATCH', { action: 'approve', edits: values });
    else if (kind.startsWith('reject:')) await api(`suggestions/${kind.split(':')[1]}`, 'PATCH', { action: 'reject', note: values.note });
    else if (kind === 'contact') await api('contacts', 'POST', { ...values, orgId: selected });
    else if (kind.startsWith('edit-contact:')) await api(`contacts/${kind.split(':')[1]}`, 'PATCH', values);
    else if (kind === 'task') await api('tasks', 'POST', { ...values, orgId: selected });
    else if (kind === 'activity') await api('activities', 'POST', { ...values, orgId: selected });
    else if (kind.startsWith('import-leads')) {
      const button = form.querySelector('button[type=submit]'), write = kind === 'import-leads-write';
      button.disabled = true; button.textContent = write ? 'Importing… this can take a minute' : 'Reading files…';
      let result;
      try { result = await api('import-leads', 'POST', { files: await Promise.all([...form.elements.files.files].map(async f => ({ name: f.name, data: await base64(f) }))), write }); }
      catch (err) { button.disabled = false; button.textContent = write ? `Import` : 'Preview import'; throw err; }
      if (!result.written) {
        form.querySelector('.import-preview').innerHTML = `<b>Files recognized</b><ul class="plain-list">${result.used.map(u => `<li>${esc(u)}</li>`).join('')}</ul><pre>${esc(result.summary.join('\n'))}</pre>`;
        const any = result.orgs || result.contacts || result.updates; form.dataset.kind = any ? 'import-leads-write' : 'import-leads';
        button.disabled = !any; button.textContent = !any ? 'Nothing new to import' : result.orgs || result.contacts ? `Import ${result.orgs.toLocaleString()} organizations and ${result.contacts.toLocaleString()} contacts` : `Fill in ${result.updates.toLocaleString()} organizations`;
        return;
      }
      toast(`Imported ${result.orgs.toLocaleString()} organizations and ${result.contacts.toLocaleString()} contacts${result.updates ? `, filled in ${result.updates.toLocaleString()}` : ''}`);
    }
    else if (kind === 'import') {
      const file = form.elements.file.files[0]; if (!file) throw new Error('Choose a CSV file');
      const result = await api('import', 'POST', { csv: await file.text() });
      toast(`${result.added} added · ${result.skipped.length} duplicates · ${result.errors.length} errors`);
      if (result.errors.length || result.skipped.length) alert(`Import results\n\n${[...result.skipped, ...result.errors].map(r => `Row ${r.row}: ${r.reason}`).join('\n')}`);
    }
    $('#modal').close(); await refresh(); if (!kind.startsWith('import')) toast('Saved');
  } catch (err) { errEl.textContent = err.message; }
});
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); const form = e.target, errEl = form.querySelector('.form-error'), button = form.querySelector('button'); errEl.textContent = ''; button.disabled = true;
  try { await api('login', 'POST', Object.fromEntries(new FormData(form))); form.reset(); await start(); } catch (err) { errEl.textContent = err.message; } finally { button.disabled = false; }
});
try { await start(); } catch (err) { toast(err.message); }

