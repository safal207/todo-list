-- Apply ONCE to an EXISTING dedicated "Сделано" Supabase project before
-- enabling optional cloud wallet synchronization. Do not apply in an unrelated DB.
-- Existing v1 snapshots remain readable. RLS policies are left unchanged.
begin;
alter table public.sdelano_sync_v1
  drop constraint if exists sdelano_sync_v1_snapshot_check;
alter table public.sdelano_sync_v1
  add constraint sdelano_sync_v1_snapshot_check check (
    jsonb_typeof(snapshot) = 'object'
    and snapshot->>'format' = 'sdelano-task-backup'
    and snapshot->>'version' in ('1', '2')
    and (snapshot->>'version' = '1' or jsonb_typeof(snapshot->'game') = 'object')
    and jsonb_typeof(snapshot->'tasks') = 'array'
    and jsonb_array_length(snapshot->'tasks') <= 5000
    and jsonb_typeof(snapshot->'achievements') = 'object'
    and octet_length(snapshot::text) <= 2097152
  );
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
commit;
