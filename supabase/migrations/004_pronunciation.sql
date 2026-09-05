-- Apply after 003_vocabulary_deletion.sql. Adds protocol 4 and the
-- account-scoped automatic-pronunciation preference cell.

-- Older RPC regression paths may receive a current client snapshot containing
-- the new cell. Strip the unknown cell before the original projector validates
-- its key; protocol 4 persists it below.
alter function public.kelime_apply_legacy(jsonb) rename to kelime_apply_legacy_internal;
revoke all on function public.kelime_apply_legacy_internal(jsonb) from public, anon, authenticated;
create function public.kelime_apply_legacy(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare filtered jsonb;
begin
  select coalesce(jsonb_agg(change), '[]'::jsonb) into filtered
  from jsonb_array_elements(p_operation->'changes') change
  where change->>'key' <> 'setting/auto-pronunciation';
  return public.kelime_apply_legacy_internal(jsonb_set(p_operation, '{changes}', filtered));
end $$;

alter function public.kelime_apply_v3(jsonb) rename to kelime_apply_v3_internal;
revoke all on function public.kelime_apply_v3_internal(jsonb) from public, anon, authenticated;

create function public.kelime_apply_v3(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if exists(select 1 from public.profiles where id = auth.uid() and sync_protocol >= 4) then
    raise exception 'Update Kelime before syncing. Older queued changes are preserved for migration.';
  end if;
  return public.kelime_apply_v3_internal(p_operation);
end $$;

create function public.kelime_snapshot_v4() returns jsonb
language sql security definer set search_path = '' as $$
  select public.kelime_snapshot()
$$;

create function public.kelime_apply_v4(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  change jsonb;
  result jsonb;
  setting_value jsonb;
  current_revision bigint;
begin
  if owner_id is null or p_operation->>'accountId' is distinct from owner_id::text then
    raise exception 'Authentication required for this account' using errcode = '42501';
  end if;
  if p_operation->>'id' is null or jsonb_typeof(p_operation->'changes') <> 'array' then
    raise exception 'Invalid operation';
  end if;

  insert into public.profiles(id) values(owner_id) on conflict do nothing;
  if exists(select 1 from public.operation_receipts where user_id = owner_id and id = (p_operation->>'id')::uuid) then
    return jsonb_build_object('conflict', false, 'snapshot', public.kelime_snapshot());
  end if;

  for change in select * from jsonb_array_elements(p_operation->'changes') loop
    if change->>'key' = 'setting/auto-pronunciation' then
      setting_value := change->'after';
      if jsonb_typeof(setting_value) <> 'boolean' then
        raise exception 'Automatic pronunciation must be a boolean' using errcode = '23514';
      end if;
      if coalesce((select value from public.account_records where user_id = owner_id and key = 'setting/auto-pronunciation'), 'null'::jsonb) is distinct from change->'before' then
        return jsonb_build_object('conflict', true, 'message', 'Account pronunciation preference changed. Review this setting before retrying.', 'snapshot', public.kelime_snapshot());
      end if;
    end if;
  end loop;

  -- Protocol 3 already provides the CAS checks, receipts, ownership validation,
  -- event projection and atomic transaction used by every operation kind.
  result := public.kelime_apply_v3_internal(p_operation);
  if coalesce((result->>'conflict')::boolean, false) then
    return result;
  end if;

  -- Protocol 3 clear-all intentionally retained only its two known settings.
  -- Reinsert the new explicit default/value in the same transaction.
  if setting_value is not null or p_operation->>'kind' = 'clear-all' then
    setting_value := coalesce(setting_value, 'true'::jsonb);
    select revision into current_revision from public.profiles where id = owner_id;
    insert into public.account_records(user_id, key, value, revision)
      values(owner_id, 'setting/auto-pronunciation', setting_value, current_revision)
      on conflict(user_id, key) do update
      set value = excluded.value, revision = excluded.revision, updated_at = now();
  end if;

  update public.profiles set sync_protocol = 4 where id = owner_id;
  return jsonb_build_object('conflict', false, 'snapshot', public.kelime_snapshot());
end $$;

revoke all on function public.kelime_apply_legacy(jsonb), public.kelime_apply_legacy_internal(jsonb),
  public.kelime_apply_v3(jsonb), public.kelime_apply_v4(jsonb), public.kelime_apply_v3_internal(jsonb),
  public.kelime_snapshot_v4() from public, anon, authenticated;
grant execute on function public.kelime_apply_v3(jsonb), public.kelime_apply_v4(jsonb),
  public.kelime_snapshot_v4() to authenticated;
