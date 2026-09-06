-- ============================================================
-- EVENT REPORTS FEATURE — SUPABASE SETUP
-- Run this once in your Supabase project's SQL Editor.
-- Uses the SAME project as the rest of the site (troops_power, etc).
-- ============================================================

-- 1) Table: one row per "event duration" (a run of an event with a
--    start/end date). event_name stores the fixed key used by events.js
--    (e.g. 'armament_competition', 'officer_project', 'defeat_nearby_beast',
--    'namecard_event', 'big_event').
create table if not exists public.event_instances (
    id bigint generated always as identity primary key,
    event_name text not null,
    start_date date not null,
    end_date date not null,
    created_at timestamptz not null default now(),
    created_by text
);

-- 2) Table: one row per uploaded screenshot, linked to an event_instances row.
create table if not exists public.event_screenshots (
    id bigint generated always as identity primary key,
    event_instance_id bigint not null references public.event_instances(id) on delete cascade,
    image_url text not null,
    storage_path text not null,
    uploaded_at timestamptz not null default now(),
    uploaded_by text
);

create index if not exists idx_event_instances_name on public.event_instances(event_name);
create index if not exists idx_event_screenshots_instance on public.event_screenshots(event_instance_id);

-- 3) Row Level Security: anyone can read (public leaderboard-style site),
--    only signed-in staff (any staff account) can write. This mirrors how
--    troops_power / footer_settings already work on the main site.
alter table public.event_instances enable row level security;
alter table public.event_screenshots enable row level security;

drop policy if exists "Public read event_instances" on public.event_instances;
create policy "Public read event_instances" on public.event_instances
    for select using (true);

drop policy if exists "Staff write event_instances" on public.event_instances;
create policy "Staff write event_instances" on public.event_instances
    for all to authenticated using (true) with check (true);

drop policy if exists "Public read event_screenshots" on public.event_screenshots;
create policy "Public read event_screenshots" on public.event_screenshots
    for select using (true);

drop policy if exists "Staff write event_screenshots" on public.event_screenshots;
create policy "Staff write event_screenshots" on public.event_screenshots
    for all to authenticated using (true) with check (true);

-- 4) Storage bucket for the screenshot files themselves (public read so the
--    <img> tags on the gallery page can load them directly).
insert into storage.buckets (id, name, public)
values ('event-screenshots', 'event-screenshots', true)
on conflict (id) do nothing;

drop policy if exists "Public read event screenshots" on storage.objects;
create policy "Public read event screenshots" on storage.objects
    for select using (bucket_id = 'event-screenshots');

drop policy if exists "Staff upload event screenshots" on storage.objects;
create policy "Staff upload event screenshots" on storage.objects
    for insert to authenticated with check (bucket_id = 'event-screenshots');

drop policy if exists "Staff delete event screenshots" on storage.objects;
create policy "Staff delete event screenshots" on storage.objects
    for delete to authenticated using (bucket_id = 'event-screenshots');

-- ============================================================
-- UPDATE: TRACK SCREENSHOT FILE SIZES FOR THE STORAGE QUOTA INDICATOR
-- Safe to re-run. Needed for the "Event screenshots: X MB / 1 GB used"
-- bar shown to logged-in staff on events.html.
-- ============================================================

alter table public.event_screenshots
    add column if not exists file_size_bytes bigint not null default 0;

create or replace function public.event_screenshots_storage_bytes()
returns bigint
language sql
stable
as $$
    select coalesce(sum(file_size_bytes), 0) from public.event_screenshots;
$$;

grant execute on function public.event_screenshots_storage_bytes() to anon, authenticated;
