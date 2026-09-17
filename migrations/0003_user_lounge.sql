-- Per-account lounge data (survives browsers / devices) + Android pairing.

create table if not exists lounge_user_kv (
  user_id text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists lounge_user_kv_user_idx on lounge_user_kv (user_id);

create table if not exists lounge_pair_codes (
  code text primary key,
  user_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table lounge_publish_jobs
  add column if not exists user_id text;

create index if not exists lounge_publish_jobs_user_idx
  on lounge_publish_jobs (user_id);
