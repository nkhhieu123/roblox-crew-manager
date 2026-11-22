-- =====================================================================
-- Roblox Crew Manager — initial schema
-- All access goes through the Next.js server using the service role key.
-- RLS is enabled on every table with NO policies, so the public anon key
-- (if ever leaked) cannot read or write anything.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- App settings (key/value)
-- ---------------------------------------------------------------------
create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

insert into app_settings (key, value) values
  ('general', jsonb_build_object(
    'store_images', true,
    'default_donate_type', 'cumulative',   -- cumulative | weekly
    'week_reset_weekday', 1,               -- 0=Sunday .. 6=Saturday (ISO: Monday=1)
    'week_reset_hour', 0,                  -- hour of day (0-23) in the timezone below
    'timezone', 'Asia/Ho_Chi_Minh',
    'baseline_tolerance_pct', 15           -- baseline may be up to 15% younger than the window
  ))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Members — one row per Roblox username (identity = username, case-insensitive)
-- ---------------------------------------------------------------------
create table if not exists members (
  id                uuid primary key default gen_random_uuid(),
  username          text not null,
  username_key      text generated always as (lower(username)) stored,
  display_name      text,
  level             integer,
  role              text,
  last_seen_text    text,
  exempt            boolean not null default false,
  exempt_reason     text,
  notes             text,
  first_seen_at     timestamptz,          -- captured_at of first snapshot containing the member
  last_snapshot_at  timestamptz,          -- captured_at of latest snapshot containing the member
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint members_username_key_unique unique (username_key)
);

-- ---------------------------------------------------------------------
-- Snapshots — one per upload session (may contain several images)
-- ---------------------------------------------------------------------
create table if not exists snapshots (
  id            uuid primary key default gen_random_uuid(),
  captured_at   timestamptz not null,           -- time the data represents (defaults to upload time)
  uploaded_at   timestamptz not null default now(),
  uploaded_by   text not null,
  donate_type   text not null default 'cumulative' check (donate_type in ('cumulative','weekly')),
  image_paths   text[] not null default '{}',
  member_count  integer not null default 0,
  ocr_model     text,
  ocr_raw       jsonb,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists snapshots_captured_at_idx on snapshots (captured_at desc);

-- ---------------------------------------------------------------------
-- Snapshot entries — the values read for one member in one snapshot
-- ---------------------------------------------------------------------
create table if not exists snapshot_entries (
  id              uuid primary key default gen_random_uuid(),
  snapshot_id     uuid not null references snapshots(id) on delete cascade,
  member_id       uuid not null references members(id) on delete cascade,
  username        text not null,
  display_name    text,
  level           integer,
  role            text,
  weekly_km       numeric,          -- null = not visible / unreadable (never guessed)
  donated         numeric,          -- null = not visible / unreadable
  last_seen_text  text,
  needs_review    boolean not null default false,
  verified        boolean not null default true,   -- false => excluded from comparisons
  review_notes    text,
  raw             jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint snapshot_entries_unique unique (snapshot_id, member_id)
);
create index if not exists snapshot_entries_member_idx on snapshot_entries (member_id);

-- ---------------------------------------------------------------------
-- Requirement sets (editable) + immutable versions
-- ---------------------------------------------------------------------
create table if not exists requirement_sets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  config      jsonb not null,      -- see src/lib/engine/types.ts RequirementConfig
  version     integer not null default 1,
  is_active   boolean not null default false,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
-- only one active set at a time
create unique index if not exists requirement_sets_one_active
  on requirement_sets ((is_active)) where is_active;

create table if not exists requirement_versions (
  id                  uuid primary key default gen_random_uuid(),
  requirement_set_id  uuid references requirement_sets(id) on delete set null,
  name                text not null,
  version             integer not null,
  config              jsonb not null,
  created_by          text,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Evaluations — one run of the requirement against a target snapshot.
-- Stores a frozen copy of the config so history never changes.
-- ---------------------------------------------------------------------
create table if not exists evaluations (
  id                      uuid primary key default gen_random_uuid(),
  requirement_version_id  uuid references requirement_versions(id) on delete set null,
  requirement_name        text not null,
  config                  jsonb not null,
  settings                jsonb not null,
  to_snapshot_id          uuid references snapshots(id) on delete set null,
  to_captured_at          timestamptz not null,
  summary                 jsonb not null default '{}',
  superseded              boolean not null default false,
  trigger                 text not null default 'manual',
  created_by              text not null,
  created_at              timestamptz not null default now()
);
create index if not exists evaluations_to_idx on evaluations (to_captured_at desc);

create table if not exists evaluation_results (
  id                 uuid primary key default gen_random_uuid(),
  evaluation_id      uuid not null references evaluations(id) on delete cascade,
  member_id          uuid references members(id) on delete set null,  -- keep history even if a member is deleted
  username           text not null,
  status             text not null check (status in ('PASS','FAIL','PENDING','WARNING','EXEMPT')),
  km_gain            numeric,
  km_gain_exact      boolean,
  donate_gain        numeric,
  donate_gain_exact  boolean,
  km_required        numeric,
  donate_required    numeric,
  from_snapshot_id   uuid references snapshots(id) on delete set null,
  from_captured_at   timestamptz,
  to_captured_at     timestamptz,
  hours              numeric,
  km_per_day         numeric,
  donate_per_day     numeric,
  reason_summary     text,
  reasons            text[] not null default '{}',
  flags              text[] not null default '{}',
  consecutive_fails  integer not null default 0,
  resolved           boolean not null default false,
  resolved_at        timestamptz,
  resolved_by        text,
  resolution_note    text,
  created_at         timestamptz not null default now()
);
create index if not exists evaluation_results_eval_idx on evaluation_results (evaluation_id);
create index if not exists evaluation_results_member_idx on evaluation_results (member_id, created_at desc);
create index if not exists evaluation_results_status_idx on evaluation_results (status);

-- ---------------------------------------------------------------------
-- Audit log — who did what
-- ---------------------------------------------------------------------
create table if not exists audit_logs (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  actor        text not null,
  action       text not null,
  entity_type  text,
  entity_id    text,
  details      jsonb not null default '{}'
);
create index if not exists audit_logs_created_idx on audit_logs (created_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security: deny everything for anon/authenticated roles.
-- The service role bypasses RLS and is only used on the server.
-- ---------------------------------------------------------------------
alter table app_settings          enable row level security;
alter table members               enable row level security;
alter table snapshots             enable row level security;
alter table snapshot_entries      enable row level security;
alter table requirement_sets      enable row level security;
alter table requirement_versions  enable row level security;
alter table evaluations           enable row level security;
alter table evaluation_results    enable row level security;
alter table audit_logs            enable row level security;

-- ---------------------------------------------------------------------
-- Private storage bucket for original screenshots
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('snapshots', 'snapshots', false)
on conflict (id) do nothing;
