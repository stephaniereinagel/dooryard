-- Homestead Ops — Supabase schema
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

-- ============================================================
-- EXTENSIONS
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- CORE TABLES
-- ============================================================

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Homestead',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  display_name text,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.whiteboard_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  text text not null,
  pinned boolean not null default false,
  done boolean not null default false,
  rank integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.backlog_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category text not null check (category in ('maintenance','project')),
  zone text,
  title text not null,
  notes text,
  status text not null default 'open' check (status in ('open','in_progress','done')),
  rank integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shift_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  assistant_user_id uuid references auth.users(id) on delete set null,
  assistant_name text,
  shift_date date not null default (now()::date),
  shift_day text,
  hours_start time,
  hours_end time,
  weather text,
  egg_count_chicken integer,
  egg_count_duck integer,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whiteboard_items_workspace_idx on public.whiteboard_items(workspace_id);
create index if not exists backlog_items_workspace_idx on public.backlog_items(workspace_id);
create index if not exists shift_logs_workspace_date_idx on public.shift_logs(workspace_id, shift_date desc);

-- ============================================================
-- updated_at TRIGGERS
-- ============================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workspaces_touch_updated_at on public.workspaces;
create trigger workspaces_touch_updated_at
before update on public.workspaces
for each row execute function public.touch_updated_at();

drop trigger if exists whiteboard_items_touch_updated_at on public.whiteboard_items;
create trigger whiteboard_items_touch_updated_at
before update on public.whiteboard_items
for each row execute function public.touch_updated_at();

drop trigger if exists backlog_items_touch_updated_at on public.backlog_items;
create trigger backlog_items_touch_updated_at
before update on public.backlog_items
for each row execute function public.touch_updated_at();

drop trigger if exists shift_logs_touch_updated_at on public.shift_logs;
create trigger shift_logs_touch_updated_at
before update on public.shift_logs
for each row execute function public.touch_updated_at();

-- ============================================================
-- MEMBERSHIP HELPER (security definer to avoid RLS recursion)
-- ============================================================

create or replace function public.is_workspace_member(w_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.workspaces w
      where w.id = w_id and w.owner_user_id = auth.uid()
    )
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = w_id and wm.user_id = auth.uid()
    );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;

-- ============================================================
-- BOOTSTRAP RPC (SECURITY DEFINER)
-- Atomically creates a workspace + admin membership for the current user.
-- Routes around per-row RLS INSERT policies for the bootstrap flow; policies
-- still protect all subsequent reads/writes.
-- ============================================================

