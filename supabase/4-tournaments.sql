-- LOOPR 4 of 4: tournaments and sanctioned ELO.
--
-- An organiser supplies who played whom and the score. The database computes the
-- rating. No organiser ever types a rating number.

create or replace function public.create_tournament(
  p_name text, p_date date, p_organisation text default ''
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_org text;
begin
  if not public.is_staff() then
    raise exception 'only staff can create a tournament';
  end if;

  select organisation into v_org from public.staff
   where user_id = auth.uid() and revoked_at is null;
  if v_org is null then
    raise exception 'organiser is not active';
  end if;

  insert into public.tournaments (name, date, organisation, created_by)
  values (
    p_name, p_date,
    coalesce(nullif(p_organisation, ''), v_org),
    auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

-- Entrants are snapshotted at entry: the field average must reflect the
-- tournament as it was, not be rewritten by matches played during it.
create or replace function public.enter_tournament(
  p_tournament_id uuid, p_players uuid[]
) returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_rating int;
  v_added int := 0;
begin
  if not public.is_staff() then
    raise exception 'only staff can enter players';
  end if;

  if not exists (select 1 from public.tournaments where id = p_tournament_id) then
    raise exception 'tournament not found';
  end if;
  if coalesce(array_length(p_players, 1), 0) < 2 then
    raise exception 'a tournament needs at least two entrants';
  end if;

  foreach v_pid in array p_players loop
    select casual_rating into v_rating from public.profiles where id = v_pid;
    if v_rating is null then
      raise exception 'player % not found', v_pid;
    end if;

    insert into public.tournament_entries (tournament_id, player_id, rating_snapshot)
    values (p_tournament_id, v_pid, v_rating)
    on conflict (tournament_id, player_id) do nothing;

    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

-- Records one tournament game and applies the sanctioned rating to both sides.
--
-- The opponent rating used is the tournament field average excluding the player
-- themselves, so a result is never scored against the scorer's own rating.
create or replace function public.record_tournament_result(
  p_tournament_id uuid,
  p_player_id uuid,
  p_opponent_id uuid,
  p_player_won boolean,
  p_player_sets int,
  p_opponent_sets int,
  p_best_of int default 3,
  p_placing int default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_t public.tournaments%rowtype;
  v_id uuid;
  v_sub_ref int;
  v_opp_ref int;
  v_sub_rating int;
  v_opp_rating int;
  v_sub_after int; v_opp_after int;
begin
  if not public.is_staff() then
    raise exception 'only staff can record tournament results';
  end if;
  if p_player_id = p_opponent_id then
    raise exception 'cannot record a player against themselves';
  end if;
  if not (
    (p_player_sets = (p_best_of + 1) / 2 and p_opponent_sets between 0 and (p_best_of - 1) / 2)
    or
    (p_opponent_sets = (p_best_of + 1) / 2 and p_player_sets between 0 and (p_best_of - 1) / 2)
  ) then
    raise exception 'invalid set score %-% for best of %', p_player_sets, p_opponent_sets, p_best_of;
  end if;

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then
    raise exception 'tournament not found';
  end if;

  -- Both sides must be entrants, otherwise the seed order would come from a
  -- tournament they are not part of.
  if not exists (select 1 from public.tournament_entries
                  where tournament_id = p_tournament_id and player_id = p_player_id) then
    raise exception 'player is not entered in this tournament';
  end if;
  if not exists (select 1 from public.tournament_entries
                  where tournament_id = p_tournament_id and player_id = p_opponent_id) then
    raise exception 'opponent is not entered in this tournament';
  end if;

  perform 1 from public.profiles
   where id in (p_player_id, p_opponent_id)
   order by id
   for update;

  select casual_rating into v_sub_rating from public.profiles where id = p_player_id;
  select casual_rating into v_opp_rating from public.profiles where id = p_opponent_id;

  -- Each player is scored against the best entrant OTHER THAN THEMSELVES. So a
  -- top seed is measured against the second seed they actually faced, and a
  -- weak entrant who wins a round gains little for beating someone weaker.
  --
  -- Deliberately not the average of the whole field: that would let a player
  -- climb toward the standard of an opponent they never met.
  v_sub_ref := public.seed_strength(p_tournament_id, p_player_id);
  v_opp_ref := public.seed_strength(p_tournament_id, p_opponent_id);

  v_sub_after := public.rate_sanctioned(v_sub_rating, v_sub_ref, p_player_won);
  v_opp_after := public.rate_sanctioned(v_opp_rating, v_opp_ref, not p_player_won);

  insert into public.sanctioned_results (
    tournament_id, tournament_name, tournament_date, organisation,
    player_id, opponent_id, player_won, player_sets, opponent_sets, best_of, placing,
    opponent_strength, player_rating_before, player_rating_after,
    opponent_rating_before, opponent_rating_after, entered_by
  ) values (
    p_tournament_id, v_t.name, v_t.date, v_t.organisation,
    p_player_id, p_opponent_id, p_player_won, p_player_sets, p_opponent_sets, p_best_of, p_placing,
    v_sub_ref, v_sub_rating, v_sub_after, v_opp_rating, v_opp_after, auth.uid()
  ) returning id into v_id;

  update public.profiles
     set sanctioned_rating = v_sub_after,
         sanctioned_games  = sanctioned_games + 1,
         updated_at        = now()
   where id = p_player_id;

  update public.profiles
     set sanctioned_rating = v_opp_after,
         sanctioned_games  = sanctioned_games + 1,
         updated_at        = now()
   where id = p_opponent_id;

  return v_id;
end;
$$;

create or replace function public.my_tournaments()
returns setof public.tournaments
language sql stable security definer set search_path = public
as $$
  select * from public.tournaments order by date desc limit 50;
$$;

create or replace function public.tournament_entrants(p_tournament_id uuid)
returns table (player_id uuid, display_name text, rating_snapshot int)
language sql stable security definer set search_path = public
as $$
  select e.player_id, p.display_name, e.rating_snapshot
    from public.tournament_entries e
    join public.profiles p on p.id = e.player_id
   where e.tournament_id = p_tournament_id
   order by e.rating_snapshot desc;
$$;

revoke all on function public.create_tournament(text, date, text) from public;
revoke all on function public.enter_tournament(uuid, uuid[]) from public;
revoke all on function public.record_tournament_result(uuid, uuid, uuid, boolean, int, int, int, int) from public;
revoke all on function public.my_tournaments() from public;
revoke all on function public.tournament_entrants(uuid) from public;
grant execute on function public.create_tournament(text, date, text) to authenticated;
grant execute on function public.enter_tournament(uuid, uuid[]) to authenticated;
grant execute on function public.record_tournament_result(uuid, uuid, uuid, boolean, int, int, int, int) to authenticated;
grant execute on function public.my_tournaments() to authenticated;
grant execute on function public.tournament_entrants(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- New players get a profile on signup. Runs last so every table above exists.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, handle, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'handle', 'player-' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', 'New Player')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();