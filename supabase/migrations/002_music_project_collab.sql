-- Tier 1b: music project collaboration (per-project, not whole workspace)
-- Run in Supabase SQL Editor after 001_tier1.sql

create table if not exists public.music_project_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('collaborator', 'guest')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, project_id, user_id)
);

create index if not exists music_project_members_user_idx
  on public.music_project_members (user_id);

create table if not exists public.music_project_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id text not null,
  email text not null,
  role text not null check (role in ('collaborator', 'guest')),
  token text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists music_project_invites_token_idx
  on public.music_project_invites (token);

alter table public.music_project_members enable row level security;
alter table public.music_project_invites enable row level security;

drop policy if exists "music_project_members_select_self" on public.music_project_members;
create policy "music_project_members_select_self"
  on public.music_project_members for select
  using (auth.uid() = user_id);

drop policy if exists "music_project_invites_select_owner" on public.music_project_invites;
create policy "music_project_invites_select_owner"
  on public.music_project_invites for select
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = music_project_invites.workspace_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

-- Service role (Netlify functions) bypasses RLS for admin ops.
