-- Migration 003: adds the "Purchased" and "Followed up after purchase" pipeline stages.
-- Run after 002_lead_import.sql. Paste into the Supabase SQL Editor and run. Safe to re-run.
alter table public.outreach_organizations drop constraint if exists outreach_organizations_stage_check;
alter table public.outreach_organizations add constraint outreach_organizations_stage_check check (stage in ('not_contacted','finding_contact','contacted','follow_up_1','follow_up_2','visit_booked','interested','purchased','purchase_follow_up','agreement_signed','display_installed','live','paused','not_a_fit'));
notify pgrst, 'reload schema';
