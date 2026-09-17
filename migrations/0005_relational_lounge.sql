-- First-class lounge tables (replacing "everything is a JSON blob").
-- lounge_user_kv remains for the sealed JuicyChat cookie and derived caches.
-- These tables are the source of truth for webhook, snapshot, history,
-- followers, notifications, and (already) scheduled publishes.

create table if not exists lounge_account (
  user_id text primary key,
  juicy_user_id text,
  juicy_user_name text,
  juicy_user_no text,
  juicy_email text,
  session_logged_in_at timestamptz,
  session_source text,
  has_session boolean not null default false,
  grok_hook_url text not null default '',
  grok_hook_secret text not null default '',
  grok_pull_token text not null default '',
  grok_hook_enabled boolean not null default false,
  grok_last_at timestamptz,
  grok_last_ok boolean,
  grok_last_status integer,
  grok_last_error text,
  timezone text not null default 'Europe/Madrid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lounge_snapshot (
  user_id text primary key,
  scraped_at timestamptz not null,
  juicy_user_id text,
  authenticated boolean not null default false,
  bots integer not null default 0,
  chats integer not null default 0,
  likes integer not null default 0,
  favorites integer not null default 0,
  followers integer not null default 0,
  interactions integer not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists lounge_history (
  user_id text primary key,
  timezone text not null default 'Europe/Madrid',
  days integer not null default 0,
  latest_day date,
  chats integer not null default 0,
  likes integer not null default 0,
  favorites integer not null default 0,
  followers integer not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists lounge_followers (
  user_id text primary key,
  last_count integer,
  last_at timestamptz,
  points integer not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists lounge_notifications (
  user_id text primary key,
  event_count integer not null default 0,
  last_scraped_at timestamptz,
  last_ts timestamptz,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists lounge_account_juicy_idx on lounge_account (juicy_user_id);
create index if not exists lounge_snapshot_scraped_idx on lounge_snapshot (scraped_at desc);
create index if not exists lounge_history_latest_idx on lounge_history (latest_day desc);
