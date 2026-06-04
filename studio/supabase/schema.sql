-- Burnfolder Studio v0 — run in Supabase SQL editor

create table if not exists public.entry_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date_key text not null,
  blocks jsonb not null default '[]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date_key)
);

create index if not exists entry_drafts_user_updated_idx
  on public.entry_drafts (user_id, updated_at desc);

create or replace function public.set_entry_drafts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists entry_drafts_updated_at on public.entry_drafts;
create trigger entry_drafts_updated_at
  before update on public.entry_drafts
  for each row execute function public.set_entry_drafts_updated_at();

alter table public.entry_drafts enable row level security;

drop policy if exists "entry_drafts_select_own" on public.entry_drafts;
create policy "entry_drafts_select_own"
  on public.entry_drafts for select
  using (auth.uid() = user_id);

drop policy if exists "entry_drafts_insert_own" on public.entry_drafts;
create policy "entry_drafts_insert_own"
  on public.entry_drafts for insert
  with check (auth.uid() = user_id);

drop policy if exists "entry_drafts_update_own" on public.entry_drafts;
create policy "entry_drafts_update_own"
  on public.entry_drafts for update
  using (auth.uid() = user_id);

drop policy if exists "entry_drafts_delete_own" on public.entry_drafts;
create policy "entry_drafts_delete_own"
  on public.entry_drafts for delete
  using (auth.uid() = user_id);
