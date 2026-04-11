"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { formatMoneyWords } from '../../../lib/format'
import { requireAdminClient } from '../../../lib/auth-guards'

const isHiddenTeam = (team: any) => ((team?.name || '') as string).toLowerCase().includes('multan')

export default function AdminLiveScreenPage() {
  const [auctionState, setAuctionState] = useState<any>(null)
  const [currentPlayer, setCurrentPlayer] = useState<any>(null)
  const [leadingTeam, setLeadingTeam] = useState<any>(null)
  const [recentBids, setRecentBids] = useState<any[]>([])
  const [timeLeft, setTimeLeft] = useState(0)
  const [teams, setTeams] = useState<any[]>([])
  const [teamPlayers, setTeamPlayers] = useState<any[]>([])
  const [soldPlayers, setSoldPlayers] = useState<any[]>([])
  const [selectedTeam, setSelectedTeam] = useState<any | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  const countdownStartedRef = useRef(false)
  const lastLeaderIdRef = useRef<number | null>(null)
  const [showLeaderFlash, setShowLeaderFlash] = useState(false)
  const [soldCelebration, setSoldCelebration] = useState<any | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastSoldPlayerIdRef = useRef<number | null>(null)

  const showSoldCelebrationForPlayer = async (playerRow: any) => {
    if (!playerRow?.id) return
    if (lastSoldPlayerIdRef.current === playerRow.id) return

    const teamId = playerRow.sold_to_team_id
    let soldTeam = null

    if (teamId) {
      const { data: teamData } = await supabase
        .from('teams')
        .select('id, name, logo_url')
        .eq('id', teamId)
        .single()

      soldTeam = teamData || null
    }

    if (isHiddenTeam(soldTeam)) return

    lastSoldPlayerIdRef.current = playerRow.id
    setSoldCelebration({
      ...playerRow,
      teams: soldTeam,
    })
  }

  useEffect(() => {
    audioRef.current = new Audio('/sounds/countdown.mp3')
  }, [])

  useEffect(() => {
    const init = async () => {
      const result = await requireAdminClient()
      if (!result.ok) return

      setAuthorized(true)
      setCheckingAuth(false)
      await loadAll()
    }

    void init()

    const channel = supabase
      .channel('admin-live-screen')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_state' }, async () => {
        await loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids' }, async () => {
        await loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, async () => {
        await loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_players' }, async () => {
        await loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, async (payload) => {
        const nextRow = (payload as any)?.new
        const previousRow = (payload as any)?.old

        if (nextRow?.status === 'sold' && previousRow?.status !== 'sold') {
          await showSoldCelebrationForPlayer(nextRow)
        }

        if (nextRow?.status !== 'sold' && previousRow?.status === 'sold' && lastSoldPlayerIdRef.current === nextRow?.id) {
          lastSoldPlayerIdRef.current = null
        }

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
        setTimeLeft(auctionState.timer_seconds || 0)
        return
      }

      if (auctionState.status !== 'running' || !auctionState.ends_at) {
        setTimeLeft(0)
        return
      }

      const diff = Math.max(0, Math.floor((new Date(auctionState.ends_at).getTime() - Date.now()) / 1000))
      setTimeLeft(diff)
    }, 1000)

    return () => clearInterval(timer)
  }, [auctionState])

  useEffect(() => {
    if (!audioRef.current) return

    if (auctionState?.status !== 'running') {
      countdownStartedRef.current = false
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      return
    }

    if (timeLeft <= 10 && timeLeft > 0 && !countdownStartedRef.current) {
      countdownStartedRef.current = true
      audioRef.current.currentTime = 0
      void audioRef.current.play().catch(() => {})
    }

    if (timeLeft > 10) {
      countdownStartedRef.current = false
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }

    if (timeLeft === 0) countdownStartedRef.current = false
  }, [timeLeft, auctionState?.status])

  useEffect(() => {
    if (!leadingTeam?.id) return

    if (lastLeaderIdRef.current !== null && lastLeaderIdRef.current !== leadingTeam.id) {
      setShowLeaderFlash(true)
      const t = setTimeout(() => setShowLeaderFlash(false), 2200)
      lastLeaderIdRef.current = leadingTeam.id
      return () => clearTimeout(t)
    }

    lastLeaderIdRef.current = leadingTeam.id
  }, [leadingTeam?.id])

  useEffect(() => {
    if (!soldCelebration) return
    const timer = setTimeout(() => setSoldCelebration(null), 4500)
    return () => clearTimeout(timer)
  }, [soldCelebration])

  const loadAll = async () => {
    const { data: auctionData } = await supabase.from('auction_state').select('*').eq('id', 1).single()
    setAuctionState(auctionData)

    const { data: teamsDataRaw } = await supabase.from('teams').select('*').order('id', { ascending: true })
    const teamsData = (teamsDataRaw || []).filter((team: any) => !isHiddenTeam(team))

    const { data: teamPlayersDataRaw } = await supabase
      .from('team_players')
      .select(`
        id,
        team_id,
        player_id,
        bought_price,
        created_at,
        players (
          id,
          name,
          category,
          country,
          availability,
          image_url,
          status,
          playing_psl_first_time
        ),
        teams (
          id,
          name,
          logo_url
        )
      `)
      .order('id', { ascending: false })

    const teamPlayersData = (teamPlayersDataRaw || []).filter((row: any) => !isHiddenTeam(row.teams))

    const soldPlayersData = teamPlayersData
      .filter((entry: any) => entry.players?.status === 'sold')
      .slice(0, 6)
      .map((entry: any) => ({
        id: entry.players?.id,
        name: entry.players?.name,
        category: entry.players?.category,
        country: entry.players?.country,
        availability: entry.players?.availability,
        image_url: entry.players?.image_url,
        sold_price: entry.bought_price,
        teams: entry.teams,
        sale_entry_id: entry.id,
      }))

    setTeams(teamsData)
    setTeamPlayers(teamPlayersData)
    setSoldPlayers(soldPlayersData)

    if (auctionData?.current_player_id) {
      const { data: playerData } = await supabase.from('players').select('*').eq('id', auctionData.current_player_id).single()
      setCurrentPlayer(playerData)

      const { data: bidsDataRaw } = await supabase
        .from('bids')
        .select(`
          id,
          bid_amount,
          created_at,
          teams (
            id,
            name,
            logo_url
          )
        `)
        .eq('player_id', auctionData.current_player_id)
        .order('id', { ascending: false })
        .limit(8)

      setRecentBids((bidsDataRaw || []).filter((bid: any) => !isHiddenTeam(bid.teams)))
    } else {
      setCurrentPlayer(null)
      setRecentBids([])
    }

    if (auctionData?.current_highest_team_id) {
      const { data: teamData } = await supabase.from('teams').select('*').eq('id', auctionData.current_highest_team_id).single()
      setLeadingTeam(isHiddenTeam(teamData) ? null : teamData)
    } else {
      setLeadingTeam(null)
    }
  }

  const leaderboard = useMemo(() => {
    const rows = teams.map((team) => {
      const squad = teamPlayers.filter((tp) => tp.team_id === team.id)
      const playersBought = squad.length
      const totalSpent = (team.budget_total || 0) - (team.budget_remaining || 0)
      const hasFirstTimePlayer = squad.some((tp: any) => !!tp.players?.playing_psl_first_time)
      return { ...team, playersBought, totalSpent, hasFirstTimePlayer }
    })

    rows.sort((a, b) => {
      if (b.playersBought !== a.playersBought) return b.playersBought - a.playersBought
      return b.budget_remaining - a.budget_remaining
    })

    return rows
  }, [teams, teamPlayers])

  const selectedTeamPlayers = useMemo(() => {
    if (!selectedTeam) return []
    return teamPlayers.filter((tp) => tp.team_id === selectedTeam.id)
  }, [selectedTeam, teamPlayers])

  const timerLabel = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`
  const currentBid = auctionState?.current_highest_bid || currentPlayer?.base_price || 0

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center text-slate-700">
        Checking access...
      </div>
    )
  }

  if (!authorized) return null

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b,_#020617)] p-8 text-white">
      {soldCelebration ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-950/92 px-4">
          <div className="w-full max-w-4xl rounded-[2.5rem] border border-amber-300/35 bg-[linear-gradient(135deg,_rgba(251,191,36,0.24),_rgba(15,23,42,0.94))] p-8 text-center shadow-[0_0_80px_rgba(251,191,36,0.18)] backdrop-blur">
            <p className="animate-pulse text-lg font-black uppercase tracking-[0.5em] text-amber-300">Sold</p>
            <div className="mt-6 flex flex-col items-center gap-5">
              <img src={soldCelebration.teams?.logo_url || '/team-logos/psl.png'} alt={soldCelebration.teams?.name || 'Winning Team'} className="h-32 w-32 rounded-full bg-white object-contain p-3 shadow-2xl ring-4 ring-amber-300/40 animate-bounce" />
              <div className="min-w-0 max-w-full">
                <p className="text-sm uppercase tracking-[0.35em] text-slate-300">Winning Team</p>
                <p className="mt-2 break-words text-4xl font-extrabold text-white md:text-5xl">{soldCelebration.teams?.name || 'Unknown Team'}</p>
              </div>
              <div className="min-w-0 max-w-full">
                <p className="text-sm uppercase tracking-[0.35em] text-slate-300">Player</p>
                <p className="mt-2 break-words text-4xl font-extrabold text-amber-200 md:text-5xl">{soldCelebration.name}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-200">{soldCelebration.category}</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {soldCelebration.country ? <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-slate-100">{soldCelebration.country}</span> : null}
                  <span className={`rounded-full px-3 py-1 text-sm font-medium ${(soldCelebration.availability || 'Available All Days').toLowerCase() === 'available all days' ? 'bg-emerald-300/20 text-emerald-200' : 'bg-amber-300/20 text-amber-200'}`}>
                    {soldCelebration.availability || 'Available All Days'}
                  </span>
                </div>
              </div>
              <div className="rounded-[1.75rem] border border-white/10 bg-white/10 px-8 py-5">
                <p className="text-sm uppercase tracking-[0.35em] text-slate-300">Sold Price</p>
                <p className="mt-2 break-words text-4xl font-extrabold text-emerald-300 md:text-5xl">{formatMoneyWords(soldCelebration.sold_price || 0)}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedTeam ? (
        <div onClick={() => setSelectedTeam(null)} className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl rounded-3xl bg-slate-900 p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <img src={selectedTeam.logo_url || '/team-logos/psl.png'} alt={selectedTeam.name} className="h-14 w-14 rounded-full bg-white object-contain p-1" />
                <div>
                  <h2 className="text-2xl font-bold">{selectedTeam.name} Squad</h2>
                  <p className="text-sm text-slate-300">{selectedTeamPlayers.length} players bought</p>
                </div>
              </div>
              <button onClick={() => setSelectedTeam(null)} className="rounded-full bg-white/10 px-3 py-1 text-sm text-slate-300 hover:bg-white/20 hover:text-white">Close</button>
            </div>

            <div className="mt-5 max-h-[460px] space-y-3 overflow-y-auto pr-1">
              {selectedTeamPlayers.length === 0 ? (
                <p className="text-slate-400">No players bought yet.</p>
              ) : (
                selectedTeamPlayers.map((tp: any) => (
                  <div key={tp.id} className="flex items-center justify-between gap-4 rounded-2xl bg-slate-800 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/10 flex items-center justify-center">
                        {tp.players?.image_url ? <img src={tp.players.image_url} alt={tp.players?.name} className="h-full w-full object-cover" /> : <span className="text-[10px] text-slate-400">No Image</span>}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-lg font-semibold">{tp.players?.name || `Player #${tp.player_id}`}</p>
                        <p className="text-sm text-slate-400">{tp.players?.category || '-'}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {tp.players?.country ? <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-slate-200">{tp.players.country}</span> : null}
                          <span className={`rounded-full px-2 py-1 text-xs ${(tp.players?.availability || 'Available All Days').toLowerCase() === 'available all days' ? 'bg-emerald-300/20 text-emerald-200' : 'bg-amber-300/20 text-amber-200'}`}>{tp.players?.availability || 'Available All Days'}</span>
                        </div>
                      </div>
                    </div>
                    <p className="shrink-0 text-lg font-bold text-emerald-400">{formatMoneyWords(tp.bought_price)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl space-y-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="flex min-w-0 items-center gap-5">
            <img src="/team-logos/psl.png" alt="PSL" className="h-20 w-20 rounded-full bg-white object-contain p-2" />
            <div className="min-w-0">
              <p className="text-sm uppercase tracking-[0.3em] text-slate-400">PSL 2026</p>
              <h1 className="mt-2 text-5xl font-bold">Live Bidding Screen</h1>
            </div>
          </div>

          <div className="flex justify-center">
            <img src="/team-logos/sponsor.png" alt="Sponsor" className="h-20 w-auto max-w-[220px] object-contain" />
          </div>

          <div className="shrink-0 rounded-3xl bg-white/10 px-8 py-5 text-right backdrop-blur lg:justify-self-end">
            <p className="text-sm text-slate-300">Status</p>
            <p className="text-2xl font-bold capitalize">{auctionState?.status || 'idle'}</p>
            <p className="mt-3 text-sm text-slate-300">Timer</p>
            <p className="text-4xl font-bold text-rose-300">{timerLabel}</p>
          </div>
        </div>

        {currentPlayer ? (
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[2rem] bg-white/10 p-8 backdrop-blur">
              <div className="grid gap-8 md:grid-cols-2 md:items-start">
                <div className="flex h-[450px] items-center justify-center overflow-hidden rounded-[1.5rem] bg-white/10">
                  {currentPlayer.image_url ? <img src={currentPlayer.image_url} alt={currentPlayer.name} className="h-full w-full object-cover" /> : <span className="text-slate-300">No Image</span>}
                </div>

                <div className="min-w-0 space-y-5">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-300">Player</p>
                    <p className="mt-1 max-w-full break-words text-3xl font-extrabold leading-[0.95] md:text-4xl lg:text-[3.1rem]">{currentPlayer.name}</p>
                  </div>

                  <div>
                    <p className="text-sm text-slate-300">Category</p>
                    <p className="text-2xl font-semibold lg:text-[2rem]">{currentPlayer.category}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {currentPlayer.country ? <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-slate-100">{currentPlayer.country}</span> : null}
                      <span className={`rounded-full px-3 py-1 text-sm font-medium ${(currentPlayer.availability || 'Available All Days').toLowerCase() === 'available all days' ? 'bg-emerald-300/20 text-emerald-200' : 'bg-amber-300/20 text-amber-200'}`}>{currentPlayer.availability || 'Available All Days'}</span>
                      <span className={`rounded-full px-3 py-1 text-sm font-medium ${currentPlayer.playing_psl_first_time ? 'bg-violet-300/20 text-violet-200' : 'bg-slate-300/20 text-slate-200'}`}>PSL First Time: {currentPlayer.playing_psl_first_time ? 'Yes' : 'No'}</span>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm text-slate-300">Current Highest Bid</p>
                    <p className="max-w-full break-words text-3xl font-extrabold leading-[0.95] text-emerald-300 md:text-4xl lg:text-[3.1rem]">{formatMoneyWords(currentBid)}</p>
                  </div>

                  <div className={`rounded-[1.5rem] p-5 transition-all duration-500 ${showLeaderFlash ? 'scale-[1.04] bg-amber-300 text-slate-950 shadow-[0_0_40px_rgba(252,211,77,0.55)]' : 'bg-white/10'}`}>
                    <p className={`${showLeaderFlash ? 'text-slate-800' : 'text-slate-300'} text-sm`}>Leading Team</p>
                    {leadingTeam ? (
                      <div className="mt-3 flex items-center gap-4">
                        <img src={leadingTeam.logo_url || '/team-logos/psl.png'} alt={leadingTeam.name} className={`h-16 w-16 shrink-0 rounded-full bg-white object-contain p-2 shadow-lg ${showLeaderFlash ? 'animate-pulse' : ''}`} />
                        <div className="min-w-0 flex-1">
                          <p className="max-w-full break-words text-2xl font-extrabold leading-tight lg:text-[2rem]">{leadingTeam.name}</p>
                          <p className="mt-1 text-sm font-semibold">{showLeaderFlash ? 'NEW LEADING TEAM' : 'Highest current bidder'}</p>
                        </div>
                      </div>
                    ) : <p className="mt-2 text-xl font-bold">No bids yet</p>}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] bg-white/10 p-8 backdrop-blur">
              <h2 className="text-3xl font-bold">Recent Bids</h2>
              {recentBids.length === 0 ? <p className="mt-5 text-slate-300">No bids yet.</p> : (
                <div className="mt-6 space-y-4">
                  {recentBids.map((bid) => (
                    <div key={bid.id} className="rounded-[1.5rem] border border-white/10 bg-slate-950/40 px-5 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex items-center gap-3">
                          <img src={bid.teams?.logo_url || '/team-logos/psl.png'} alt={bid.teams?.name || 'Team'} className="h-12 w-12 shrink-0 rounded-full bg-white object-contain p-1" />
                          <div className="min-w-0">
                            <p className="truncate text-2xl font-bold">{bid.teams?.name || 'Unknown Team'}</p>
                            <p className="text-sm text-slate-300">{new Date(bid.created_at).toLocaleString()}</p>
                          </div>
                        </div>
                        <p className="shrink-0 text-3xl font-extrabold text-emerald-300">{formatMoneyWords(bid.bid_amount)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="rounded-[2rem] bg-white/10 p-10 text-center backdrop-blur">
              <p className="text-3xl font-bold">Waiting for admin to pick the next player</p>
              <p className="mt-3 text-slate-300">Current auction is idle. Team standings are shown below.</p>
            </div>

            <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-[2rem] bg-white/10 p-8 backdrop-blur">
                <h2 className="text-3xl font-bold">Leaderboard</h2>
                <div className="mt-6 space-y-4">
                  {leaderboard.slice(0, 6).map((team, index) => (
                    <button key={team.id} onClick={() => setSelectedTeam(team)} className="w-full rounded-[1.5rem] border border-white/10 bg-slate-950/40 px-5 py-4 text-left transition hover:scale-[1.02] hover:bg-slate-950/55">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex items-center gap-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white font-bold text-slate-900">{index + 1}</div>
                          <img src={team.logo_url || '/team-logos/psl.png'} alt={team.name} className="h-12 w-12 shrink-0 rounded-full bg-white object-contain p-1" />
                          <div className="min-w-0">
                            <p className="truncate text-2xl font-bold">{team.name}</p>
                            <p className="text-sm text-slate-300">{team.playersBought} players • {formatMoneyWords(team.budget_remaining)} left</p>
                            <p className={`text-sm font-semibold ${team.hasFirstTimePlayer ? 'text-emerald-300' : 'text-amber-300'}`}>★ First-time player: {team.hasFirstTimePlayer ? 'Yes' : 'No'}</p>
                          </div>
                        </div>
                        <p className="shrink-0 text-xl font-bold text-emerald-300">{formatMoneyWords(team.totalSpent)} spent</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] bg-white/10 p-8 backdrop-blur">
                <h2 className="text-3xl font-bold">Recent Sold Players</h2>
                {soldPlayers.length === 0 ? <p className="mt-5 text-slate-300">No players sold yet.</p> : (
                  <div className="mt-6 space-y-4">
                    {soldPlayers.map((player) => (
                      <div key={player.sale_entry_id || player.id} className="rounded-[1.5rem] border border-white/10 bg-slate-950/40 px-5 py-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 flex items-center gap-4">
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white">
                              {player.image_url ? <img src={player.image_url} alt={player.name} className="h-full w-full object-cover" /> : <span className="text-[10px] text-slate-500">No Image</span>}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-2xl font-bold">{player.name}</p>
                              <div className="mt-1 flex items-center gap-2">
                                <img src={player.teams?.logo_url || '/team-logos/psl.png'} alt={player.teams?.name || 'Team'} className="h-8 w-8 shrink-0 rounded-full bg-white object-contain p-1" />
                                <p className="truncate text-sm text-slate-300">{player.teams?.name || 'Unknown Team'}</p>
                              </div>
                            </div>
                          </div>
                          <p className="shrink-0 text-2xl font-extrabold text-emerald-300">{formatMoneyWords(player.sold_price)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
