'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import TopNav from '../../components/TopNav'
import { formatMoneyWords } from '../../../lib/format'
import ConfirmModal from '../../components/ConfirmModal'
import PlayerMetaBadges from '../../components/PlayerMetaBadges'

type Profile = { id: string; full_name: string; role: 'admin' | 'owner' }

type Player = {
  id: number
  name: string
  category: string
  country?: string | null
  availability?: string | null
  base_price: number
  status: string
  sold_price?: number | null
  sold_to_team_id?: number | null
  image_url?: string | null
  playing_psl_first_time?: boolean | null
  queue_order?: number | null
  auction_pool?: 'main' | 'end' | 'not_sold' | null
}

type AuctionState = {
  id: number
  current_player_id: number | null
  current_highest_bid: number | null
  current_highest_team_id: number | null
  status: 'idle' | 'running' | 'paused' | 'closed'
  ends_at?: string | null
  timer_seconds?: number | null
}

type Team = {
  id: number
  name: string
  logo_url?: string | null
  budget_total?: number
  budget_remaining?: number
  max_players?: number
}

const DEFAULT_TIMER_SECONDS = 60

const links = [
  { label: 'Admin Home', href: '/admin' },
  { label: 'Auction', href: '/admin/auction' },
  { label: 'Live Screen', href: '/admin/live' },
  { label: 'Leaderboard', href: '/admin/leaderboard' },
  { label: 'Auction History', href: '/admin/history' },
  { label: 'Registered Players', href: '/players' },
]

