-- Durable lounge analytics + cloud publish queue (single JuicyChat account).
-- Files in /tmp on Vercel are ephemeral; this table is the source of truth.

create table if not exists lounge_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists lounge_publish_jobs (
  id text primary key,
  character_id text not null,
  character_name text not null default '',
  fire_at_ms bigint not null,
  status text not null default 'scheduled',
  result_message text,
  created_at timestamptz not null default now(),
  result_at timestamptz
);

create index if not exists lounge_publish_jobs_due_idx
  on lounge_publish_jobs (status, fire_at_ms);

create table if not exists lounge_cron_log (
  id serial primary key,
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  message text,
  details jsonb
);
