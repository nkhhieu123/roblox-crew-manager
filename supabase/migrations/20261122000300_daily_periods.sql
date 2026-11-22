-- Daily evaluation periods (00:00 -> 00:00 local time).
-- An evaluation now records the period it covers; re-evaluating the same period supersedes the old run.
alter table evaluations add column if not exists period_kind text not null default 'rolling'
  check (period_kind in ('rolling', 'daily'));
alter table evaluations add column if not exists period_start timestamptz;
alter table evaluations add column if not exists period_end timestamptz;
-- false while the day is still running (results are progress, not a final verdict)
alter table evaluations add column if not exists is_final boolean not null default true;

update evaluations set period_end = to_captured_at where period_end is null;
create index if not exists evaluations_period_idx on evaluations (period_kind, period_start);
