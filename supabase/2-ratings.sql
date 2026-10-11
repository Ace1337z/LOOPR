-- LOOPR 2 of 3: rating arithmetic.
--
-- Postgres owns the maths. An earlier version accepted the new ratings from the
-- client, which let a patched app set its own number to 3000. Since partner
-- matching ranks by rating, that compromised the product.
--
-- The casual constants must stay in step with src/lib/elo.ts, which the test
-- suite exercises. Change one, change the other.

create or replace function public.expected_score(p_player int, p_opponent int)
returns float
language sql immutable
as $$
  select 1.0 / (1.0 + power(10.0, (p_opponent - p_player)::float / 400.0));
$$;

create or replace function public.clamp_rating(p_rating int)
returns int
language sql immutable
as $$
  select greatest(100, least(3000, p_rating));
$$;

create or replace function public.tag_confidence(p_tag match_tag)
returns float
language sql immutable
as $$
  select case p_tag
    when 'training' then 0.5
    when 'friendly' then 0.8
    when 'ladder'  then 1.0
    when 'league'  then 1.0
  end;
$$;

-- Discount applied to the same pair after repeated meetings. A-B-A-B farming
-- keeps opponents inside one tight rating band, where an unproven-opponent
-- discount never bites, so rematches are what actually saturate.
create or replace function public.pair_discount(p_repeats int)
returns float
language sql immutable
as $$
  select case
    when p_repeats <= 0 then 1.0
    when p_repeats = 1 then 0.6
    when p_repeats = 2 then 0.35
    when p_repeats = 3 then 0.2
    else 0.1
  end;
$$;

-- Casual ELO for one player in one result.
create or replace function public.rate_one(
  p_rating int, p_games int, p_opponent_rating int, p_opponent_games int,
  p_won boolean, p_tag match_tag, p_pair_discount float
) returns int
language plpgsql immutable
as $$
declare
  v_provisional boolean := p_games < 8;
  v_k float := case when v_provisional then 48.0 else 32.0 end * public.tag_confidence(p_tag);
  -- Beating someone with no history is barely evidence.
  v_discount float := case when p_opponent_games < 8 then 0.5 else 1.0 end * p_pair_discount;
  v_delta numeric := v_k * v_discount
    * (case when p_won then 1.0 else 0.0 end
       - public.expected_score(p_rating, p_opponent_rating));
begin
  if v_provisional then
    -- Keep most of the genuine result, bleed off a quarter of the distance to
    -- the population mean so a new account cannot run away.
    v_delta := v_delta * 0.75 + (1500 - p_rating)::numeric * 0.25;
  end if;
  return public.clamp_rating(round(p_rating + v_delta)::int);
end;
$$;

-- Sanctioned ELO for one player in one tournament result.
--
-- Deliberately does NOT reuse rate_one(): that carries casual-only behaviour --
-- provisional drift to the mean, an unproven-opponent discount, per-tag
-- weights. None of it applies to a tournament result, where both players are
-- established and the field is known.
--
-- p_opponent is the tournament's seed standard: the strongest entrant other
-- than the player themselves. A player is measured against the level of the
-- event they entered, which is what makes results from different tournaments
-- comparable. Crucially it is NOT the average of the field, so nobody gains
-- credit for an opponent they never faced.
--
-- Sanctioned ELO deliberately does NOT use rate_one(): that carries
-- casual-specific behaviour -- provisional players drifting to the mean, a
-- discount for unproven opponents, per-tag weights. None of that applies to a
-- tournament result, where both players are established.
create or replace function public.rate_sanctioned(p_rating int, p_opponent int, p_won boolean)
returns int
language plpgsql immutable
as $$
declare
  -- K=24, lower than casual's 32: one match in a tournament is a smaller
  -- sample than a head-to-head, and the seed standard is itself an estimate.
  v_k constant float := 24.0;
  v_delta numeric := v_k * ((case when p_won then 1.0 else 0.0 end)
                          - public.expected_score(p_rating, p_opponent));
begin
  return public.clamp_rating(round(p_rating + v_delta)::int);
end;
$$;

-- Seed strength for one entrant.
--
-- An earlier version rated every tournament match against the average of the
-- whole field. That is wrong for table tennis: a club event where your only
-- games are against two beginners would lift you toward the standard of the
-- open champion you never faced, so players climbed without ever beating anyone
-- stronger than themselves.
--
-- Instead, the tournament's seed order is used. The top seed is the reference
-- opponent, so beating your first-round match means beating the best player in
-- the event. This is how a real ranking ladder already works, and it makes one
-- match against a weak field meaningful without inventing a rating for anyone.
create or replace function public.seed_strength(p_tournament_id uuid, p_player_id uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (
      -- The highest-ranked entrant other than this player.
      select e.rating_snapshot
        from public.tournament_entries e
       where e.tournament_id = p_tournament_id
         and e.player_id <> p_player_id
       order by e.rating_snapshot desc, e.player_id
       limit 1
    ),
    1500
  );
$$;