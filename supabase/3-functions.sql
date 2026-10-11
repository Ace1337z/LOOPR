-- LOOPR 3 of 3: the functions the app is allowed to call.
--
-- Every rating-changing operation is a SECURITY DEFINER function. Clients never
-- write a rating column or a match row directly, because both would be
-- forgeable. search_path is pinned throughout so the functions cannot be
-- hijacked via a temporary table.

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------
create or replace function public.role_of(p_user uuid)
returns app_role
language sql stable security definer set search_path = public
as $$
  select role from public.staff
   where user_id = p_user and revoked_at is null;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.role_of(auth.uid()) = 'admin';
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.role_of(auth.uid()) is not null;
$$;

create or replace function public.my_role()
returns app_role
language sql stable security definer set search_path = public
as $$
  select public.role_of(auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Admin self-service
-- ---------------------------------------------------------------------------
create or replace function public.grant_role(
  p_user_id uuid, p_role app_role, p_organisation text default 'unaffiliated'
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can grant roles';
  end if;

  insert into public.staff (user_id, role, organisation, granted_by)
  values (p_user_id, p_role, coalesce(nullif(p_organisation, ''), 'unaffiliated'), auth.uid())
  on conflict (user_id) do update
    set role = excluded.role,
        organisation = excluded.organisation,
        granted_by = auth.uid(),
        granted_at = now(),
        revoked_at = null;
end;
$$;

create or replace function public.revoke_role(p_user_id uuid) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can revoke roles';
  end if;
  update public.staff set revoked_at = now() where user_id = p_user_id;
end;
$$;

create or replace function public.create_invite(
  p_role app_role, p_organisation text default 'unaffiliated'
) returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'only an admin can create invites';
  end if;
  -- These get read off a screen and typed by hand, so avoid 0/O and 1/I.
  v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
  insert into public.admin_invites (code, role, organisation, created_by)
  values (v_code, p_role, coalesce(nullif(p_organisation, ''), 'unaffiliated'), auth.uid());
  return v_code;
end;
$$;

-- Single use, enforced by clearing the code once redeemed.
create or replace function public.redeem_invite(p_code text) returns app_role
language plpgsql security definer
set search_path = public
as $$
declare
  v_role app_role;
  v_org text;
begin
  select role, organisation into v_role, v_org
    from public.admin_invites
   where code = upper(trim(p_code)) and redeemed_at is null
   for update;

  if v_role is null then
    raise exception 'invite code is invalid or already used';
  end if;

  update public.admin_invites
     set redeemed_by = auth.uid(), redeemed_at = now()
   where code = upper(trim(p_code));

  insert into public.staff (user_id, role, organisation, granted_by)
  values (auth.uid(), v_role, v_org, auth.uid())
  on conflict (user_id) do update
    set role = excluded.role,
        organisation = excluded.organisation,
        granted_by = auth.uid(),
        granted_at = now(),
        revoked_at = null;

  return v_role;
end;
$$;

-- Readable staff list for the admin screen. Exposes no credentials, only the
-- profile fields an organiser needs to identify a colleague.
create or replace function public.list_staff()
returns table (
  user_id uuid,
  display_name text,
  handle text,
  role app_role,
  organisation text,
  granted_at timestamptz,
  revoked_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select s.user_id, p.display_name, p.handle, s.role, s.organisation, s.granted_at, s.revoked_at
    from public.staff s
    join public.profiles p on p.id = s.user_id
   order by s.granted_at desc;
$$;

revoke all on function public.role_of(uuid) from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_staff() from public;
revoke all on function public.my_role() from public;
revoke all on function public.grant_role(uuid, app_role, text) from public;
revoke all on function public.revoke_role(uuid) from public;
revoke all on function public.create_invite(app_role, text) from public;
revoke all on function public.redeem_invite(text) from public;
revoke all on function public.list_staff() from public;
grant execute on function public.role_of(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.grant_role(uuid, app_role, text) to authenticated;
grant execute on function public.revoke_role(uuid) to authenticated;
grant execute on function public.create_invite(app_role, text) to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
grant execute on function public.list_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- Casual match flow: submit, then the opponent confirms.
--
-- Ratings move at CONFIRMATION, never at submission. If they moved at
-- submission, a rejected claim would need unwinding and a match the opponent
-- never saw would already have changed two profiles for no reason.
-- ---------------------------------------------------------------------------
create or replace function public.submit_match(
  p_opponent_id uuid,
  p_player_won boolean,
  p_player_sets int,
  p_opponent_sets int,
  p_best_of int default 3,
  p_tag match_tag default 'friendly',
  p_note text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_opponent_id = v_me then
    raise exception 'cannot log a match against yourself';
  end if;
  if not (
    (p_player_sets = (p_best_of + 1) / 2 and p_opponent_sets between 0 and (p_best_of - 1) / 2)
    or
    (p_opponent_sets = (p_best_of + 1) / 2 and p_player_sets between 0 and (p_best_of - 1) / 2)
  ) then
    raise exception 'invalid set score %-% for best of %', p_player_sets, p_opponent_sets, p_best_of;
  end if;

  if not exists (select 1 from public.profiles where id = p_opponent_id) then
    raise exception 'opponent profile not found';
  end if;

  -- One open claim per pair at a time, so the same fixture cannot be submitted
  -- repeatedly while the opponent is deciding.
  if exists (
    select 1 from public.matches
     where status = 'pending'
       and ((player_id = v_me and opponent_id = p_opponent_id)
         or (player_id = p_opponent_id and opponent_id = v_me))
  ) then
    raise exception 'you already have a match pending with this opponent';
  end if;

  insert into public.matches (
    player_id, opponent_id, player_won, player_sets, opponent_sets, best_of, tag, note
  ) values (
    v_me, p_opponent_id, p_player_won, p_player_sets, p_opponent_sets, p_best_of, p_tag, p_note
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.respond_to_match(
  p_match_id uuid,
  p_approved boolean,
  p_reason text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row public.matches%rowtype;
  v_repeats int;
  v_sub_rating int; v_sub_games int;
  v_opp_rating int; v_opp_games int;
  v_sub_after int; v_opp_after int;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.matches where id = p_match_id;
  if v_row.id is null then
    raise exception 'match not found';
  end if;
  if v_row.opponent_id <> v_me then
    raise exception 'only the opponent can respond to this match';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'this match has already been answered';
  end if;

  -- Disputing leaves both ratings untouched: none ever moved. The row is kept
  -- and flagged so an admin can look at it rather than vanishing.
  if not p_approved then
    update public.matches
       set status = 'disputed', disputed_reason = left(coalesce(p_reason, ''), 500)
     where id = p_match_id;
    return p_match_id;
  end if;

  -- Lock in a deterministic order so two players confirming each other at the
  -- same moment cannot deadlock.
  perform 1 from public.profiles
   where id in (v_row.player_id, v_row.opponent_id)
   order by id
   for update;

  select casual_rating, casual_games into v_sub_rating, v_sub_games
    from public.profiles where id = v_row.player_id;
  select casual_rating, casual_games into v_opp_rating, v_opp_games
    from public.profiles where id = v_row.opponent_id;

  if v_sub_rating is null or v_opp_rating is null then
    raise exception 'a player profile has gone missing';
  end if;

  -- Only confirmed matches count towards the rematch discount.
  select count(*) into v_repeats
    from public.matches
   where status = 'confirmed'
     and ((player_id = v_row.player_id and opponent_id = v_row.opponent_id)
       or (player_id = v_row.opponent_id and opponent_id = v_row.player_id));

  v_sub_after := public.rate_one(v_sub_rating, v_sub_games, v_opp_rating, v_opp_games,
                                v_row.player_won, v_row.tag, public.pair_discount(v_repeats));
  v_opp_after := public.rate_one(v_opp_rating, v_opp_games, v_sub_rating, v_sub_games,
                                not v_row.player_won, v_row.tag, public.pair_discount(v_repeats));

  update public.matches
     set status = 'confirmed',
         confirmed_by = v_me,
         confirmed_at = now(),
         player_rating_before = v_sub_rating,
         opponent_rating_before = v_opp_rating,
         player_rating_after = v_sub_after,
         opponent_rating_after = v_opp_after
   where id = p_match_id;

  update public.profiles
     set casual_rating = v_sub_after, casual_games = casual_games + 1, updated_at = now()
   where id = v_row.player_id;

  update public.profiles
     set casual_rating = v_opp_after, casual_games = casual_games + 1, updated_at = now()
   where id = v_row.opponent_id;

  return p_match_id;
end;
$$;

-- Admin resolves a dispute. Voiding moves no rating, because none ever moved.
create or replace function public.resolve_dispute(
  p_match_id uuid, p_confirm boolean
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can resolve disputes';
  end if;

  if p_confirm then
    -- respond_to_match insists the caller is the opponent, so an admin cannot
    -- use it directly; promote the match back to pending and let the function
    -- below apply the rating under the admin's authority.
    update public.matches set status = 'pending', disputed_reason = null where id = p_match_id;
    perform public.admin_confirm_match(p_match_id);
    return;
  end if;

  update public.matches set status = 'void' where id = p_match_id;
end;
$$;

-- Lets an admin confirm a disputed match on the players' behalf. Separate from
-- respond_to_match because that one is deliberately opponent-only.
create or replace function public.admin_confirm_match(p_match_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.matches%rowtype;
  v_repeats int;
  v_sub_rating int; v_sub_games int;
  v_opp_rating int; v_opp_games int;
  v_sub_after int; v_opp_after int;
begin
  if not public.is_admin() then
    raise exception 'only an admin can confirm a disputed match';
  end if;

  select * into v_row from public.matches where id = p_match_id;
  if v_row.id is null or v_row.status <> 'pending' then
    raise exception 'match is not awaiting confirmation';
  end if;

  perform 1 from public.profiles
   where id in (v_row.player_id, v_row.opponent_id)
   order by id
   for update;

  -- Read both rows into named variables. Inside a subquery a bare column
  -- reference resolves to that subquery's own row, which would rate each player
  -- against themselves.
  select casual_rating, casual_games into v_sub_rating, v_sub_games
    from public.profiles where id = v_row.player_id;
  select casual_rating, casual_games into v_opp_rating, v_opp_games
    from public.profiles where id = v_row.opponent_id;

  select count(*) into v_repeats
    from public.matches
   where status = 'confirmed'
     and ((player_id = v_row.player_id and opponent_id = v_row.opponent_id)
       or (player_id = v_row.opponent_id and opponent_id = v_row.player_id));

  v_sub_after := public.rate_one(v_sub_rating, v_sub_games, v_opp_rating, v_opp_games,
                                v_row.player_won, v_row.tag, public.pair_discount(v_repeats));
  v_opp_after := public.rate_one(v_opp_rating, v_opp_games, v_sub_rating, v_sub_games,
                                not v_row.player_won, v_row.tag, public.pair_discount(v_repeats));

  update public.matches
     set status = 'confirmed',
         confirmed_by = auth.uid(),
         confirmed_at = now(),
         player_rating_before = v_sub_rating,
         opponent_rating_before = v_opp_rating,
         player_rating_after = v_sub_after,
         opponent_rating_after = v_opp_after
   where id = p_match_id;

  update public.profiles
     set casual_rating = v_sub_after, casual_games = casual_games + 1, updated_at = now()
   where id = v_row.player_id;

  update public.profiles
     set casual_rating = v_opp_after, casual_games = casual_games + 1, updated_at = now()
   where id = v_row.opponent_id;
end;
$$;

create or replace function public.pending_for_me()
returns setof public.matches
language sql stable security definer set search_path = public
as $$
  select * from public.matches
   where opponent_id = auth.uid() and status = 'pending'
   order by played_at desc;
$$;

create or replace function public.disputed_matches()
returns setof public.matches
language sql stable security definer set search_path = public
as $$
  select * from public.matches where status = 'disputed' order by played_at asc;
$$;

revoke all on function public.submit_match(uuid, boolean, int, int, int, match_tag, text) from public;
revoke all on function public.respond_to_match(uuid, boolean, text) from public;
revoke all on function public.resolve_dispute(uuid, boolean) from public;
revoke all on function public.admin_confirm_match(uuid) from public;
revoke all on function public.pending_for_me() from public;
revoke all on function public.disputed_matches() from public;
grant execute on function public.submit_match(uuid, boolean, int, int, int, match_tag, text) to authenticated;
grant execute on function public.respond_to_match(uuid, boolean, text) to authenticated;
grant execute on function public.resolve_dispute(uuid, boolean) to authenticated;
grant execute on function public.admin_confirm_match(uuid) to authenticated;
grant execute on function public.pending_for_me() to authenticated;
grant execute on function public.disputed_matches() to authenticated;