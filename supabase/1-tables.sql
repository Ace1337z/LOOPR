-- LOOPR 1 of 3: tables and row level security.
-- Run this file first, then 2-ratings.sql, then 3-functions.sql.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type match_tag as enum ('friendly', 'training', 'ladder', 'league');
exception when duplicate_object then null; end $$;

do $$ begin
  create type handedness as enum ('right', 'left', 'unknown');
exception when duplicate_object then null; end $$;

-- A submitted result is only believed once the opponent agrees.
do $$ begin
  create type match_status as enum ('pending', 'confirmed', 'disputed', 'void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app_role as enum ('admin', 'organiser');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique not null,
  display_name text not null,
  age_band text,
  city text,
  handedness handedness not null default 'unknown',
  grip text check (grip in ('shakehand', 'penhold')),
  blade text,
  fh_rubber text,
  bh_rubber text,
  playstyle_tags text[] not null default '{}',
  -- When this player is actually free. Empty means "not set", which is treated
  -- as "will play at any time" rather than hidden.
  availability text[] not null default '{}',
  constraint availability_valid check (
    availability <@ array['weekday_morning', 'weekday_evening', 'weekend']::text[]
  ),
  -- Casual ELO is derived from confirmed matches only.
  casual_rating int not null default 1500,
  casual_games int not null default 0,
  -- Sanctioned ELO is computed from organiser-entered tournament results.
  sanctioned_rating int not null default 1500,
  sanctioned_games int not null default 0,
  rating_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint casual_rating_bounds check (casual_rating between 100 and 3000),
  constraint sanctioned_rating_bounds check (sanctioned_rating between 100 and 3000),
  constraint casual_games_nonnegative check (casual_games >= 0),
  constraint sanctioned_games_nonnegative check (sanctioned_games >= 0)
);

-- ---------------------------------------------------------------------------
-- matches: a casual result awaiting the opponent's agreement
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  -- player_id is whoever submitted. Denormalised on purpose: history must not
  -- change if a player later deletes their account.
  player_id uuid not null references public.profiles (id) on delete cascade,
  opponent_id uuid not null references public.profiles (id) on delete cascade,
  player_won boolean not null,
  player_sets int not null check (player_sets between 0 and 5),
  opponent_sets int not null check (opponent_sets between 0 and 5),
  best_of int not null default 3 check (best_of in (3, 5)),
  tag match_tag not null default 'friendly',
  -- null until confirmed, because nothing is believed before the opponent
  -- agrees. That is the entire point of this table.
  status match_status not null default 'pending',
  player_rating_before int,
  opponent_rating_before int,
  player_rating_after int,
  opponent_rating_after int,
  played_at timestamptz not null default now(),
  note text,
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  disputed_reason text,
  constraint not_self_match check (player_id <> opponent_id),
  constraint sets_winner_valid check (
    (player_sets = (best_of + 1) / 2 and opponent_sets between 0 and (best_of - 1) / 2)
    or
    (opponent_sets = (best_of + 1) / 2 and player_sets between 0 and (best_of - 1) / 2)
  ),
  -- A confirmed match must carry its rating snapshot; a pending one must not,
  -- because no rating has moved yet.
  constraint confirmed_has_snapshot check (
    status <> 'confirmed'
    or (player_rating_before is not null and opponent_rating_before is not null
        and player_rating_after is not null and opponent_rating_after is not null)
  )
);

-- Additive migration for databases created before verification existed.
alter table public.matches add column if not exists status match_status not null default 'confirmed';
alter table public.matches add column if not exists confirmed_by uuid references public.profiles (id);
alter table public.matches add column if not exists confirmed_at timestamptz;
alter table public.matches add column if not exists disputed_reason text;

create index if not exists matches_player_idx on public.matches (player_id, played_at desc);
create index if not exists matches_opponent_idx on public.matches (opponent_id, played_at desc);
create index if not exists matches_awaiting_opponent_idx
  on public.matches (opponent_id) where status = 'pending';
create index if not exists matches_disputed_idx
  on public.matches (status) where status = 'disputed';

-- ---------------------------------------------------------------------------
-- Staff roles
--
-- Kept OUT of profiles on purpose. A role column would be writable by anyone who
-- can update their own profile row, so promoting someone would come down to
-- including one more key in an update payload.
--
-- Bootstrap problem: with zero admins nobody can promote the first admin, so
-- this cannot be entirely self-service. Seed one admin row once via SQL (the
-- README has the statement); every later promotion happens in-app.
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role app_role not null,
  organisation text not null default 'unaffiliated',
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.staff enable row level security;
-- No policies at all: deny every statement, grant per function instead.

-- Single-use codes an existing admin hands to a new organiser.
create table if not exists public.admin_invites (
  code text primary key,
  role app_role not null,
  organisation text not null default 'unaffiliated',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  redeemed_by uuid references public.profiles (id),
  redeemed_at timestamptz
);

alter table public.admin_invites enable row level security;

