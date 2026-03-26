create table if not exists public.rose_notes (
  id text primary key,
  story_id text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rose_notes enable row level security;

drop policy if exists "rose notes public insert" on public.rose_notes;
create policy "rose notes public insert"
on public.rose_notes
for insert
to anon
with check (true);

drop policy if exists "rose notes public update" on public.rose_notes;
create policy "rose notes public update"
on public.rose_notes
for update
to anon
using (true)
with check (true);

drop policy if exists "rose notes public read" on public.rose_notes;
create policy "rose notes public read"
on public.rose_notes
for select
to anon
using (true);
