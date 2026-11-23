-- Separate Supabase project for "Сделано" only. Run once in the SQL editor.
-- Never install this in the unrelated Zenit Alanya database.
create table if not exists public.sdelano_sync_v1 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and snapshot->>'format' = 'sdelano-task-backup'
    and snapshot->>'version' in ('1', '2')
    and (snapshot->>'version' = '1' or jsonb_typeof(snapshot->'game') = 'object')
    and jsonb_typeof(snapshot->'tasks') = 'array'
    and jsonb_array_length(snapshot->'tasks') <= 5000
    and jsonb_typeof(snapshot->'achievements') = 'object'
    and octet_length(snapshot::text) <= 2097152
  ),
  updated_at timestamptz not null default now()
);
alter table public.sdelano_sync_v1 enable row level security;
revoke all on public.sdelano_sync_v1 from public, anon;
grant select, insert, update, delete on public.sdelano_sync_v1 to authenticated;

create policy "read own snapshot" on public.sdelano_sync_v1
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "insert own snapshot" on public.sdelano_sync_v1
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "update own snapshot" on public.sdelano_sync_v1
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "delete own snapshot" on public.sdelano_sync_v1
  for delete to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.sdelano_sync_v1 is
  'Private versioned JSON snapshot of tasks; one owner per row. RLS required.';

-- A legacy client must never downgrade a wallet snapshot to tasks-only v1.
create or replace function public.sdelano_prevent_snapshot_downgrade()
returns trigger language plpgsql as $$
begin
  if old.snapshot->>'version' = '2' and new.snapshot->>'version' <> '2' then
    raise exception 'Cannot downgrade a wallet backup from v2 to v1';
  end if;
  return new;
end;
$$;
drop trigger if exists sdelano_snapshot_no_downgrade on public.sdelano_sync_v1;
create trigger sdelano_snapshot_no_downgrade
  before update on public.sdelano_sync_v1
  for each row execute function public.sdelano_prevent_snapshot_downgrade();
