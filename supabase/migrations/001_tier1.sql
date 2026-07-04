-- Tier 1: workspaces, members, invites
-- Run in Supabase → SQL Editor after creating your project.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'collaborator', 'guest')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role text not null check (role in ('collaborator', 'guest')),
  token text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workspace_invites_token_idx
  on public.workspace_invites (token);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

-- Members can read their workspaces
drop policy if exists "workspace_members_select" on public.workspace_members;
create policy "workspace_members_select"
  on public.workspace_members for select
  using (auth.uid() = user_id);

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
  on public.workspaces for select
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspaces.id and m.user_id = auth.uid()
    )
  );

-- Invites visible to workspace owners
drop policy if exists "workspace_invites_select_owner" on public.workspace_invites;
create policy "workspace_invites_select_owner"
  on public.workspace_invites for select
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspace_invites.workspace_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

-- Service role (Netlify functions) bypasses RLS for admin ops.
