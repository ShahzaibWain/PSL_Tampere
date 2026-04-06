-- Supabase changes needed for the new pages
-- Run these only if you want to keep a single open-player status: unsold.

-- 1) Convert any existing available players to unsold.
update public.players
set status = 'unsold'
where status = 'available';

-- 2) Update the reopen RPC so reopened players go back to the unsold pool.
create or replace function public.admin_reopen_player(p_player_id bigint)
returns void
language plpgsql
as $$
declare
  v_player public.players%rowtype;
  v_team public.teams%rowtype;
  v_latest_team_player public.team_players%rowtype;
begin
  select * into v_player from public.players where id = p_player_id for update;
  if v_player.id is null then
    raise exception 'Player not found';
  end if;
  if v_player.status <> 'sold' then
    raise exception 'Only sold players can be reopened';
  end if;

  select * into v_team from public.teams where id = v_player.sold_to_team_id for update;
  if v_team.id is null then
    raise exception 'Winning team not found';
  end if;

  select * into v_latest_team_player
  from public.team_players
  where player_id = p_player_id and team_id = v_player.sold_to_team_id
  order by id desc
  limit 1
  for update;

  if v_latest_team_player.id is null then
    raise exception 'Team roster record not found';
  end if;

  update public.teams
  set budget_remaining = coalesce(budget_remaining, 0) + coalesce(v_player.sold_price, 0)
  where id = v_team.id;

  delete from public.team_players where id = v_latest_team_player.id;
  delete from public.bids where player_id = p_player_id;

  update public.players
  set status = 'unsold',
      sold_to_team_id = null,
      sold_price = null
  where id = p_player_id;

  insert into public.auction_events(player_id, team_id, event_type, amount)
  values (p_player_id, v_team.id, 'reopened', v_player.sold_price);
end;
$$;
