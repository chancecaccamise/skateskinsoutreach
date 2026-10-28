-- Migration 004: self sign-up with admin approval.
-- Anyone can create an account, but it sees nothing until an outreach admin approves its access request.
-- Run after 003_purchase_stages.sql. Paste into the Supabase SQL Editor and run. Safe to re-run.

create table if not exists public.outreach_access_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id)
);
alter table public.outreach_access_requests enable row level security;
revoke all on public.outreach_access_requests from anon, authenticated;
grant select, insert on public.outreach_access_requests to authenticated;

-- A signed-in user can file and read only their own request; admins can read all. Decisions go through outreach_decide_access.
drop policy if exists outreach_request_insert_own on public.outreach_access_requests;
drop policy if exists outreach_request_select on public.outreach_access_requests;
create policy outreach_request_insert_own on public.outreach_access_requests for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
create policy outreach_request_select on public.outreach_access_requests for select to authenticated using (user_id = auth.uid() or public.outreach_is_admin());

-- Approve or decline a request (or remove a team member). Only admins; an admin cannot remove themselves.
create or replace function public.outreach_decide_access(target uuid, approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.outreach_is_admin() then raise exception 'Only outreach admins can change access' using errcode = '42501'; end if;
  if not approve and target = auth.uid() then raise exception 'You cannot remove your own access' using errcode = '22023'; end if;
  insert into public.outreach_access_requests (user_id, email, status)
    select u.id, u.email, 'pending' from auth.users u where u.id = target on conflict (user_id) do nothing;
  update public.outreach_access_requests set status = case when approve then 'approved' else 'denied' end, decided_at = now(), decided_by = auth.uid() where user_id = target;
  if approve then insert into public.outreach_admins (user_id) values (target) on conflict do nothing;
  else delete from public.outreach_admins where user_id = target; end if;
end $$;
revoke all on function public.outreach_decide_access(uuid, boolean) from public, anon;
grant execute on function public.outreach_decide_access(uuid, boolean) to authenticated;

-- Every account with its access state, for admins only: team members, pending sign-ups (even before they sign in), and declined.
drop function if exists public.outreach_team();
create or replace function public.outreach_accounts()
returns table (user_id uuid, email text, name text, created_at timestamptz, confirmed boolean, is_admin boolean, status text, decided_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, coalesce(r.name, u.raw_user_meta_data->>'name'), u.created_at, u.email_confirmed_at is not null,
    exists (select 1 from public.outreach_admins a where a.user_id = u.id), coalesce(r.status, 'pending'), r.decided_at
  from auth.users u left join public.outreach_access_requests r on r.user_id = u.id
  where public.outreach_is_admin() order by u.created_at desc;
$$;
revoke all on function public.outreach_accounts() from public, anon;
grant execute on function public.outreach_accounts() to authenticated;

notify pgrst, 'reload schema';
