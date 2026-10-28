# SkateSkins Outreach

An Outreach workspace that runs on this computer and stores records either in a local JSON file or in the dedicated SkateSkins Outreach Supabase project. The clone contained no application files, admin routes, Supabase schema, RLS policies, inquiry form, studio, checkout links, orders, or pricing code when work began. Nothing here changes commercial pricing or connects to the store's production systems.

## Run

Requires Node.js 22 or newer. There are no npm dependencies.

```sh
npm start
```

For auto-restart on server changes, use `npm run dev` instead.

Open `http://127.0.0.1:4173`. The server binds only to loopback, so it is reachable only from this computer.

- **Local mode** (no `.env`): no sign-in. Records are stored in `.local/outreach.json` (Git ignored). Back up `.local/` if the data matters.
- **Supabase mode** (`.env` present): email + password sign-in, records stored in Supabase. See below.

## What works

- Organizations in team, rink, pro shop, and wholesale & chains segments, with a free-text category (e.g. Junior Team, Hockey shop), tier A–E, zone, and miles from Buffalo.
- The Deal Steps pipeline from the Outreach Plan workbook: Not contacted → Finding contact → Contacted → Follow-up 1 → Follow-up 2 → Visit / call booked → Interested, then either Purchased → Followed up after purchase (teams and direct orders) or Agreement signed → Display installed → Live – producing (display partners), plus Paused and Not a fit.
- One-click outreach buttons on every list row, pipeline card, follow-up, and record (Contacted, Followed up, Interested, Purchased, Followed up after purchase, …). A click moves the stage, sets last contacted for touches, logs it, closes the previous automatic reminder, and schedules the next one using the Deal Steps timing (3 days, then 1 week, 60 days after a pause). Manual follow-ups are left alone. Each record shows its progress as a step tracker.
- Contacts, owner, next step, last contacted, notes, dated follow-ups, activity history, search, and filters by segment, category, stage, tier, zone, country, owner, and compliance. Lists show 100 at a time; the pipeline board shows each stage's top 20 by tier, then distance.
- Overview counters for contacted, replies, overdue follow-ups, partners signed, live partners, manually recorded order references, and manually recorded USD attributed revenue. Order references and amounts are **unverified** until an order system is integrated.
- Lead list pages, one per source list: Prospect list (tabbed like its workbook: NHL & AHL, Minor Pro & Junior, College, Chains & Buyers, US Shops, Canada Shops), Venues – North America and Venues – Europe (tabbed by target zone), and Klaviyo customers. Each shows its counts and has the same search and filters.
- Playbook page: plan of attack, tiers, target areas with live counts, deal steps, contact playbook, and copyable scripts, from the reference tabs of the Outreach Plan workbook (`lib/playbook.json`).
- Manual lead entry and CSV import with duplicate detection by name, city, and state/province. Required columns: `name,segment,source_url,research_date`. Download a blank template from the import dialog. Invalid rows and duplicates are reported. Data never goes to Klaviyo.
- Source URL, research date, jurisdiction, contact basis, opt-out, and suppression fields. These are captured for future compliance controls. No outreach sending exists.
- Evidence-backed research suggestion queue. A human approves or rejects each suggestion. No AI source or mailbox provider is connected, and no suggestions are generated automatically.
- Manual reference fields for team inquiries, internal designs, checkout links, and orders. They are placeholders for future links because those systems are absent from this clone.

## Supabase setup

The Supabase project is dedicated to Outreach, so the inquiry/design/checkout/order fields stay manual text references rather than foreign keys.