-- ---------------------------------------------------------------------------
-- tournaments and entries
-- ---------------------------------------------------------------------------
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null,
  organisation text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  -- Strength at the moment of entry. The field average is built from these, so
  -- the value is recorded rather than looked up later: results played during
  -- the event would otherwise silently shift the tournament's baseline.
  rating_snapshot int not null,
  unique (tournament_id, player_id)
);

create index if not exists entries_tournament_idx
  on public.tournament_entries (tournament_id);

-- ---------------------------------------------------------------------------
-- sanctioned_results: organiser-entered tournament results
--
-- The organiser supplies who played whom and the score. The rating is computed
-- by the database; nobody ever types a rating number.
-- ---------------------------------------------------------------------------
create table if not exists public.sanctioned_results (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments (id) on delete set null,
  tournament_name text not null,
  tournament_date date not null,
  organisation text not null,
  player_id uuid not null references public.profiles (id) on delete cascade,
  opponent_id uuid not null references public.profiles (id) on delete cascade,
  player_won boolean not null,
  player_sets int not null check (player_sets between 0 and 5),
  opponent_sets int not null check (opponent_sets between 0 and 5),
  best_of int not null default 3 check (best_of in (3, 5)),
  placing int check (placing is null or placing > 0),
  -- The rating this result was scored against: the best entrant in the event
  -- other than the player themselves. Recorded so the rating can be replayed if
  -- the algorithm ever changes.
  opponent_strength int not null,
  player_rating_before int not null,
  player_rating_after int not null,
  opponent_rating_before int not null,
  opponent_rating_after int not null,
  entered_by uuid not null references public.staff (user_id),
  created_at timestamptz not null default now(),
  constraint sanctioned_not_self check (player_id <> opponent_id),
  constraint sanctioned_sets_winner_valid check (
    (player_sets = (best_of + 1) / 2 and opponent_sets between 0 and (best_of - 1) / 2)
    or
    (opponent_sets = (best_of + 1) / 2 and player_sets between 0 and (best_of - 1) / 2)
  )
);

create index if not exists sanctioned_player_idx
  on public.sanctioned_results (player_id, tournament_date desc);

-- ---------------------------------------------------------------------------
-- Additive migration for databases created by an earlier version of this file.
--
-- create table if not exists silently does nothing when the table already
-- exists, so new columns have to be added explicitly or an upgraded database
-- keeps the old shape without complaining.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists sanctioned_games int not null default 0;
alter table public.profiles
  add column if not exists availability text[] not null default '{}';
alter table public.profiles
  drop constraint if exists availability_valid;
alter table public.profiles
  add constraint availability_valid check (
    availability <@ array['weekday_morning', 'weekday_evening', 'weekend']::text[]
  );
alter table public.profiles
  add column if not exists sanctioned_rating int not null default 1500;
alter table public.profiles
  drop constraint if exists sanctioned_rating_bounds;
alter table public.profiles
  add constraint sanctioned_rating_bounds check (sanctioned_rating between 100 and 3000);

alter table public.sanctioned_results
  add column if not exists tournament_id uuid references public.tournaments (id) on delete set null;
alter table public.sanctioned_results
  add column if not exists opponent_strength int;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.sanctioned_results enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;

drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public on public.profiles
  for select using (rating_visible or id = auth.uid());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Both players can read a match, so each sees what the other claims.
drop policy if exists matches_select_participants on public.matches;
create policy matches_select_participants on public.matches
  for select using (player_id = auth.uid() or opponent_id = auth.uid());

drop policy if exists sanctioned_select_participants on public.sanctioned_results;
create policy sanctioned_select_participants on public.sanctioned_results
  for select using (player_id = auth.uid() or opponent_id = auth.uid());

-- The tournament calendar is public information.
drop policy if exists tournaments_select_all on public.tournaments;
create policy tournaments_select_all on public.tournaments for select using (true);

drop policy if exists entries_select_all on public.tournament_entries;
create policy entries_select_all on public.tournament_entries for select using (true);

-- ---------------------------------------------------------------------------
-- Column privileges
--
-- RLS says WHO may write a row; these say WHAT they may write. Both are
-- required. Without the grants below, profiles_update_self lets any player
-- write every column of their own profile, including both rating columns.
-- Typing the field out of db.ts does not help: the REST endpoint is directly
-- callable.
--
-- Ratings move only through submit_match/respond_to_match (casual) and
-- record_tournament_result (sanctioned).
-- ---------------------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant update (
  handle, display_name, age_band, city, handedness, grip,
  blade, fh_rubber, bh_rubber, playstyle_tags, availability, rating_visible
) on public.profiles to authenticated;

-- No insert/update/delete policy exists for matches or sanctioned_results, so
-- those tables are read-only to the client. All writes go through the
-- SECURITY DEFINER functions in 3-functions.sql.

-- ---------------------------------------------------------------------------
-- Realtime
--
-- The Confirm tab badge updates when an opponent submits a result. Realtime
-- honours RLS, so a player only ever receives rows they are allowed to read.
-- Skipped quietly if the publication does not exist yet: the badge then falls
-- back to refreshing on foreground, which is slower but still correct.
-- ---------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.matches;
exception
  when undefined_object then null;
  when duplicate_object then null;
  when others then null;
end $$;