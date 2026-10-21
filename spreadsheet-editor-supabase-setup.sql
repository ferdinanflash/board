-- Spreadsheet Editor: shared workbook storage in Supabase. Run once in SQL Editor.
create table if not exists public.spreadsheet_workbooks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  workbook jsonb not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spreadsheet_workbooks_updated_at_idx
  on public.spreadsheet_workbooks (updated_at desc);

alter table public.spreadsheet_workbooks enable row level security;

drop policy if exists spreadsheet_workbooks_staff_read on public.spreadsheet_workbooks;
create policy spreadsheet_workbooks_staff_read on public.spreadsheet_workbooks
  for select to authenticated using (true);

drop policy if exists spreadsheet_workbooks_staff_insert on public.spreadsheet_workbooks;
create policy spreadsheet_workbooks_staff_insert on public.spreadsheet_workbooks
  for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists spreadsheet_workbooks_staff_update on public.spreadsheet_workbooks;
create policy spreadsheet_workbooks_staff_update on public.spreadsheet_workbooks
  for update to authenticated using (true) with check (true);

drop policy if exists spreadsheet_workbooks_staff_delete on public.spreadsheet_workbooks;
create policy spreadsheet_workbooks_staff_delete on public.spreadsheet_workbooks
  for delete to authenticated using (true);
