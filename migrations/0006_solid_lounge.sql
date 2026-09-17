-- Queryable first-class rows (not just JSON blobs).
-- lounge_history / lounge_followers still keep a full document backup.
-- These tables are the source of truth for charts, settings, and the status panel.

create table if not exists lounge_settings (
  user_id text primary key,
  timezone text not null default 'Europe/Madrid',
  daily_pull_enabled boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists lounge_history_day (
  user_id text not null,
  day date not null,
  scraped_at timestamptz,
  chats integer not null default 0,
  likes integer not null default 0,
  favorites integer not null default 0,
  followers integer not null default 0,
  interactions integer not null default 0,
  bots integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists lounge_history_day_day_idx on lounge_history_day (day desc);

create table if not exists lounge_follower_point (
  user_id text not null,
  day date not null,
  scraped_at timestamptz not null,
  count integer not null,
  source text not null default '',
  primary key (user_id, day)
);

create index if not exists lounge_follower_point_day_idx on lounge_follower_point (day desc);

create table if not exists lounge_webhook_delivery (
  id serial primary key,
  user_id text not null,
  delivered_at timestamptz not null default now(),
  ok boolean not null,
  status integer,
  error text
);

create index if not exists lounge_webhook_delivery_user_idx
  on lounge_webhook_delivery (user_id, delivered_at desc);
