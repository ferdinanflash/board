-- Hero Power Sheets: run once in the same Supabase project.
create table if not exists public.hero_power_sheets (
  id bigint generated always as identity primary key,
  name text not null,
  sheet_date date,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.hero_power_entries (
  id bigint generated always as identity primary key,
  sheet_id bigint not null references public.hero_power_sheets(id) on delete cascade,
  name text not null,
  alliance text,
  hero_power bigint not null default 0 check (hero_power >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists hero_power_entries_sheet_order_idx
  on public.hero_power_entries(sheet_id, sort_order);

alter table public.hero_power_sheets enable row level security;
alter table public.hero_power_entries enable row level security;

drop policy if exists hero_power_sheets_public_read on public.hero_power_sheets;
create policy hero_power_sheets_public_read on public.hero_power_sheets
  for select to anon, authenticated using (true);
drop policy if exists hero_power_sheets_staff_insert on public.hero_power_sheets;
create policy hero_power_sheets_staff_insert on public.hero_power_sheets
  for insert to authenticated with check (true);
drop policy if exists hero_power_sheets_staff_delete on public.hero_power_sheets;
create policy hero_power_sheets_staff_delete on public.hero_power_sheets
  for delete to authenticated using (true);

drop policy if exists hero_power_entries_public_read on public.hero_power_entries;
create policy hero_power_entries_public_read on public.hero_power_entries
  for select to anon, authenticated using (true);
drop policy if exists hero_power_entries_staff_insert on public.hero_power_entries;
create policy hero_power_entries_staff_insert on public.hero_power_entries
  for insert to authenticated with check (true);
drop policy if exists hero_power_entries_staff_update on public.hero_power_entries;
create policy hero_power_entries_staff_update on public.hero_power_entries
  for update to authenticated using (true) with check (true);
drop policy if exists hero_power_entries_staff_delete on public.hero_power_entries;
create policy hero_power_entries_staff_delete on public.hero_power_entries
  for delete to authenticated using (true);

-- Live workbook linkage: records which Supabase workbook/sheet is the source.
alter table public.hero_power_sheets add column if not exists source_workbook_id uuid references public.spreadsheet_workbooks(id) on delete set null;
alter table public.hero_power_sheets add column if not exists source_worksheet_name text;
alter table public.hero_power_entries add column if not exists source_row integer;
alter table public.hero_power_entries add column if not exists source_name_col integer;
alter table public.hero_power_entries add column if not exists source_alliance_col integer;
alter table public.hero_power_entries add column if not exists source_power_col integer;

-- ============================================================
-- STAFF-ONLY LOCK: Hero Power data is readable only by signed-in
-- alliance staff (the UI menu is hidden for guests, this enforces it
-- on the database side). Run this block once; it is safe to re-run.
-- ============================================================
drop policy if exists hero_power_sheets_public_read on public.hero_power_sheets;
drop policy if exists hero_power_sheets_staff_read on public.hero_power_sheets;
create policy hero_power_sheets_staff_read on public.hero_power_sheets
  for select to authenticated using (true);

drop policy if exists hero_power_entries_public_read on public.hero_power_entries;
drop policy if exists hero_power_entries_staff_read on public.hero_power_entries;
create policy hero_power_entries_staff_read on public.hero_power_entries
  for select to authenticated using (true);
