-- Android companion device tokens (long-lived, issued when a pairing code is redeemed).

create table if not exists lounge_devices (
  token text primary key,
  user_id text not null,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index if not exists lounge_devices_user_idx on lounge_devices (user_id);
