-- Weekly KM reset: the in-game screenshot shows a countdown to the next reset.
-- We store the raw countdown text and the exact reset instant (captured_at + countdown).
alter table snapshots add column if not exists reset_countdown_text text;
alter table snapshots add column if not exists next_reset_at timestamptz;

-- Atomically create a snapshot with all its entries and upsert member profiles.
-- Member profile fields (display name, level, role, last seen) are only updated
-- from VERIFIED entries and only when this snapshot is the newest one for the member,
-- so unverified OCR output never overwrites existing data.
create or replace function save_snapshot(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot_id uuid;
  v_captured_at timestamptz := (payload->>'captured_at')::timestamptz;
  v_entry jsonb;
  v_member_id uuid;
  v_username text;
  v_verified boolean;
  v_count integer := 0;
begin
  if v_captured_at is null then
    raise exception 'captured_at is required';
  end if;

  insert into snapshots (captured_at, uploaded_by, donate_type, image_paths, ocr_model, ocr_raw, notes, reset_countdown_text, next_reset_at)
  values (
    v_captured_at,
    coalesce(payload->>'uploaded_by', 'unknown'),
    coalesce(payload->>'donate_type', 'cumulative'),
    coalesce(array(select jsonb_array_elements_text(payload->'image_paths')), '{}'),
    payload->>'ocr_model',
    payload->'ocr_raw',
    payload->>'notes',
    nullif(payload->>'reset_countdown_text', ''),
    (nullif(payload->>'next_reset_at', ''))::timestamptz
  )
  returning id into v_snapshot_id;

  for v_entry in select * from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb))
  loop
    v_username := btrim(v_entry->>'username');
    if v_username is null or v_username = '' then
      continue;
    end if;
    v_verified := coalesce((v_entry->>'verified')::boolean, true);

    insert into members (username, first_seen_at, last_snapshot_at)
    values (v_username, v_captured_at, v_captured_at)
    on conflict (username_key) do update
      set first_seen_at    = least(members.first_seen_at, excluded.first_seen_at),
          last_snapshot_at = greatest(members.last_snapshot_at, excluded.last_snapshot_at),
          updated_at       = now()
    returning id into v_member_id;

    insert into snapshot_entries (
      snapshot_id, member_id, username, display_name, level, role,
      weekly_km, donated, last_seen_text, needs_review, verified, review_notes, raw
    ) values (
      v_snapshot_id, v_member_id, v_username,
      nullif(v_entry->>'display_name', ''),
      (v_entry->>'level')::integer,
      nullif(v_entry->>'role', ''),
      (v_entry->>'weekly_km')::numeric,
      (v_entry->>'donated')::numeric,
      nullif(v_entry->>'last_seen_text', ''),
      coalesce((v_entry->>'needs_review')::boolean, false),
      v_verified,
      nullif(v_entry->>'review_notes', ''),
      v_entry->'raw'
    )
    on conflict (snapshot_id, member_id) do nothing;

    -- Update profile only from verified data of the newest snapshot
    if v_verified then
      update members m set
        display_name   = coalesce(nullif(v_entry->>'display_name', ''), m.display_name),
        level          = coalesce((v_entry->>'level')::integer, m.level),
        role           = coalesce(nullif(v_entry->>'role', ''), m.role),
        last_seen_text = coalesce(nullif(v_entry->>'last_seen_text', ''), m.last_seen_text),
        updated_at     = now()
      where m.id = v_member_id
        and m.last_snapshot_at <= v_captured_at;
    end if;

    v_count := v_count + 1;
  end loop;

  update snapshots set member_count = v_count where id = v_snapshot_id;
  return v_snapshot_id;
end;
$$;

revoke all on function save_snapshot(jsonb) from public, anon, authenticated;
grant execute on function save_snapshot(jsonb) to service_role;
