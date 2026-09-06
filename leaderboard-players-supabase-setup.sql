-- ============================================================
-- "Must on Leaderboard Player" feature — Supabase setup
-- Run this ONCE in your Supabase project's SQL Editor.
-- Uses the same project / staff auth accounts as the rest of the site.
-- ============================================================

create table if not exists public.leaderboard_players (
    id bigint generated always as identity primary key,
    tier text not null check (tier in ('top100', 'top200')),
    nickname text not null,
    game_id text not null,
    created_by text,
    created_at timestamptz not null default now()
);

create index if not exists leaderboard_players_tier_idx
    on public.leaderboard_players (tier, created_at);

alter table public.leaderboard_players enable row level security;

-- Anyone (including anonymous visitors) can view the leaderboard lists.
drop policy if exists "leaderboard_players_public_read" on public.leaderboard_players;
create policy "leaderboard_players_public_read"
    on public.leaderboard_players
    for select
    to anon, authenticated
    using (true);

-- Only signed-in staff accounts can add players.
drop policy if exists "leaderboard_players_staff_insert" on public.leaderboard_players;
create policy "leaderboard_players_staff_insert"
    on public.leaderboard_players
    for insert
    to authenticated
    with check (true);

-- Only signed-in staff accounts can remove players.
drop policy if exists "leaderboard_players_staff_delete" on public.leaderboard_players;
create policy "leaderboard_players_staff_delete"
    on public.leaderboard_players
    for delete
    to authenticated
    using (true);