1. **Schema**: in the Supabase dashboard, open SQL Editor and run, in order, `supabase/outreach_schema.sql`, `supabase/002_lead_import.sql`, `supabase/003_purchase_stages.sql`, and `supabase/004_team_access.sql`. All are safe to re-run.
2. **Admin user**: under Authentication → Users, choose *Add user → Create new user*, enter an email and password, and tick *Auto Confirm User*. Then run in the SQL Editor:
   ```sql
   insert into public.outreach_admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;
   ```
   Signed-in users who are not in `outreach_admins` are refused at sign-in, and RLS hides all outreach rows from them.

   After the first admin exists, teammates use **Create an account** on the sign-in screen. New accounts see nothing until an admin approves them on **Team access** (which also removes access). If Supabase's *Confirm email* setting is on (Authentication → Sign In / Providers → Email), they confirm their email first. Set Authentication → URL Configuration → Site URL to `http://127.0.0.1:4173` so the confirmation link lands on the app.
3. **Keys**: copy `.env.example` to `.env` and fill in `SUPABASE_URL` and the **publishable** key (the legacy name is "anon"). Never use the secret/`service_role` key. The app does not need it, and `.env` is Git ignored.
4. Restart `npm start`. The console says which mode it is in.

How it works: the browser only talks to the local server. The server signs in through Supabase Auth, keeps the session in HttpOnly cookies, and calls the Supabase REST API with the signed-in user's token, so RLS enforces admin-only access. API requests are handled one at a time, and only changed rows are written back. The server caches records for up to 2 minutes, so changes made elsewhere (another admin, the import script) appear within that time or on restart. Two people editing the same record within that window: the later save wins. The app never deletes rows. Existing `.local/` data is not migrated automatically.

## Importing the lead spreadsheets

The easiest way: sign in to the app, open **Organizations → Import lead files**, select the files below, check the preview, and confirm. It uses your signed-in session. The same import is also available from the terminal as `npm run import`, which loads the files from one folder:

| File | What is imported |
|---|---|
| `SkateSkins Prospect List - All Leads.csv` (or the `.xlsx`) | About 1,930 organizations with their named contacts. Rows are one per contact and are grouped by organization, city, and state. Chain store locations stay separate. |
| `SkateSkins Outreach Plan & Rink List.xlsx`, `Venues – …` tabs | About 3,800 rinks, arenas, and shops from OpenStreetMap, with tier, zone, and miles from Buffalo. Venues the workbook marks as already in the prospect list are merged into that record when the name and city match. Arenas a team plays at are cross-referenced in notes instead. The `Existing Leads` tab is the same data as the prospect list and is not imported twice. |
| `WNY-teams-from-klaviyo-….csv` | Existing customers or subscribers, flagged with contact basis *Existing customer* and category *Existing customer (Klaviyo)*, so they are never mixed up with cold prospects. |

```sh
npm run import -- ~/Downloads/"Sales Leads"            # dry run: reports what would be added
npm run import -- ~/Downloads/"Sales Leads" --write    # imports into Supabase (asks for your admin email and password)
npm run import -- ~/Downloads/"Sales Leads" --local --write   # imports into .local/ instead (stop npm start first)
```

Re-running is safe: each record's id comes from its source id (`SS-0001`, `NA-00001`, Klaviyo profile), so rows imported before are skipped and edits made in the app are never overwritten. Organizations that already exist in the app with the same name and place get the new contacts attached, not a duplicate record. An email shared by several contacts is kept on the first one and noted on the others. Websites or emails that fail validation are kept in the notes.

To refresh the Playbook page after editing the workbook: `node scripts/extract-playbook.mjs "<path to SkateSkins Outreach Plan & Rink List.xlsx>"`.

For research, choose a provider and credentials only after defining acceptable source types and review rules. For mailbox integration, choose an inbox provider and OAuth scope; any proposed reply classification must retain message evidence and human review. Neither integration should send automatically. Subscriber consent should remain separate from a public-business contact basis.

## Verify

```sh
npm test
```

The tests cover CSV parsing, duplicate keys, validation, stages, metrics, the xlsx reader, the lead import mapping (grouping, chain stores, venue merges, shared emails, re-runs), the local API, and Supabase mode and the import command against an in-process fake of Supabase Auth and REST. No real Supabase project, deployment, or messages are touched.
