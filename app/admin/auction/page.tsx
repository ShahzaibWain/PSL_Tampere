'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import TopNav from '../../components/TopNav'
import { formatMoneyWords } from '../../../lib/format'
import ConfirmModal from '../../components/ConfirmModal'
import PlayerMetaBadges from '../../components/PlayerMetaBadges'
import { requireAdminClient } from '../../../lib/auth-guards'

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
  queue_order?: number | null
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
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    const load = async () => {
      const result = await requireAdminClient()
      if (!result.ok) return

      setProfile(result.profile)
      setAuthorized(true)
      setCheckingAuth(false)
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
      if (!auctionState) return setTimeLeft(0)
      if (auctionState.status === 'paused') return setTimeLeft(auctionState.timer_seconds || DEFAULT_TIMER_SECONDS)
      if (auctionState.status !== 'running' || !auctionState.ends_at) return setTimeLeft(0)
      setTimeLeft(Math.max(0, Math.floor((new Date(auctionState.ends_at).getTime() - Date.now()) / 1000)))
    }, 1000)

    return () => clearInterval(timer)
  }, [auctionState])

  const activeTeams = useMemo(() => teams.filter((team) => !team.name.toLowerCase().includes('multan')), [teams])

  const loadAll = async () => {
    const [{ data: openPoolPlayers }, { data: teamsData }, { data: auctionData }, { data: rosterRows }] = await Promise.all([
      supabase.from('players').select('*').eq('status', 'unsold').order('queue_order', { ascending: true }),
      supabase.from('teams').select('*').order('id', { ascending: true }),
      supabase.from('auction_state').select('*').eq('id', 1).single(),
      supabase
        .from('team_players')
        .select(
          `id, team_id, player_id, bought_price, created_at, players ( id, name, category, country, availability, image_url ), teams ( id, name, logo_url )`
        )
        .order('id', { ascending: false })
        .limit(12),
    ])

    setPlayers((openPoolPlayers as Player[]) || [])
    setTeams((teamsData as Team[]) || [])
    setAuctionState(auctionData)
    setSoldRecovery((rosterRows as any[]) || [])

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

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return players
    return players.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.country || '').toLowerCase().includes(q) ||
        (p.availability || '').toLowerCase().includes(q)
    )
  }, [players, search])

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

  const pickRandomPlayer = async () => {
    if (players.length === 0 || auctionState?.current_player_id) return
    const randomIndex = Math.floor(Math.random() * players.length)
    await pickPlayer(players[randomIndex].id)
  }

  const startBidding = async () => {
    if (!auctionState?.current_player_id) return
    setBusyAction('start')
    const endsAt = new Date(Date.now() + DEFAULT_TIMER_SECONDS * 1000).toISOString()
    const { error } = await supabase.from('auction_state').update({ status: 'running', ends_at: endsAt, timer_seconds: DEFAULT_TIMER_SECONDS }).eq('id', 1)
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
    const { error } = await supabase.from('auction_state').update({ status: 'running', ends_at: updatedEndsAt, timer_seconds: nextSeconds }).eq('id', 1)
    setMessage(error ? `Could not extend timer: ${error.message}` : 'Timer increased by 30 seconds.')
    await loadAll()
    setBusyAction('')
  }

  const pauseAuction = async () => {
    if (!auctionState?.current_player_id || auctionState.status !== 'running') return
    setBusyAction('pause')
    const remaining = auctionState.ends_at ? Math.max(0, Math.floor((new Date(auctionState.ends_at).getTime() - Date.now()) / 1000)) : timeLeft
    const { error } = await supabase.from('auction_state').update({ status: 'paused', timer_seconds: remaining, ends_at: null }).eq('id', 1)
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

      await supabase.from('players').update({ status: 'unsold', sold_to_team_id: null, sold_price: null }).neq('id', 0)

      const { data: allTeams } = await supabase.from('teams').select('id, budget_total')
      await Promise.all((allTeams || []).map((team: any) => supabase.from('teams').update({ budget_remaining: team.budget_total }).eq('id', team.id)))

      await supabase.from('auction_state').update({ current_player_id: null, current_highest_bid: null, current_highest_team_id: null, status: 'idle', ends_at: null, timer_seconds: DEFAULT_TIMER_SECONDS }).eq('id', 1)

      setMessage('Full auction data reset successfully. Players were kept, and bidding/team state was cleared.')
    } catch (error: any) {
      setMessage(`Could not reset full auction data: ${error?.message || 'Unknown error'}`)
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

      const { error: playerError } = await supabase.from('players').update({ status: 'sold', sold_to_team_id: teamId, sold_price: price }).eq('id', currentPlayer.id)
      if (playerError) {
        setMessage(`Could not update player: ${playerError.message}`)
        setBusyAction('')
        return
      }

      const { error: rosterError } = await supabase.from('team_players').insert({ team_id: teamId, player_id: currentPlayer.id, bought_price: price })
      if (rosterError) {
        setMessage(`Could not add player to squad: ${rosterError.message}`)
        setBusyAction('')
        return
      }

      const { error: budgetError } = await supabase.from('teams').update({ budget_remaining: budgetAfterWin }).eq('id', teamId)
      if (budgetError) {
        setMessage(`Could not update team budget: ${budgetError.message}`)
        setBusyAction('')
        return
      }

      await supabase.from('auction_state').update({ current_player_id: null, current_highest_bid: null, current_highest_team_id: null, status: 'idle', ends_at: null, timer_seconds: DEFAULT_TIMER_SECONDS }).eq('id', 1)

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
    if (modal.key === 'sold') return runRpcAction('sold', 'admin_sold_current_player', {}, 'Player marked as sold successfully.')
    if (modal.key === 'undo') return runRpcAction('undo', 'admin_undo_last_bid', {}, 'Last bid undone successfully.')
    if (modal.key === 'reset') return runRpcAction('reset', 'admin_reset_current_player_bidding', {}, 'Current player bidding has been reset.')
    if (modal.key === 'send_to_end') return runRpcAction('send_to_end', 'admin_send_current_player_to_end', {}, 'Player sent to the end of the unsold queue.')
    if (modal.key === 'unsold') return runRpcAction('unsold', 'admin_mark_unsold_current_player', {}, 'Player marked as unsold.')
    if (modal.key === 'reopen') return runRpcAction('reopen', 'admin_reopen_player', { p_player_id: modal.playerId }, 'Player reopened and returned to the unsold pool.')
    if (modal.key === 'reset_auction') return resetFullAuctionData()
    if (modal.key === 'force_assign') return forceAssignPlayer()
  }

  const openConfirm = (key: string, opts: any = {}) => setModal({ open: true, key, ...opts })

  if (!profile) return <div className="min-h-screen bg-gray-100 flex items-center justify-center">Loading auction page...</div>

  const hasLeadingBid = !!auctionState?.current_highest_team_id
  const currentBidDisplay = hasLeadingBid ? auctionState?.current_highest_bid || currentPlayer?.base_price || 0 : currentPlayer?.base_price || 0
  const timerLabel = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <TopNav title="Auction Control" subtitle="Pick players, start bidding, manage timer, recover mistakes, and assign players manually when needed." links={links} />

        <div className="rounded-2xl bg-white p-6 shadow-sm border">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Live Auction</h2>
              {message ? <div className="mt-3 rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-700">{message}</div> : null}
            </div>

            <div className="flex flex-wrap gap-3">
              <button onClick={() => openConfirm('reset_auction', { title: 'Reset full auction data?', description: 'This will clear bids, sold squads, auction events, reset team budgets, return all players to the unsold pool, and reset the current auction state. Players will be kept.' })} disabled={busyAction === 'reset_auction'} className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-black disabled:opacity-50">
                {busyAction === 'reset_auction' ? 'Resetting...' : 'Reset Auction Data'}
              </button>

              {auctionState?.current_player_id && currentPlayer ? (
                <>
                  {auctionState.status !== 'running' ? <button onClick={startBidding} disabled={busyAction === 'start'} className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50">{busyAction === 'start' ? 'Starting...' : 'Start Bidding'}</button> : null}
                  <button onClick={extendTimerBy30Seconds} disabled={busyAction === 'extend'} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{busyAction === 'extend' ? 'Adding...' : '+30 sec'}</button>
                  <button onClick={pauseAuction} disabled={busyAction === 'pause' || auctionState.status !== 'running'} className="rounded-lg bg-slate-600 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50">{busyAction === 'pause' ? 'Pausing...' : 'Pause Bidding'}</button>
                  <button onClick={() => openConfirm('undo', { title: 'Undo last bid?', description: 'This will remove the most recent bid for the current player and update the leading team.' })} disabled={busyAction === 'undo'} className="rounded-lg bg-amber-500 px-4 py-2 font-medium text-white hover:bg-amber-600 disabled:opacity-50">Undo Last Bid</button>
                  <button onClick={() => openConfirm('reset', { title: 'Reset current player bidding?', description: 'This will delete all bids for the current player and move the auction back to paused state.' })} disabled={busyAction === 'reset'} className="rounded-lg bg-gray-700 px-4 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-50">Reset Player Bidding</button>
                  {!auctionState.current_highest_team_id ? <button onClick={() => openConfirm('send_to_end', { title: 'Send player to end?', description: 'Use this only when there are no bids. The player will go to the back of the unsold queue.' })} disabled={busyAction === 'send_to_end'} className="rounded-lg bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-50">Send To End</button> : null}
                  {!auctionState.current_highest_team_id ? <button onClick={() => openConfirm('unsold', { title: 'Mark player unsold?', description: 'This will end the current player without a sale and reset the auction.' })} disabled={busyAction === 'unsold'} className="rounded-lg bg-yellow-600 px-4 py-2 font-medium text-white hover:bg-yellow-700 disabled:opacity-50">Unsold</button> : null}
                  <button onClick={() => openConfirm('sold', { title: 'Confirm sold?', description: 'This will finalize the sale, deduct budget, add the player to the team squad, and reset the auction.' })} disabled={busyAction === 'sold' || !hasLeadingBid} className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50">Sold</button>
                </>
              ) : null}
            </div>
          </div>

          {auctionState?.current_player_id && currentPlayer ? (
            <>
              <div className="mt-4 grid gap-4 lg:grid-cols-5">
                <div className="rounded-xl bg-blue-50 p-4 border border-blue-100"><p className="text-sm text-gray-600">Current Player</p><p className="mt-1 text-xl font-bold text-gray-900">{currentPlayer.name}</p><p className="text-sm text-gray-600">{currentPlayer.category}</p><PlayerMetaBadges country={currentPlayer.country} availability={currentPlayer.availability} /></div>
                <div className="rounded-xl bg-green-50 p-4 border border-green-100"><p className="text-sm text-gray-600">Current Highest Bid</p><p className="mt-1 text-xl font-bold text-gray-900">{formatMoneyWords(currentBidDisplay)}</p></div>
                <div className="rounded-xl bg-yellow-50 p-4 border border-yellow-100"><p className="text-sm text-gray-600">Leading Team</p><p className="mt-1 text-xl font-bold text-gray-900">{currentTeam?.name || 'No bids yet'}</p></div>
                <div className="rounded-xl bg-purple-50 p-4 border border-purple-100"><p className="text-sm text-gray-600">Status</p><p className="mt-1 text-xl font-bold text-gray-900 capitalize">{auctionState.status}</p></div>
                <div className="rounded-xl bg-red-50 p-4 border border-red-100"><p className="text-sm text-gray-600">Timer</p><p className="mt-1 text-xl font-bold text-red-600">{timerLabel}</p></div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                Admin protections: Sold is disabled without a leading bid. Unsold and Send To End are only for no-bid cases. Risky actions use SQL RPC functions for safer updates. Manual assign is available below if the admin needs to correct a result manually.
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Recent Bids</h3>
                  {recentBids.length === 0 ? <p className="mt-2 text-sm text-gray-600">No bids yet for this player.</p> : (
                    <div className="mt-3 space-y-2">
                      {recentBids.map((bid) => (
                        <div key={bid.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                          <div><p className="font-medium text-gray-900">{bid.teams?.name || `Team ${bid.team_id}`}</p><p className="text-sm text-gray-600">{new Date(bid.created_at).toLocaleString()}</p></div>
                          <p className="font-semibold text-gray-900">{formatMoneyWords(bid.bid_amount)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-lg font-semibold text-slate-900">Manual Assign</h3>
                  <p className="mt-1 text-sm text-slate-600">Use this only if you need to correct a player manually. It will immediately sell the current player to the chosen team at the chosen price.</p>

                  <div className="mt-4 space-y-3">
                    <select value={forceTeamId} onChange={(e) => setForceTeamId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900">
                      <option value="">Select Team</option>
                      {activeTeams.map((team) => (
                        <option key={team.id} value={team.id}>{team.name}</option>
                      ))}
                    </select>

                    <input type="number" min="1" step="1" value={forcePrice} onChange={(e) => setForcePrice(e.target.value)} placeholder="Enter price in millions, e.g. 8" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900" />

                    <button onClick={() => openConfirm('force_assign', { title: 'Force assign current player?', description: 'This will sell the current player directly to the selected team at the entered price, clear current bids, update budget, and reset the auction.' })} disabled={busyAction === 'force_assign' || !forceTeamId || !forcePrice} className="w-full rounded-xl bg-rose-600 px-4 py-3 font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                      {busyAction === 'force_assign' ? 'Assigning...' : 'Force Assign Player'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : <p className="mt-4 text-gray-600">No player is currently picked.</p>}
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div><h2 className="text-2xl font-semibold text-gray-900">Unsold Player Pool</h2><p className="mt-1 text-gray-600">Pick a player from the unsold pool, then start bidding manually.</p></div>
            <div className="flex flex-col gap-3 md:flex-row">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search player, category, country, or availability" className="w-full md:w-80 rounded-lg border border-gray-300 px-4 py-2 text-gray-900 outline-none focus:border-blue-500" />
              <button onClick={pickRandomPlayer} disabled={!!auctionState?.current_player_id || players.length === 0} className="rounded-lg bg-fuchsia-600 px-4 py-2 font-medium text-white hover:bg-fuchsia-700 disabled:opacity-50">Random Pick</button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPlayers.map((p) => (
              <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-3 h-40 overflow-hidden rounded-lg bg-gray-100 flex items-center justify-center">{p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" /> : <span className="text-sm text-gray-500">No Image</span>}</div>
                <h3 className="text-lg font-semibold text-gray-900">{p.name}</h3>
                <p className="mt-1 text-sm text-gray-600">Category: {p.category}</p>
                <p className="mt-1 text-sm text-gray-600">Base Price: {formatMoneyWords(p.base_price)}</p>
                <PlayerMetaBadges country={p.country} availability={p.availability} />
                <button onClick={() => pickPlayer(p.id)} disabled={loadingPlayerId === p.id || !!auctionState?.current_player_id} className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">{loadingPlayerId === p.id ? 'Picking...' : 'Pick Player'}</button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div><h2 className="text-2xl font-semibold text-gray-900">Sold Players Recovery</h2><p className="mt-1 text-gray-600">Reopen a sold player if the sale was done by mistake. Latest sales appear first.</p></div>
          </div>

          {soldRecovery.length === 0 ? <p className="mt-4 text-gray-600">No sold players yet.</p> : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {soldRecovery.map((row) => (
                <div key={row.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-14 overflow-hidden rounded-xl bg-gray-100 flex items-center justify-center">{row.players?.image_url ? <img src={row.players.image_url} alt={row.players.name} className="h-full w-full object-cover" /> : <span className="text-xs text-gray-500">No Image</span>}</div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{row.players?.name || `Player #${row.player_id}`}</h3>
                      <p className="text-sm text-gray-600">{row.players?.category}</p>
                      <PlayerMetaBadges country={row.players?.country} availability={row.players?.availability} />
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-gray-600">Sold Price: {formatMoneyWords(row.bought_price || 0)}</p>
                  <p className="mt-1 text-sm text-gray-600">Team: {row.teams?.name || '-'}</p>
                  <p className="mt-1 text-xs text-gray-500">{row.created_at ? new Date(row.created_at).toLocaleString() : ''}</p>
                  <button onClick={() => openConfirm('reopen', { playerId: row.player_id, title: 'Reopen sold player?', description: 'This will refund the budget, remove the player from the squad, clear old bids, and return the player to the unsold pool.' })} disabled={busyAction === 'reopen'} className="mt-4 w-full rounded-lg bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-50">Reopen Player</button>
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
        confirmLabel={modal.key === 'sold' ? 'Confirm Sold' : modal.key === 'reopen' ? 'Reopen Player' : modal.key === 'unsold' ? 'Mark Unsold' : modal.key === 'force_assign' ? 'Force Assign' : modal.key === 'reset_auction' ? 'Reset Auction Data' : 'Confirm'}
        confirmVariant={modal.key === 'undo' || modal.key === 'reset' || modal.key === 'reset_auction' ? 'warning' : 'danger'}
        loading={busyAction === modal.key}
        onCancel={() => setModal({ open: false })}
        onConfirm={confirmAction}
      />
    </div>
  )
}
