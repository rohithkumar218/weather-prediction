create table if not exists public.user_dashboard (
  user_id uuid primary key references auth.users (id) on delete cascade,
  favorites jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  selected_place jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_dashboard enable row level security;

grant select, insert, update, delete on public.user_dashboard to authenticated;

drop policy if exists "Users can read their own dashboard" on public.user_dashboard;
create policy "Users can read their own dashboard"
  on public.user_dashboard for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own dashboard" on public.user_dashboard;
create policy "Users can create their own dashboard"
  on public.user_dashboard for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own dashboard" on public.user_dashboard;
create policy "Users can update their own dashboard"
  on public.user_dashboard for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own dashboard" on public.user_dashboard;
create policy "Users can delete their own dashboard"
  on public.user_dashboard for delete
  to authenticated
  using ((select auth.uid()) = user_id);
