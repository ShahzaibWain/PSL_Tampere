'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { formatMoneyWords } from '../../../lib/format'

type SaleCard = {
  id: number
  player_id: number
  team_id: number
  bought_price: number
  created_at?: string | null
  player?: any
  team?: any
}

export default function AdminLiveScreenPage() {
  const [auctionState, setAuctionState] = useState<any>(null)
  const [currentPlayer, setCurrentPlayer] = useState<any>(null)
  const [leadingTeam, setLeadingTeam] = useState<any>(null)
  const [recentBids, setRecentBids] = useState<any[]>([])
  const [timeLeft, setTimeLeft] = useState(0)
  const [teams, setTeams] = useState<any[]>([])
  const [teamPlayers, setTeamPlayers] = useState<any[]>([])
  const [soldPlayers, setSoldPlayers] = useState<SaleCard[]>([])
  const [soldCelebration, setSoldCelebration] = useState<any>(null)
  const [showLeaderFlash, setShowLeaderFlash] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const countdownStartedRef = useRef(false)
  const lastLeaderIdRef = useRef<number | null>(null)
  const lastAnimatedSaleKeyRef = useRef<string>('')

  useEffect(() => {
    audioRef.current = new Audio('/sounds/countdown.mp3')
  }, [])

  useEffect(() => {
    loadAll()

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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players' }, async (payload: any) => {
        if (payload?.old?.status !== 'sold' && payload?.new?.status === 'sold') {
          const sale = await fetchLatestSaleForPlayer(payload.new.id)
          if (sale) {
            const saleKey = `${sale.player_id}-${sale.id}`
            if (lastAnimatedSaleKeyRef.current !== saleKey) {
              lastAnimatedSaleKeyRef.current = saleKey
              setSoldCelebration(sale)
            }
          }
        }

        if (payload?.old?.status === 'sold' && payload?.new?.status !== 'sold') {
          if (soldCelebration?.player_id === payload.new.id) {
            setSoldCelebration(null)
          }
          lastAnimatedSaleKeyRef.current = ''
        }

        await loadAll()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
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
      audioRef.current.play().catch(() => {})
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
    const t = setTimeout(() => setSoldCelebration(null), 4200)
    return () => clearTimeout(t)
  }, [soldCelebration])

  const fetchLatestSaleForPlayer = async (playerId: number): Promise<SaleCard | null> => {
    const { data: row } = await supabase
      .from('team_players')
      .select('id, team_id, player_id, bought_price, created_at')
      .eq('player_id', playerId)
      .order('id', { ascending: false })
      .limit(1)
      .single()

    if (!row) return null

    const [{ data: player }, { data: team }] = await Promise.all([
      supabase.from('players').select('id, name, category, image_url').eq('id', row.player_id).single(),
      supabase.from('teams').select('id, name, logo_url').eq('id', row.team_id).single(),
    ])

    return {
      ...row,
      player,
      team,
    }
  }

  const loadAll = async () => {
    const { data: auctionData } = await supabase.from('auction_state').select('*').eq('id', 1).single()
    setAuctionState(auctionData)

    const { data: teamsData } = await supabase.from('teams').select('*').order('id', { ascending: true })
    setTeams(teamsData || [])

    const { data: teamPlayersRaw } = await supabase
      .from('team_players')
      .select('id, team_id, player_id, bought_price, created_at')
      .order('id', { ascending: false })

    const teamRows = teamPlayersRaw || []
    setTeamPlayers(teamRows)

    const playerIds = Array.from(new Set(teamRows.map((item: any) => item.player_id))).filter(Boolean)
    const teamIds = Array.from(new Set(teamRows.map((item: any) => item.team_id))).filter(Boolean)

    const [{ data: playersData }, { data: teamsForSales }] = await Promise.all([
      playerIds.length ? supabase.from('players').select('id, name, category, image_url, status').in('id', playerIds) : Promise.resolve({ data: [] as any[] }),
      teamIds.length ? supabase.from('teams').select('id, name, logo_url').in('id', teamIds) : Promise.resolve({ data: [] as any[] }),
    ])

    const playersMap = Object.fromEntries(((playersData as any[]) || []).map((item) => [item.id, item]))
    const teamsMap = Object.fromEntries(((teamsForSales as any[]) || []).map((item) => [item.id, item]))

    const recentSales = teamRows
      .map((item: any) => ({
        ...item,
        player: playersMap[item.player_id],
        team: teamsMap[item.team_id],
      }))
      .filter((item: any) => item.player?.status === 'sold')
      .slice(0, 6)

    setSoldPlayers(recentSales)

    if (auctionData?.current_player_id) {
      const { data: playerData } = await supabase.from('players').select('*').eq('id', auctionData.current_player_id).single()
      setCurrentPlayer(playerData)

      const { data: bidsData } = await supabase
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

      setRecentBids(bidsData || [])
    } else {
      setCurrentPlayer(null)
      setRecentBids([])
    }

    if (auctionData?.current_highest_team_id) {
      const { data: teamData } = await supabase.from('teams').select('*').eq('id', auctionData.current_highest_team_id).single()
      setLeadingTeam(teamData)
    } else {
      setLeadingTeam(null)
    }
  }

  const leaderboard = useMemo(() => {
    const rows = teams.map((team) => {
      const squad = teamPlayers.filter((tp) => tp.team_id === team.id)
      const playersBought = squad.length
      const totalSpent = (team.budget_total || 0) - (team.budget_remaining || 0)

      return { ...team, playersBought, totalSpent }
    })

    rows.sort((a, b) => {
      if (b.playersBought !== a.playersBought) return b.playersBought - a.playersBought
      return (b.budget_remaining || 0) - (a.budget_remaining || 0)
    })

    return rows
  }, [teams, teamPlayers])

  const timerLabel = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`
  const currentBid = auctionState?.current_highest_bid || currentPlayer?.base_price || 0
  const isIdle = !currentPlayer

  const statusBanner = isIdle
    ? 'WAITING FOR ADMIN'
    : auctionState?.status === 'paused'
    ? 'BIDDING PAUSED'
    : timeLeft === 0
    ? 'TIMER ENDED'
    : 'LIVE BIDDING'

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b,_#020617)] text-white p-8 overflow-hidden">
      {soldCelebration ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-4xl rounded-[2rem] border border-amber-300/40 bg-gradient-to-br from-amber-300 via-yellow-200 to-white p-8 text-slate-950 shadow-[0_0_80px_rgba(252,211,77,0.45)] animate-pulse">
            <div className="flex flex-col items-center gap-5 text-center lg:flex-row lg:text-left">
              <img src={soldCelebration.team?.logo_url || '/team-logos/psl.png'} alt={soldCelebration.team?.name || 'Winner'} className="h-32 w-32 rounded-full bg-white object-contain p-3 shadow-2xl" />
              <div className="flex-1">
                <p className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-700">Player Sold</p>
                <h2 className="mt-2 text-5xl font-black">{soldCelebration.player?.name}</h2>
                <p className="mt-2 text-xl font-semibold text-slate-700">{soldCelebration.player?.category}</p>
                <p className="mt-5 text-2xl font-bold">{soldCelebration.team?.name}</p>
                <p className="mt-2 text-4xl font-black text-emerald-700">{formatMoneyWords(soldCelebration.bought_price)}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-5">
            <img src="/team-logos/psl.png" alt="PSL" className="h-20 w-20 rounded-full bg-white object-contain p-2" />
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-slate-400">PSL 2026</p>
              <h1 className="mt-2 text-5xl font-bold">Live Bidding Screen</h1>
            </div>
          </div>

          <div className="rounded-3xl bg-white/10 px-8 py-5 text-right backdrop-blur">
            <p className="text-sm text-slate-300">Status</p>
            <p className="text-2xl font-bold">{statusBanner}</p>
            <p className="mt-3 text-sm text-slate-300">Timer</p>
            <p className={`text-5xl font-black ${timeLeft <= 10 && auctionState?.status === 'running' ? 'text-amber-300 animate-pulse' : 'text-rose-300'}`}>{timerLabel}</p>
          </div>
        </div>

        {currentPlayer ? (
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[2rem] bg-white/10 p-8 backdrop-blur">
              <div className="mb-5 inline-flex rounded-full bg-white/10 px-5 py-2 text-sm font-semibold tracking-[0.2em] text-slate-200">
                {statusBanner}
              </div>

              <div className="grid gap-8 md:grid-cols-2">
                <div className="h-[450px] overflow-hidden rounded-[1.5rem] bg-white/10 flex items-center justify-center">
                  {currentPlayer.image_url ? <img src={currentPlayer.image_url} alt={currentPlayer.name} className="h-full w-full object-cover" /> : <span className="text-slate-300">No Image</span>}
                </div>

                <div className="space-y-6">
                  <div>
                    <p className="text-sm text-slate-300">Player</p>
                    <p className="text-6xl font-extrabold">{currentPlayer.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-300">Category</p>
                    <p className="text-3xl font-semibold">{currentPlayer.category}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-300">Current Highest Bid</p>
                    <p className="text-6xl font-extrabold text-emerald-300">{formatMoneyWords(currentBid)}</p>
                  </div>

                  <div className={`rounded-[1.5rem] p-5 transition-all duration-500 ${showLeaderFlash ? 'bg-amber-300 text-slate-950 scale-[1.04] shadow-[0_0_40px_rgba(252,211,77,0.55)]' : 'bg-white/10'}`}>
                    <p className={`${showLeaderFlash ? 'text-slate-800' : 'text-slate-300'} text-sm`}>Leading Team</p>
                    {leadingTeam ? (
                      <div className="mt-3 flex items-center gap-4">
                        <img src={leadingTeam.logo_url || '/team-logos/psl.png'} alt={leadingTeam.name} className={`h-20 w-20 rounded-full bg-white object-contain p-2 shadow-lg ${showLeaderFlash ? 'animate-pulse' : ''}`} />
                        <div>
                          <p className="text-3xl font-extrabold">{leadingTeam.name}</p>
                          <p className="mt-1 text-sm font-semibold uppercase tracking-[0.2em]">{showLeaderFlash ? 'NEW LEADING TEAM' : 'Currently leading'}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-2xl font-bold">No bids yet</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[2rem] bg-white/10 p-6 backdrop-blur">
                <h3 className="text-2xl font-bold">Recent Bids</h3>
                {recentBids.length === 0 ? (
                  <p className="mt-4 text-slate-300">No bids yet for this player.</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {recentBids.map((bid) => (
                      <div key={bid.id} className="rounded-2xl bg-white/10 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <img src={bid.teams?.logo_url || '/team-logos/psl.png'} alt={bid.teams?.name || 'Team'} className="h-12 w-12 rounded-full bg-white object-contain p-2" />
                            <div>
                              <p className="text-lg font-bold">{bid.teams?.name || 'Unknown Team'}</p>
                              <p className="text-xs text-slate-300">{new Date(bid.created_at).toLocaleTimeString()}</p>
                            </div>
                          </div>
                          <p className="text-xl font-black text-emerald-300">{formatMoneyWords(bid.bid_amount)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-[2rem] bg-white/10 p-6 backdrop-blur">
                <h3 className="text-2xl font-bold">Leaderboard</h3>
                <div className="mt-4 space-y-3">
                  {leaderboard.slice(0, 6).map((team, index) => (
                    <div key={team.id} className="flex items-center justify-between rounded-2xl bg-white/10 p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-black">{index + 1}</div>
                        <img src={team.logo_url || '/team-logos/psl.png'} alt={team.name} className="h-12 w-12 rounded-full bg-white object-contain p-1.5" />
                        <div>
                          <p className="font-bold">{team.name}</p>
                          <p className="text-xs text-slate-300">{team.playersBought} players</p>
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-slate-200">{formatMoneyWords(team.budget_remaining)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-[2rem] bg-white/10 p-8 backdrop-blur">
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-400">Auction Idle</p>
              <h2 className="mt-4 text-4xl font-black">Waiting for admin to pick the next player</h2>
              <p className="mt-3 max-w-2xl text-lg text-slate-300">Once a player is picked, the bidding board, timer, and live leadership updates will appear here automatically.</p>

              <div className="mt-8 rounded-3xl bg-white/10 p-5">
                <h3 className="text-2xl font-bold">Leaderboard</h3>
                <div className="mt-4 space-y-3">
                  {leaderboard.slice(0, 6).map((team, index) => (
                    <div key={team.id} className="flex items-center justify-between rounded-2xl bg-white/10 p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-black">{index + 1}</div>
                        <img src={team.logo_url || '/team-logos/psl.png'} alt={team.name} className="h-12 w-12 rounded-full bg-white object-contain p-1.5" />
                        <div>
                          <p className="font-bold">{team.name}</p>
                          <p className="text-xs text-slate-300">{team.playersBought} players bought</p>
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-slate-200">{formatMoneyWords(team.budget_remaining)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] bg-white/10 p-8 backdrop-blur">
              <h3 className="text-2xl font-bold">Recent Sold Players</h3>
              {soldPlayers.length === 0 ? (
                <p className="mt-4 text-slate-300">No sold players yet.</p>
              ) : (
                <div className="mt-5 space-y-4">
                  {soldPlayers.map((item) => (
                    <div key={item.id} className="rounded-3xl bg-white/10 p-4">
                      <div className="flex items-center gap-4">
                        <div className="h-20 w-20 overflow-hidden rounded-2xl bg-white/10 flex items-center justify-center">
                          {item.player?.image_url ? <img src={item.player.image_url} alt={item.player?.name} className="h-full w-full object-cover" /> : <span className="text-xs text-slate-300">No Image</span>}
                        </div>
                        <div className="flex-1">
                          <p className="text-xl font-bold">{item.player?.name || `Player #${item.player_id}`}</p>
                          <p className="text-sm text-slate-300">{item.player?.category || '-'}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <img src={item.team?.logo_url || '/team-logos/psl.png'} alt={item.team?.name || 'Team'} className="h-8 w-8 rounded-full bg-white object-contain p-1" />
                            <p className="text-sm font-semibold">{item.team?.name || 'Unknown Team'}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black text-emerald-300">{formatMoneyWords(item.bought_price)}</p>
                          <p className="text-xs text-slate-300">{item.created_at ? new Date(item.created_at).toLocaleTimeString() : ''}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
