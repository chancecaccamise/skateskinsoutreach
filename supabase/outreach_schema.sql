-- SkateSkins Outreach schema for the dedicated outreach Supabase project.
-- Paste into the Supabase SQL Editor and run. Safe to re-run.
-- No Klaviyo/subscriber table is referenced. No send capability is granted.
-- Access is admin-only: a signed-in user sees nothing until their user id is in outreach_admins (see the end of this file).
create table if not exists public.outreach_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create or replace function public.outreach_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.outreach_admins where user_id = auth.uid());
$$;
revoke all on function public.outreach_is_admin() from public, anon;
grant execute on function public.outreach_is_admin() to authenticated;

create table if not exists public.outreach_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  segment text not null check (segment in ('team','rink','pro_shop')),
  stage text not null default 'researched' check (stage in ('researched','qualified','contacted','replied','quoted','won','lost')),
  owner text,
  website text,
  location text,
  jurisdiction text,
  source_url text not null,
  research_date date not null,
  contact_basis text not null default 'unknown' check (contact_basis in ('unknown','public_business','inquiry','referral','existing_customer','consent')),
  opt_out boolean not null default false,
  suppressed boolean not null default false,
  notes text,
  team_inquiry_ref text,
  internal_design_ref text,
  checkout_link_ref text,
  completed_order_ref text,
  recorded_order_amount numeric(12,2) check (recorded_order_amount >= 0),
  recorded_order_currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outreach_org_segment_stage_idx on public.outreach_organizations(segment,stage);
create index if not exists outreach_org_name_idx on public.outreach_organizations(lower(name));

create table if not exists public.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.outreach_organizations(id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  source_url text,
  contact_basis text not null default 'unknown' check (contact_basis in ('unknown','public_business','inquiry','referral','existing_customer','consent')),
  opt_out boolean not null default false,
  suppressed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists outreach_contact_email_unique on public.outreach_contacts(lower(email)) where email is not null and email <> '';
create index if not exists outreach_contact_org_idx on public.outreach_contacts(organization_id);

create table if not exists public.outreach_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.outreach_organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  kind text not null check (kind in ('created','updated','stage','contact','task','note','outreach','reply','quote','order','call','meeting')),
  note text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists outreach_activity_org_date_idx on public.outreach_activities(organization_id,occurred_at desc);

create table if not exists public.outreach_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.outreach_organizations(id) on delete cascade,
  title text not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outreach_task_due_idx on public.outreach_tasks(status,due_date);

-- payload holds the remaining proposed organization fields (owner, website, notes, references, ...).
create table if not exists public.outreach_research_suggestions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  segment text not null check (segment in ('team','rink','pro_shop')),
  source_url text not null,
  research_date date not null,
  evidence text not null,
  jurisdiction text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  organization_id uuid references public.outreach_organizations(id),
  created_at timestamptz not null default now()
);

alter table public.outreach_admins enable row level security;
alter table public.outreach_organizations enable row level security;
alter table public.outreach_contacts enable row level security;
alter table public.outreach_activities enable row level security;
alter table public.outreach_tasks enable row level security;
alter table public.outreach_research_suggestions enable row level security;

-- The app never deletes rows, so no delete privilege is granted. Anonymous visitors get nothing.
revoke all on public.outreach_admins, public.outreach_organizations, public.outreach_contacts, public.outreach_activities, public.outreach_tasks, public.outreach_research_suggestions from anon, authenticated;
grant select, insert, update on public.outreach_organizations, public.outreach_contacts, public.outreach_activities, public.outreach_tasks, public.outreach_research_suggestions to authenticated;

-- Intentionally no policy for outreach_admins. Membership is checked by the definer function.
drop policy if exists outreach_org_admin on public.outreach_organizations;
drop policy if exists outreach_contact_admin on public.outreach_contacts;
drop policy if exists outreach_activity_admin on public.outreach_activities;
drop policy if exists outreach_task_admin on public.outreach_tasks;
drop policy if exists outreach_suggestion_admin on public.outreach_research_suggestions;
create policy outreach_org_admin on public.outreach_organizations for all to authenticated using (public.outreach_is_admin()) with check (public.outreach_is_admin());
create policy outreach_contact_admin on public.outreach_contacts for all to authenticated using (public.outreach_is_admin()) with check (public.outreach_is_admin());
create policy outreach_activity_admin on public.outreach_activities for all to authenticated using (public.outreach_is_admin()) with check (public.outreach_is_admin());
create policy outreach_task_admin on public.outreach_tasks for all to authenticated using (public.outreach_is_admin()) with check (public.outreach_is_admin());
create policy outreach_suggestion_admin on public.outreach_research_suggestions for all to authenticated using (public.outreach_is_admin()) with check (public.outreach_is_admin());

-- Grant admin access after creating the user under Authentication → Users (run once per admin):
-- insert into public.outreach_admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;
