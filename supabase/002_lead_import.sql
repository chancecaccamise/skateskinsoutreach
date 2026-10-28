-- Migration 002: fields for the prospect, venue and Klaviyo lead files, and the Deal Steps pipeline.
-- Run after outreach_schema.sql. Paste into the Supabase SQL Editor and run. Safe to re-run.

alter table public.outreach_organizations
  add column if not exists external_id text,
  add column if not exists category text,
  add column if not exists priority text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists postal_code text,
  add column if not exists country text,
  add column if not exists zone text,
  add column if not exists miles_from_hub numeric(8,1),
  add column if not exists league_chain text,
  add column if not exists social text,
  add column if not exists next_step text,
  add column if not exists last_contacted date,
  add column if not exists source_dataset text;

-- "location" was a single free-text field; it becomes city.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'outreach_organizations' and column_name = 'location') then
    update public.outreach_organizations set city = location where city is null and location is not null;
    alter table public.outreach_organizations drop column location;
  end if;
end $$;

alter table public.outreach_contacts add column if not exists external_id text;

create unique index if not exists outreach_org_external_id_unique on public.outreach_organizations(external_id) where external_id is not null;
create unique index if not exists outreach_contact_external_id_unique on public.outreach_contacts(external_id) where external_id is not null;
create index if not exists outreach_org_priority_idx on public.outreach_organizations(priority);
create index if not exists outreach_org_zone_idx on public.outreach_organizations(zone);

-- Segments: add wholesale & chains (chain HQs, buying groups, distributors, big box, online retail).
alter table public.outreach_organizations drop constraint if exists outreach_organizations_segment_check;
alter table public.outreach_organizations add constraint outreach_organizations_segment_check check (segment in ('team','rink','pro_shop','wholesale'));
alter table public.outreach_research_suggestions drop constraint if exists outreach_research_suggestions_segment_check;
alter table public.outreach_research_suggestions add constraint outreach_research_suggestions_segment_check check (segment in ('team','rink','pro_shop','wholesale'));

alter table public.outreach_organizations drop constraint if exists outreach_organizations_priority_check;
alter table public.outreach_organizations add constraint outreach_organizations_priority_check check (priority in ('A','B','C','D','E'));

-- Stages: replace the generic CRM stages with the Deal Steps from the Outreach Plan workbook.
alter table public.outreach_organizations drop constraint if exists outreach_organizations_stage_check;
update public.outreach_organizations set stage = case stage
  when 'researched' then 'not_contacted' when 'qualified' then 'finding_contact'
  when 'replied' then 'interested' when 'quoted' then 'interested'
  when 'won' then 'agreement_signed' when 'lost' then 'not_a_fit' else stage end
where stage in ('researched','qualified','replied','quoted','won','lost');
alter table public.outreach_organizations alter column stage set default 'not_contacted';
alter table public.outreach_organizations add constraint outreach_organizations_stage_check check (stage in ('not_contacted','finding_contact','contacted','follow_up_1','follow_up_2','visit_booked','interested','agreement_signed','display_installed','live','paused','not_a_fit'));

notify pgrst, 'reload schema';