create or replace function public.bootstrap_workspace(p_name text default 'Homestead')
returns table (id uuid, name text, owner_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_workspace public.workspaces%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated (auth.uid() is null). Sign in first.';
  end if;

  -- Reuse existing owned workspace if present
  select * into v_workspace
  from public.workspaces w
  where w.owner_user_id = v_user_id
  order by w.created_at asc
  limit 1;

  if not found then
    insert into public.workspaces (owner_user_id, name)
    values (v_user_id, coalesce(nullif(p_name, ''), 'Homestead'))
    returning * into v_workspace;
  end if;

  select u.email into v_email from auth.users u where u.id = v_user_id;

  insert into public.workspace_members (workspace_id, user_id, role, display_name)
  values (v_workspace.id, v_user_id, 'admin', v_email)
  on conflict (workspace_id, user_id) do nothing;

  id := v_workspace.id;
  name := v_workspace.name;
  owner_user_id := v_workspace.owner_user_id;
  return next;
end;
$$;

revoke all on function public.bootstrap_workspace(text) from public;
grant execute on function public.bootstrap_workspace(text) to authenticated;

-- Diagnostic helper — lets the app ask "what does the DB think I am right now?"
create or replace function public.whoami()
returns table (uid uuid, role text, jwt_present boolean)
language sql
stable
as $$
  select
    auth.uid() as uid,
    auth.role() as role,
    (current_setting('request.jwt.claims', true) is not null) as jwt_present;
$$;
grant execute on function public.whoami() to anon, authenticated;

-- Auto-create a workspace + admin membership when a user first creates one:
-- application code sets owner_user_id = auth.uid() and then inserts a membership.

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.whiteboard_items enable row level security;
alter table public.backlog_items enable row level security;
alter table public.shift_logs enable row level security;

-- Clean slate: drop ANY existing policies on our tables before re-creating.
-- Protects against leftover/rogue policies from prior schema iterations or the
-- Supabase dashboard UI that could silently block inserts.
do $$
declare
  r record;
begin
  for r in
    select p.polname, c.relname
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('workspaces', 'workspace_members', 'whiteboard_items', 'backlog_items', 'shift_logs')
  loop
    execute format('drop policy if exists %I on public.%I', r.polname, r.relname);
  end loop;
end $$;

-- workspaces
drop policy if exists "workspaces_select_own_or_member" on public.workspaces;
create policy "workspaces_select_own_or_member"
on public.workspaces for select
to authenticated
using (public.is_workspace_member(id));

drop policy if exists "workspaces_insert_owner" on public.workspaces;
create policy "workspaces_insert_owner"
on public.workspaces for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists "workspaces_update_owner" on public.workspaces;
create policy "workspaces_update_owner"
on public.workspaces for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner"
on public.workspaces for delete
to authenticated
using (owner_user_id = auth.uid());

-- workspace_members
drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member"
on public.workspace_members for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_members_insert_self_or_owner" on public.workspace_members;
create policy "workspace_members_insert_self_or_owner"
on public.workspace_members for insert
to authenticated
with check (
  -- owner of the workspace can add anyone
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_user_id = auth.uid()
  )
  -- OR a user adding themselves (self-bootstrap on first login)
  or (user_id = auth.uid())
);

drop policy if exists "workspace_members_delete_owner" on public.workspace_members;
create policy "workspace_members_delete_owner"
on public.workspace_members for delete
to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_user_id = auth.uid()
  )
  or user_id = auth.uid()
);

drop policy if exists "workspace_members_update_owner_or_self" on public.workspace_members;
create policy "workspace_members_update_owner_or_self"
on public.workspace_members for update
to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_user_id = auth.uid()
  )
  or user_id = auth.uid()
)
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_user_id = auth.uid()
  )
  or user_id = auth.uid()
);

-- whiteboard_items: any member can read/write
drop policy if exists "whiteboard_items_rw_member" on public.whiteboard_items;
create policy "whiteboard_items_rw_member"
on public.whiteboard_items for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

-- backlog_items
drop policy if exists "backlog_items_rw_member" on public.backlog_items;
create policy "backlog_items_rw_member"
on public.backlog_items for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

-- shift_logs
drop policy if exists "shift_logs_rw_member" on public.shift_logs;
create policy "shift_logs_rw_member"
on public.shift_logs for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

-- Force PostgREST to pick up schema/policy changes immediately.
notify pgrst, 'reload schema';

-- ============================================================
-- DIAGNOSTIC (optional): run these to inspect live policies
-- ============================================================
-- select c.relname as table, p.polname, p.polcmd,
--        pg_get_expr(p.polqual, p.polrelid) as using_expr,
--        pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
--   from pg_policy p
--   join pg_class c on c.oid = p.polrelid
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public'
--    and c.relname in ('workspaces','workspace_members','whiteboard_items','backlog_items','shift_logs')
--  order by table, polname;

-- ============================================================
-- NOTES
-- ============================================================
-- 1) Enable the Email provider in Supabase Auth.
-- 2) Under Authentication > URL Configuration, set Site URL and Redirect URLs
--    to your deployed URL (Netlify) and your localhost dev URL.
-- 3) App flow on first login:
--    a. Insert workspace { owner_user_id = auth.uid() } -> capture id
--    b. Insert workspace_members { workspace_id, user_id = auth.uid(), role='admin' }
-- 4) To invite another user (assistant, spouse) after they've created their own
--    Supabase account, the workspace owner adds a row to workspace_members via
--    the app's Settings screen or directly in the Supabase table editor:
--    insert into workspace_members (workspace_id, user_id, role, display_name)
--    values ('<workspace-uuid>', '<their-auth-uid>', 'member', 'Daniel');