export default function AdminAuctionPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [soldRecovery, setSoldRecovery] = useState<any[]>([])
  const [allSoldRows, setAllSoldRows] = useState<any[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [auctionState, setAuctionState] = useState<AuctionState | null>(null)
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null)
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null)
  const [recentBids, setRecentBids] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [loadingPlayerId, setLoadingPlayerId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const [busyAction, setBusyAction] = useState('')
  const [modal, setModal] = useState<any>({ open: false })

  const [forceTeamId, setForceTeamId] = useState('')
  const [forcePrice, setForcePrice] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        window.location.href = '/'
        return
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userData.user.id)
        .single()

      if (!profileData || profileData.role !== 'admin') {
        window.location.href = '/live'
        return
      }

      setProfile(profileData)
      await loadAll()
    }

    void load()

    const channel = supabase
      .channel('admin-auction-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_state' }, async () => {
        await loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids' }, async () => {
        await loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, async () => {
        await loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, async () => {
        await loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_players' }, async () => {
        await loadAll()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!auctionState) {
        setTimeLeft(0)
        return
      }

      if (auctionState.status === 'paused') {
        setTimeLeft(auctionState.timer_seconds || DEFAULT_TIMER_SECONDS)
        return
      }

      if (auctionState.status !== 'running' || !auctionState.ends_at) {
        setTimeLeft(0)
        return
      }

      setTimeLeft(Math.max(0, Math.floor((new Date(auctionState.ends_at).getTime() - Date.now()) / 1000)))
    }, 1000)

    return () => clearInterval(timer)
  }, [auctionState])

  const activeTeams = useMemo(
    () => teams.filter((team) => !team.name.toLowerCase().includes('multan')),
    [teams]
  )

  const loadAll = async () => {
    const [{ data: openPoolPlayers }, { data: teamsData }, { data: auctionData }, { data: rosterRows }] =
      await Promise.all([
        supabase
          .from('players')
          .select('*')
          .eq('status', 'unsold')
          .order('auction_pool', { ascending: true })
          .order('queue_order', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true }),
        supabase.from('teams').select('*').order('id', { ascending: true }),
        supabase.from('auction_state').select('*').eq('id', 1).single(),
        supabase
          .from('team_players')
          .select(
            `id, team_id, player_id, bought_price, created_at, players ( id, name, category, country, availability, image_url, playing_psl_first_time ), teams ( id, name, logo_url )`
          )
.order('id', { ascending: false }),
      ])

    setPlayers((openPoolPlayers as Player[]) || [])
    setTeams((teamsData as Team[]) || [])
    setAuctionState(auctionData)
    setAllSoldRows((rosterRows as any[]) || [])
    setSoldRecovery(((rosterRows as any[]) || []).slice(0, 12))

    if (auctionData?.current_player_id) {
      const [{ data: playerData }, { data: teamData }, { data: bidsData }] = await Promise.all([
        supabase.from('players').select('*').eq('id', auctionData.current_player_id).single(),
        auctionData.current_highest_team_id
          ? supabase.from('teams').select('*').eq('id', auctionData.current_highest_team_id).single()
          : Promise.resolve({ data: null }),
        supabase
          .from('bids')
          .select(`id, player_id, team_id, user_id, bid_amount, created_at, teams ( id, name )`)
          .eq('player_id', auctionData.current_player_id)
          .order('id', { ascending: false })
          .limit(10),
      ])

      setCurrentPlayer(playerData as Player)
      setCurrentTeam(teamData as Team | null)
      setRecentBids((bidsData as any[]) || [])
    } else {
      setCurrentPlayer(null)
      setCurrentTeam(null)
      setRecentBids([])
    }
  }

  const normalizedPlayers = useMemo(
    () =>
      players.map((player) => ({
        ...player,
        auction_pool: (player.auction_pool || 'main') as 'main' | 'end' | 'not_sold',
      })),
    [players]
  )

  const mainPool = useMemo(
    () => normalizedPlayers.filter((player) => player.auction_pool === 'main'),
    [normalizedPlayers]
  )

  const endPool = useMemo(
    () => normalizedPlayers.filter((player) => player.auction_pool === 'end'),
    [normalizedPlayers]
  )

  const notSoldPool = useMemo(
    () => normalizedPlayers.filter((player) => player.auction_pool === 'not_sold'),
    [normalizedPlayers]
  )

  const filterPlayers = (poolPlayers: Player[]) => {
    const q = search.trim().toLowerCase()
    if (!q) return poolPlayers

    return poolPlayers.filter(
      (player) =>
        player.name.toLowerCase().includes(q) ||
        (player.category || '').toLowerCase().includes(q) ||
        (player.country || '').toLowerCase().includes(q) ||
        (player.availability || '').toLowerCase().includes(q)
    )
  }

  const filteredMainPool = useMemo(() => filterPlayers(mainPool), [mainPool, search])
  const filteredEndPool = useMemo(() => filterPlayers(endPool), [endPool, search])
  const filteredNotSoldPool = useMemo(() => filterPlayers(notSoldPool), [notSoldPool, search])

  const teamFirstTimeStatus = useMemo(() =>
    activeTeams.map((team) => {
      const teamSoldRows = allSoldRows.filter((row: any) => row.team_id === team.id)
      const hasFirstTimePlayer = teamSoldRows.some((row: any) => !!row.players?.playing_psl_first_time)
      return {
        ...team,
        hasFirstTimePlayer,
        playersBought: teamSoldRows.length,
      }
    }),
  [activeTeams, allSoldRows])

  const actionErrorHint = 'If this action says function not found, first run the Supabase SQL setup file.'

  const pickPlayer = async (playerId: number) => {
    if (auctionState?.current_player_id) return

    setLoadingPlayerId(playerId)
    setMessage('')

    const { error } = await supabase
      .from('auction_state')
      .update({
        current_player_id: playerId,
        current_highest_bid: null,
        current_highest_team_id: null,
        status: 'paused',
        ends_at: null,
        timer_seconds: DEFAULT_TIMER_SECONDS,
      })
      .eq('id', 1)

    setMessage(error ? `Could not pick player: ${error.message}` : 'Player picked. Click Start Bidding when ready.')
    await loadAll()
    setLoadingPlayerId(null)
  }

  const pickRandomFromPool = async (pool: 'main' | 'end') => {
    if (auctionState?.current_player_id) return

    const poolPlayers = pool === 'main' ? mainPool : endPool
    if (poolPlayers.length === 0) return

    const randomIndex = Math.floor(Math.random() * poolPlayers.length)
    await pickPlayer(poolPlayers[randomIndex].id)
  }

  const startBidding = async () => {
    if (!auctionState?.current_player_id) return
    setBusyAction('start')

    const endsAt = new Date(Date.now() + DEFAULT_TIMER_SECONDS * 1000).toISOString()
    const { error } = await supabase
      .from('auction_state')
      .update({
        status: 'running',
        ends_at: endsAt,
        timer_seconds: DEFAULT_TIMER_SECONDS,
      })
      .eq('id', 1)

    setMessage(error ? `Could not start bidding: ${error.message}` : 'Bidding started.')
    await loadAll()
    setBusyAction('')
  }

  const extendTimerBy30Seconds = async () => {
    if (!auctionState?.current_player_id) return
    setBusyAction('extend')

    let nextSeconds = 30
    if (auctionState.status === 'paused') nextSeconds = (auctionState.timer_seconds || 0) + 30
    else if (auctionState.status === 'running' && timeLeft > 0) nextSeconds = timeLeft + 30

    const updatedEndsAt = new Date(Date.now() + nextSeconds * 1000).toISOString()
    const { error } = await supabase
      .from('auction_state')
      .update({
        status: 'running',
        ends_at: updatedEndsAt,
        timer_seconds: nextSeconds,
      })
      .eq('id', 1)

    setMessage(error ? `Could not extend timer: ${error.message}` : 'Timer increased by 30 seconds.')
    await loadAll()
    setBusyAction('')
  }

  const pauseAuction = async () => {
    if (!auctionState?.current_player_id || auctionState.status !== 'running') return

    setBusyAction('pause')
    const remaining = auctionState.ends_at
      ? Math.max(0, Math.floor((new Date(auctionState.ends_at).getTime() - Date.now()) / 1000))
      : timeLeft

    const { error } = await supabase
      .from('auction_state')
      .update({
        status: 'paused',
        timer_seconds: remaining,
        ends_at: null,
      })
      .eq('id', 1)

    setMessage(error ? `Could not pause bidding: ${error.message}` : 'Bidding paused.')
    await loadAll()
    setBusyAction('')
  }

  const runRpcAction = async (key: string, fn: string, args: any = {}, successMessage: string) => {
    setBusyAction(key)
    setMessage('')

    const { error } = await supabase.rpc(fn, args)

    setMessage(error ? `${error.message}. ${actionErrorHint}` : successMessage)
    setModal({ open: false })
    await loadAll()
    setBusyAction('')
  }

  const resetFullAuctionData = async () => {
    setBusyAction('reset_auction')
    setMessage('')

    try {
      await supabase.from('bids').delete().neq('id', 0)
      await supabase.from('team_players').delete().neq('id', 0)

      try {
        await supabase.from('auction_events').delete().neq('id', 0)
      } catch {}

      await supabase
        .from('players')
        .update({
          status: 'unsold',
          sold_to_team_id: null,
          sold_price: null,
          auction_pool: 'main',
          queue_order: null,
        })
        .neq('id', 0)

      const { data: allTeams } = await supabase.from('teams').select('id, budget_total')

      await Promise.all(
        (allTeams || []).map((team: any) =>
          supabase
            .from('teams')
            .update({ budget_remaining: team.budget_total })
            .eq('id', team.id)
        )
      )

      await supabase
        .from('auction_state')
        .update({
          current_player_id: null,
          current_highest_bid: null,
          current_highest_team_id: null,
          status: 'idle',
          ends_at: null,
          timer_seconds: DEFAULT_TIMER_SECONDS,
        })
        .eq('id', 1)

      setMessage('Full auction data reset successfully. All players were moved back to Main Pool.')
    } catch (error: any) {
      setMessage(`Could not reset full auction data: ${error?.message || 'Unknown error'}`)
    }

    setModal({ open: false })
    await loadAll()
    setBusyAction('')
  }

  const moveCurrentPlayerToMainPool = async () => {
    if (!auctionState?.current_player_id || !currentPlayer) return

    if (auctionState.current_highest_team_id) {
      setMessage('Send to Main Pool is only allowed when there are no bids.')
      setModal({ open: false })
      return
    }

    setBusyAction('send_to_main')
    setMessage('')

    try {
      const { data: poolRows } = await supabase
        .from('players')
        .select('queue_order')
        .eq('status', 'unsold')
        .eq('auction_pool', 'main')

      const maxQueueOrder = Math.max(
        0,
        ...(poolRows || []).map((row: any) => Number(row.queue_order) || 0)
      )

      const { error: playerError } = await supabase
        .from('players')
        .update({
          auction_pool: 'main',
          queue_order: maxQueueOrder + 1,
        })
        .eq('id', currentPlayer.id)

      if (playerError) {
        setMessage(`Could not move player to Main Pool: ${playerError.message}`)
        setBusyAction('')
        setModal({ open: false })
        return
      }

      await supabase
        .from('auction_state')
        .update({
          current_player_id: null,
          current_highest_bid: null,
          current_highest_team_id: null,
          status: 'idle',
          ends_at: null,
          timer_seconds: DEFAULT_TIMER_SECONDS,
        })
        .eq('id', 1)

      setMessage('Player moved back to Main Pool.')
    } catch (error: any) {
      setMessage(`Could not move player to Main Pool: ${error?.message || 'Unknown error'}`)
    }

    setModal({ open: false })
    await loadAll()
    setBusyAction('')
  }

  const moveCurrentPlayerToNextPool = async () => {
    if (!auctionState?.current_player_id || !currentPlayer) return

    if (auctionState.current_highest_team_id) {
      setMessage('Send to next pool is only allowed when there are no bids.')
      setModal({ open: false })
      return
    }

    setBusyAction('send_forward')
    setMessage('')

    try {
      const currentPool = currentPlayer.auction_pool || 'main'
      const nextPool = currentPool === 'main' ? 'end' : 'not_sold'

      const { data: poolRows } = await supabase
        .from('players')
        .select('queue_order')
        .eq('status', 'unsold')
        .eq('auction_pool', nextPool)

      const maxQueueOrder = Math.max(
        0,
        ...(poolRows || []).map((row: any) => Number(row.queue_order) || 0)
      )

      const { error: playerError } = await supabase
        .from('players')
        .update({
          auction_pool: nextPool,
          queue_order: maxQueueOrder + 1,
        })
        .eq('id', currentPlayer.id)

      if (playerError) {
        setMessage(`Could not move player to next pool: ${playerError.message}`)
        setBusyAction('')
        setModal({ open: false })
        return
      }

      await supabase
        .from('auction_state')
        .update({
          current_player_id: null,
          current_highest_bid: null,
          current_highest_team_id: null,
          status: 'idle',
          ends_at: null,
          timer_seconds: DEFAULT_TIMER_SECONDS,
        })
        .eq('id', 1)

      setMessage(
        nextPool === 'end'
          ? 'Player moved from Main Pool to End Queue.'
          : 'Player moved from End Queue to Not Sold Pool.'
      )
    } catch (error: any) {
      setMessage(`Could not move player to next pool: ${error?.message || 'Unknown error'}`)
    }

    setModal({ open: false })
    await loadAll()
    setBusyAction('')
  }

  const forceAssignPlayer = async () => {
    if (!auctionState?.current_player_id || !currentPlayer) return

    const teamId = Number(forceTeamId)
    const priceMillions = Number(forcePrice)
    const price = priceMillions * 1_000_000

    if (!teamId || !priceMillions || priceMillions <= 0) {
      setMessage('Select a team and enter a valid price in millions.')
      setModal({ open: false })
      return
    }

    setBusyAction('force_assign')
    setMessage('')

    try {
      const { data: selectedTeam } = await supabase.from('teams').select('*').eq('id', teamId).single()

      if (!selectedTeam) {
        setMessage('Selected team not found.')
        setBusyAction('')
        return
      }

      const { data: currentRoster } = await supabase.from('team_players').select('id').eq('team_id', teamId)
      const squadCount = currentRoster?.length || 0

      if (selectedTeam.max_players && squadCount >= selectedTeam.max_players) {
        setMessage('Force assign blocked: selected team squad is already full.')
        setBusyAction('')
        return
      }

      if ((selectedTeam.budget_remaining || 0) < price) {
        setMessage('Force assign blocked: selected team does not have enough budget.')
        setBusyAction('')
        return
      }

      const remainingSlotsAfterWin = (selectedTeam.max_players || 0) - (squadCount + 1)
      const minimumBudgetToKeep = Math.max(remainingSlotsAfterWin, 0) * 5_000_000
      const budgetAfterWin = (selectedTeam.budget_remaining || 0) - price

      if (budgetAfterWin < minimumBudgetToKeep) {
        setMessage('Force assign blocked: team must keep enough budget for remaining slots.')
        setBusyAction('')
        return
      }

      await supabase.from('bids').delete().eq('player_id', currentPlayer.id)

      const { error: playerError } = await supabase
        .from('players')
        .update({
          status: 'sold',
          sold_to_team_id: teamId,
          sold_price: price,
        })
        .eq('id', currentPlayer.id)

      if (playerError) {
        setMessage(`Could not update player: ${playerError.message}`)
        setBusyAction('')
        return
      }

      const { error: rosterError } = await supabase
        .from('team_players')
        .insert({
          team_id: teamId,
          player_id: currentPlayer.id,
          bought_price: price,
        })

      if (rosterError) {
        setMessage(`Could not add player to squad: ${rosterError.message}`)
        setBusyAction('')
        return
      }

      const { error: budgetError } = await supabase
        .from('teams')
        .update({ budget_remaining: budgetAfterWin })
        .eq('id', teamId)

      if (budgetError) {
        setMessage(`Could not update team budget: ${budgetError.message}`)
        setBusyAction('')
        return
      }

      await supabase
        .from('auction_state')
        .update({
          current_player_id: null,
          current_highest_bid: null,
          current_highest_team_id: null,
          status: 'idle',
          ends_at: null,
          timer_seconds: DEFAULT_TIMER_SECONDS,
        })
        .eq('id', 1)

      setForceTeamId('')
      setForcePrice('')
      setMessage(`Player assigned manually to ${selectedTeam.name} for ${formatMoneyWords(price)}.`)
    } catch (error: any) {
      setMessage(`Could not force assign player: ${error?.message || 'Unknown error'}`)
    }

    setModal({ open: false })
    await loadAll()
    setBusyAction('')
  }

  const confirmAction = () => {
    if (!modal?.key) return

    if (modal.key === 'sold') {
      return runRpcAction('sold', 'admin_sold_current_player', {}, 'Player marked as sold successfully.')
    }

    if (modal.key === 'undo') {
      return runRpcAction('undo', 'admin_undo_last_bid', {}, 'Last bid undone successfully.')
    }

    if (modal.key === 'reset') {
      return runRpcAction(
        'reset',
        'admin_reset_current_player_bidding',
        {},
        'Current player bidding has been reset.'
      )
    }

    if (modal.key === 'send_to_main') return moveCurrentPlayerToMainPool()
    if (modal.key === 'send_forward') return moveCurrentPlayerToNextPool()

    if (modal.key === 'reopen') {
      return runRpcAction(
        'reopen',
        'admin_reopen_player',
        { p_player_id: modal.playerId },
        'Player reopened and returned to the unsold pool.'
      )
    }

    if (modal.key === 'reset_auction') return resetFullAuctionData()
    if (modal.key === 'force_assign') return forceAssignPlayer()
  }

  const openConfirm = (key: string, opts: any = {}) => setModal({ open: true, key, ...opts })

  const renderPoolCard = (player: Player) => (
    <div key={player.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 h-40 overflow-hidden rounded-lg bg-gray-100 flex items-center justify-center">
        {player.image_url ? (
          <img src={player.image_url} alt={player.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm text-gray-500">No Image</span>
        )}
      </div>

      <h3 className="text-lg font-semibold text-gray-900">{player.name}</h3>
      <p className="mt-1 text-sm text-gray-600">Category: {player.category}</p>
      <p className="mt-1 text-sm text-gray-600">Base Price: {formatMoneyWords(player.base_price)}</p>
      <PlayerMetaBadges country={player.country} availability={player.availability} firstTimePsl={player.playing_psl_first_time} />

      <button
        onClick={() => pickPlayer(player.id)}
        disabled={loadingPlayerId === player.id || !!auctionState?.current_player_id}
        className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loadingPlayerId === player.id ? 'Picking...' : 'Pick Player'}
      </button>
    </div>
  )

  if (!profile) {
    return <div className="min-h-screen bg-gray-100 flex items-center justify-center">Loading auction page...</div>
  }

  const hasLeadingBid = !!auctionState?.current_highest_team_id
  const currentBidDisplay = hasLeadingBid
    ? auctionState?.current_highest_bid || currentPlayer?.base_price || 0
    : currentPlayer?.base_price || 0

  const timerLabel = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`

  const currentPool = currentPlayer?.auction_pool || 'main'
  const nextPoolLabel = currentPool === 'main' ? 'End Queue' : 'Not Sold Pool'
  const smartSendButtonLabel =
    currentPool === 'main' ? 'Send To End Queue' : 'Send To Not Sold Pool'

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <TopNav
          title="Auction Control"
          subtitle="Pick players, start bidding, manage timer, move players across pools, recover mistakes, and assign players manually when needed."
          links={links}
        />

        <div className="flex justify-center">
          <img src="/team-logos/sponsor.png" alt="Sponsor" className="h-16 w-auto max-w-[200px] object-contain" />
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Live Auction</h2>
              {message ? (
                <div className="mt-3 rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-700">
                  {message}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() =>
                  openConfirm('reset_auction', {
                    title: 'Reset full auction data?',
                    description:
                      'This will clear bids, sold squads, auction events, reset team budgets, return all players to Main Pool, and reset the current auction state. Players will be kept.',
                  })
                }
                disabled={busyAction === 'reset_auction'}
                className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-black disabled:opacity-50"
              >
                {busyAction === 'reset_auction' ? 'Resetting...' : 'Reset Auction Data'}
              </button>

              {auctionState?.current_player_id && currentPlayer ? (
                <>
                  {auctionState.status !== 'running' ? (
                    <button
                      onClick={startBidding}
                      disabled={busyAction === 'start'}
                      className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {busyAction === 'start' ? 'Starting...' : 'Start Bidding'}
                    </button>
                  ) : null}

                  <button
                    onClick={extendTimerBy30Seconds}
                    disabled={busyAction === 'extend'}
                    className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {busyAction === 'extend' ? 'Adding...' : '+30 sec'}
                  </button>

                  <button
                    onClick={pauseAuction}
                    disabled={busyAction === 'pause' || auctionState.status !== 'running'}
                    className="rounded-lg bg-slate-600 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {busyAction === 'pause' ? 'Pausing...' : 'Pause Bidding'}
                  </button>

                  <button
                    onClick={() =>
                      openConfirm('undo', {
                        title: 'Undo last bid?',
                        description:
                          'This will remove the most recent bid for the current player and update the leading team.',
                      })
                    }
                    disabled={busyAction === 'undo'}
                    className="rounded-lg bg-amber-500 px-4 py-2 font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    Undo Last Bid
                  </button>

                  <button
                    onClick={() =>
                      openConfirm('reset', {
                        title: 'Reset current player bidding?',
                        description:
                          'This will delete all bids for the current player and move the auction back to paused state.',
                      })
                    }
                    disabled={busyAction === 'reset'}
                    className="rounded-lg bg-gray-700 px-4 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    Reset Player Bidding
                  </button>

                  {!auctionState.current_highest_team_id ? (
                    <button
                      onClick={() =>
                        openConfirm('send_to_main', {
                          title: 'Send to Main Pool?',
                          description:
                            'Use this only when there are no bids. This will return the current player back to Main Pool.',
                        })
                      }
                      disabled={busyAction === 'send_to_main'}
                      className="rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
                    >
                      Send To Main Pool
                    </button>
                  ) : null}

                  {!auctionState.current_highest_team_id ? (
                    <button
                      onClick={() =>
                        openConfirm('send_forward', {
                          title: `${smartSendButtonLabel}?`,
                          description: `Use this only when there are no bids. This player will move from ${currentPool === 'main' ? 'Main Pool' : currentPool === 'end' ? 'End Queue' : 'Not Sold Pool'} to ${nextPoolLabel}.`,
                        })
                      }
                      disabled={busyAction === 'send_forward'}
                      className="rounded-lg bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                    >
                      {smartSendButtonLabel}
                    </button>
                  ) : null}

                  <button
                    onClick={() =>
                      openConfirm('sold', {
                        title: 'Confirm sold?',
                        description:
                          'This will finalize the sale, deduct budget, add the player to the team squad, and reset the auction.',
                      })
                    }
                    disabled={busyAction === 'sold' || !hasLeadingBid}
                    className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Sold
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {teamFirstTimeStatus.map((team) => (
              <div key={team.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <img src={team.logo_url || '/team-logos/psl.png'} alt={team.name} className="h-10 w-10 rounded-full bg-white object-contain p-1" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{team.name}</p>
                    <p className="text-xs text-slate-500">{team.playersBought} player(s) bought</p>
                  </div>
                </div>
                <p className={`mt-3 text-sm font-semibold ${team.hasFirstTimePlayer ? 'text-emerald-700' : 'text-amber-700'}`}>
                  First-time PSL player: {team.hasFirstTimePlayer ? 'Yes' : 'No'}
                </p>
              </div>
            ))}
          </div>

          {auctionState?.current_player_id && currentPlayer ? (
            <>
              <div className="mt-4 grid gap-4 lg:grid-cols-6">
                <div className="rounded-xl bg-blue-50 p-4 border border-blue-100">
                  <p className="text-sm text-gray-600">Current Player</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">{currentPlayer.name}</p>
                  <p className="text-sm text-gray-600">{currentPlayer.category}</p>
                  <PlayerMetaBadges country={currentPlayer.country} availability={currentPlayer.availability} firstTimePsl={currentPlayer.playing_psl_first_time} />
                </div>

                <div className="rounded-xl bg-sky-50 p-4 border border-sky-100">
                  <p className="text-sm text-gray-600">Current Pool</p>
                  <p className="mt-1 text-xl font-bold text-gray-900 capitalize">
                    {currentPool === 'not_sold' ? 'Not Sold' : currentPool}
                  </p>
                </div>

                <div className="rounded-xl bg-green-50 p-4 border border-green-100">
                  <p className="text-sm text-gray-600">Current Highest Bid</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">{formatMoneyWords(currentBidDisplay)}</p>
                </div>

                <div className="rounded-xl bg-yellow-50 p-4 border border-yellow-100">
                  <p className="text-sm text-gray-600">Leading Team</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">{currentTeam?.name || 'No bids yet'}</p>
                </div>

                <div className="rounded-xl bg-purple-50 p-4 border border-purple-100">
                  <p className="text-sm text-gray-600">Status</p>
                  <p className="mt-1 text-xl font-bold text-gray-900 capitalize">{auctionState.status}</p>
                </div>

                <div className="rounded-xl bg-red-50 p-4 border border-red-100">
                  <p className="text-sm text-gray-600">Timer</p>
                  <p className="mt-1 text-xl font-bold text-red-600">{timerLabel}</p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                Smart pool logic: Main Pool players move to End Queue when skipped. End Queue players move to Not Sold Pool when skipped again. You can also send any no-bid player back to Main Pool if they were picked by mistake.
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Recent Bids</h3>

                  {recentBids.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-600">No bids yet for this player.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {recentBids.map((bid) => (
                        <div
                          key={bid.id}
                          className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3"
                        >
                          <div>
                            <p className="font-medium text-gray-900">{bid.teams?.name || `Team ${bid.team_id}`}</p>
                            <p className="text-sm text-gray-600">{new Date(bid.created_at).toLocaleString()}</p>
                          </div>
                          <p className="font-semibold text-gray-900">{formatMoneyWords(bid.bid_amount)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-lg font-semibold text-slate-900">Manual Assign</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Use this only if you need to correct a player manually. It will immediately sell the current player to the chosen team at the chosen price.
                  </p>

                  <div className="mt-4 space-y-3">
                    <select
                      value={forceTeamId}
                      onChange={(e) => setForceTeamId(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900"
                    >
                      <option value="">Select Team</option>
                      {activeTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={forcePrice}
                      onChange={(e) => setForcePrice(e.target.value)}
                      placeholder="Enter price in millions, e.g. 8"
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900"
                    />

                    <button
                      onClick={() =>
                        openConfirm('force_assign', {
                          title: 'Force assign current player?',
                          description:
                            'This will sell the current player directly to the selected team at the entered price, clear current bids, update budget, and reset the auction.',
                        })
                      }
                      disabled={busyAction === 'force_assign' || !forceTeamId || !forcePrice}
                      className="w-full rounded-xl bg-rose-600 px-4 py-3 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {busyAction === 'force_assign' ? 'Assigning...' : 'Force Assign Player'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="mt-4 text-gray-600">No player is currently picked.</p>
          )}
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Player Pools</h2>
              <p className="mt-1 text-gray-600">
                Main Pool is first-pass players, End Queue is second chance, and Not Sold Pool is manual-only unless picked again.
              </p>
            </div>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search player, category, country, or availability"
              className="w-full md:w-80 rounded-lg border border-gray-300 px-4 py-2 text-gray-900 outline-none focus:border-blue-500"
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">Main Pool</h3>
                  <p className="text-sm text-slate-600">{mainPool.length} players</p>
                </div>
                <button
                  onClick={() => pickRandomFromPool('main')}
                  disabled={!!auctionState?.current_player_id || mainPool.length === 0}
                  className="rounded-lg bg-fuchsia-600 px-4 py-2 font-medium text-white hover:bg-fuchsia-700 disabled:opacity-50"
                >
                  Random Main
                </button>
              </div>

              {filteredMainPool.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600">No players in Main Pool.</p>
              ) : (
                <div className="mt-4 grid gap-4">
                  {filteredMainPool.map(renderPoolCard)}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">End Queue</h3>
                  <p className="text-sm text-slate-600">{endPool.length} players</p>
                </div>
                <button
                  onClick={() => pickRandomFromPool('end')}
                  disabled={!!auctionState?.current_player_id || endPool.length === 0}
                  className="rounded-lg bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  Random End
                </button>
              </div>

              {filteredEndPool.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600">No players in End Queue.</p>
              ) : (
                <div className="mt-4 grid gap-4">
                  {filteredEndPool.map(renderPoolCard)}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">Not Sold Pool</h3>
                  <p className="text-sm text-slate-600">{notSoldPool.length} players</p>
                </div>
              </div>

              {filteredNotSoldPool.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600">No players in Not Sold Pool.</p>
              ) : (
                <div className="mt-4 grid gap-4">
                  {filteredNotSoldPool.map(renderPoolCard)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Sold Players Recovery</h2>
              <p className="mt-1 text-gray-600">
                Reopen a sold player if the sale was done by mistake. Latest sales appear first.
              </p>
            </div>
          </div>

          {soldRecovery.length === 0 ? (
            <p className="mt-4 text-gray-600">No sold players yet.</p>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {soldRecovery.map((row) => (
                <div key={row.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-14 overflow-hidden rounded-xl bg-gray-100 flex items-center justify-center">
                      {row.players?.image_url ? (
                        <img src={row.players.image_url} alt={row.players.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs text-gray-500">No Image</span>
                      )}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {row.players?.name || `Player #${row.player_id}`}
                      </h3>
                      <p className="text-sm text-gray-600">{row.players?.category}</p>
                      <PlayerMetaBadges country={row.players?.country} availability={row.players?.availability} firstTimePsl={row.players?.playing_psl_first_time} />
                    </div>
                  </div>

                  <p className="mt-3 text-sm text-gray-600">Sold Price: {formatMoneyWords(row.bought_price || 0)}</p>
                  <p className="mt-1 text-sm text-gray-600">Team: {row.teams?.name || '-'}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {row.created_at ? new Date(row.created_at).toLocaleString() : ''}
                  </p>

                  <button
                    onClick={() =>
                      openConfirm('reopen', {
                        playerId: row.player_id,
                        title: 'Reopen sold player?',
                        description:
                          'This will refund the budget, remove the player from the squad, clear old bids, and return the player to the unsold pool.',
                      })
                    }
                    disabled={busyAction === 'reopen'}
                    className="mt-4 w-full rounded-lg bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                  >
                    Reopen Player
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={modal.open}
        title={modal.title || 'Confirm action'}
        description={modal.description}
        confirmLabel={
          modal.key === 'sold'
            ? 'Confirm Sold'
            : modal.key === 'reopen'
            ? 'Reopen Player'
            : modal.key === 'force_assign'
            ? 'Force Assign'
            : modal.key === 'reset_auction'
            ? 'Reset Auction Data'
            : modal.key === 'send_to_main'
            ? 'Send To Main Pool'
            : modal.key === 'send_forward'
            ? smartSendButtonLabel
            : 'Confirm'
        }
        confirmVariant={
          modal.key === 'undo' || modal.key === 'reset' || modal.key === 'reset_auction'
            ? 'warning'
            : 'danger'
        }
        loading={busyAction === modal.key}
        onCancel={() => setModal({ open: false })}
        onConfirm={confirmAction}
      />
    </div>
  )
}