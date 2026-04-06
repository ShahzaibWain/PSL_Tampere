'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatMoneyWords } from '../../lib/format'

const BASE_PRICE = 5_000_000
const QUICK_BIDS = [1, 2, 5, 10]

export default function LivePage() {
  const [user, setUser] = useState<any>(null)
  const [team, setTeam] = useState<any>(null)
  const [auction, setAuction] = useState<any>(null)
  const [player, setPlayer] = useState<any>(null)
  const [teamPlayers, setTeamPlayers] = useState<any[]>([])
  const [customBid, setCustomBid] = useState('')
  const [loading, setLoading] = useState(false)
  const [leadingTeam, setLeadingTeam] = useState<any>(null)
  const [recentBids, setRecentBids] = useState<any[]>([])
  const [timeLeft, setTimeLeft] = useState(0)
  const [notice, setNotice] = useState('')

  const countdownStartedRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    audioRef.current = new Audio('/sounds/countdown.mp3')
  }, [])

  useEffect(() => {
    loadData()

    const channel = supabase
      .channel('live-bidding')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_state' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_players' }, loadData)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!auction) {
        setTimeLeft(0)
        return
      }

      if (auction.status === 'paused') {
        setTimeLeft(auction.timer_seconds || 0)
        return
      }

      if (auction.status !== 'running' || !auction.ends_at) {
        setTimeLeft(0)
        return
      }

      const diff = Math.max(0, Math.floor((new Date(auction.ends_at).getTime() - Date.now()) / 1000))
      setTimeLeft(diff)
    }, 1000)

    return () => clearInterval(timer)
  }, [auction])

  useEffect(() => {
    if (!audioRef.current) return

    if (auction?.status !== 'running') {
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
  }, [timeLeft, auction?.status])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 2600)
    return () => clearTimeout(t)
  }, [notice])

  const loadData = async () => {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      window.location.href = '/'
      return
    }

    setUser(userData.user)

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userData.user.id).single()
    const { data: teamData } = await supabase.from('teams').select('*').eq('id', profile.team_id).single()

    setTeam(teamData)

    const { data: auctionData } = await supabase.from('auction_state').select('*').eq('id', 1).single()
    setAuction(auctionData)

    if (auctionData?.current_player_id) {
      const { data: playerData } = await supabase.from('players').select('*').eq('id', auctionData.current_player_id).single()
      setPlayer(playerData)

      const { data: bidsData } = await supabase
        .from('bids')
        .select(`
          id,
          bid_amount,
          created_at,
          team_id,
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
      setPlayer(null)
      setRecentBids([])
    }

    if (auctionData?.current_highest_team_id) {
      const { data: leadTeam } = await supabase.from('teams').select('*').eq('id', auctionData.current_highest_team_id).single()
      setLeadingTeam(leadTeam)
    } else {
      setLeadingTeam(null)
    }

    const { data: tp } = await supabase
      .from('team_players')
      .select(`
        id,
        team_id,
        player_id,
        bought_price,
        players (
          id,
          name,
          category,
          image_url
        )
      `)
      .eq('team_id', teamData.id)
      .order('id', { ascending: false })

    setTeamPlayers(tp || [])
  }

  const currentBid = auction?.current_highest_bid || player?.base_price || 0
  const isMyTeamLeading = auction?.current_highest_team_id === team?.id
  const remainingSlots = team ? Math.max(team.max_players - teamPlayers.length, 0) : 0
  const remainingSlotsIfWin = team ? Math.max(team.max_players - (teamPlayers.length + 1), 0) : 0
  const reserveIfWin = remainingSlotsIfWin * BASE_PRICE
  const committedBid = isMyTeamLeading ? currentBid : 0
  const usableBudget = team ? Math.max(team.budget_remaining - reserveIfWin - committedBid, 0) : 0

  const bidDisabledReason = useMemo(() => {
    if (!player) return 'Waiting for admin to pick the next player.'
    if (auction?.status === 'paused') return 'Bidding is paused by admin.'
    if (auction?.status !== 'running') return 'Bidding has not started yet.'
    if (timeLeft <= 0) return 'Timer has reached zero. Wait for admin action.'
    if (isMyTeamLeading) return 'Your team is already leading.'
    if (teamPlayers.length >= (team?.max_players || 0)) return 'Your squad is already full.'
    return ''
  }, [auction?.status, isMyTeamLeading, player, team?.max_players, teamPlayers.length, timeLeft])

  const canBid = !bidDisabledReason

  const placeBid = async (incrementMillions: number) => {
    if (!canBid) return

    const increment = incrementMillions * 1_000_000
    const newBid = currentBid + increment

    if (newBid > team.budget_remaining) {
      setNotice('Not enough total budget.')
      return
    }
    if (newBid > usableBudget) {
      setNotice('Not enough live usable bidding budget.')
      return
    }

    setLoading(true)

    const { error: bidError } = await supabase.from('bids').insert({
      player_id: player.id,
      team_id: team.id,
      user_id: user.id,
      bid_amount: newBid,
    })

    if (bidError) {
      setNotice(bidError.message)
      setLoading(false)
      return
    }

    await supabase
      .from('auction_state')
      .update({
        current_highest_bid: newBid,
        current_highest_team_id: team.id,
        ends_at: new Date(Date.now() + 60_000).toISOString(),
        timer_seconds: 60,
      })
      .eq('id', 1)

    setLoading(false)
    setNotice('Bid placed successfully.')
  }

  const buyAtBase = async () => {
    if (!canBid || auction.current_highest_bid) return
    if (player.base_price > team.budget_remaining) {
      setNotice('Not enough budget.')
      return
    }
    if (player.base_price > usableBudget) {
      setNotice('Not enough live usable bidding budget.')
      return
    }

    setLoading(true)
    const { error: bidError } = await supabase.from('bids').insert({
      player_id: player.id,
      team_id: team.id,
      user_id: user.id,
      bid_amount: player.base_price,
    })

    if (bidError) {
      setNotice(bidError.message)
      setLoading(false)
      return
    }

    await supabase
      .from('auction_state')
      .update({
        current_highest_bid: player.base_price,
        current_highest_team_id: team.id,
        ends_at: new Date(Date.now() + 60_000).toISOString(),
        timer_seconds: 60,
      })
      .eq('id', 1)

    setLoading(false)
    setNotice('Base price buy submitted.')
  }

  const placeCustomBid = async () => {
    const value = parseInt(customBid)
    if (!value || value <= 0) return
    await placeBid(value)
    setCustomBid('')
  }

  const timerLabel = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`

  if (!team) return <div className="p-6">Loading...</div>

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <div className="rounded-3xl bg-gradient-to-r from-slate-900 to-slate-800 text-white p-6 shadow-lg">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <img src="/team-logos/psl.png" alt="PSL" className="h-16 w-16 rounded-full bg-white object-contain p-1" />
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-slate-300">PSL 2026</p>
                <h1 className="text-3xl font-bold">Live Auction</h1>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-white/10 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.15em] text-slate-300">Team</p>
                <p className="text-lg font-bold">{team.name}</p>
              </div>
              <div className="rounded-2xl bg-white/10 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.15em] text-slate-300">Remaining Budget</p>
                <p className="text-lg font-bold">{formatMoneyWords(team.budget_remaining)}</p>
              </div>
              <div className="rounded-2xl bg-white/10 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.15em] text-slate-300">Live Usable</p>
                <p className="text-lg font-bold">{formatMoneyWords(usableBudget)}</p>
              </div>
            </div>
          </div>
        </div>

        {notice ? <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{notice}</div> : null}

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
              {!player ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">Auction Idle</p>
                  <h2 className="mt-3 text-3xl font-bold text-slate-900">Waiting for the next player</h2>
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-[240px_1fr]">
                  <div className="h-72 overflow-hidden rounded-3xl bg-slate-100 flex items-center justify-center">
                    {player.image_url ? <img src={player.image_url} alt={player.name} className="h-full w-full object-cover" /> : <span className="text-slate-500">No Image</span>}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] ${auction?.status === 'running' ? 'bg-emerald-50 text-emerald-700' : auction?.status === 'paused' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                        {auction?.status || 'idle'}
                      </span>
                      {isMyTeamLeading ? <span className="rounded-full bg-blue-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-blue-700">You are leading</span> : null}
                    </div>

                    <h2 className="mt-4 text-4xl font-black text-slate-900">{player.name}</h2>
                    <p className="mt-2 text-lg text-slate-500">{player.category}</p>

                    <div className="mt-6 grid gap-4 sm:grid-cols-3">
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-sm text-slate-500">Current Bid</p>
                        <p className="mt-1 text-2xl font-black text-slate-900">{formatMoneyWords(currentBid)}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-sm text-slate-500">Leading Team</p>
                        <p className="mt-1 text-xl font-bold text-slate-900">{leadingTeam?.name || 'No bids yet'}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <p className="text-sm text-slate-500">Timer</p>
                        <p className={`mt-1 text-3xl font-black ${timeLeft <= 10 && auction?.status === 'running' ? 'text-red-600' : 'text-slate-900'}`}>{timerLabel}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
              <h3 className="text-2xl font-bold text-slate-900">Bid Controls</h3>
              <p className="mt-1 text-slate-500">Use quick increments or enter a custom amount in millions.</p>

              {bidDisabledReason ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{bidDisabledReason}</div> : null}

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {!auction?.current_highest_bid && player ? (
                  <button onClick={buyAtBase} disabled={!canBid || loading} className="rounded-2xl bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Buy at Base Price</button>
                ) : null}

                {QUICK_BIDS.map((value) => (
                  <button key={value} onClick={() => placeBid(value)} disabled={!canBid || loading} className="rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">+{value}M</button>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input value={customBid} onChange={(e) => setCustomBid(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Custom bid in millions" className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-500" />
                <button onClick={placeCustomBid} disabled={!canBid || loading} className="rounded-2xl bg-slate-900 px-5 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50">Place Custom Bid</button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
              <h3 className="text-2xl font-bold text-slate-900">Team Snapshot</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Players Bought</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{teamPlayers.length} / {team.max_players}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Reserved Minimum</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{formatMoneyWords(remainingSlots * BASE_PRICE)}</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
              <h3 className="text-2xl font-bold text-slate-900">Recent Bids</h3>
              {recentBids.length === 0 ? <p className="mt-4 text-slate-500">No bids yet for this player.</p> : (
                <div className="mt-4 space-y-3">
                  {recentBids.map((bid) => (
                    <div key={bid.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <img src={bid.teams?.logo_url || '/team-logos/psl.png'} alt={bid.teams?.name || 'Team'} className="h-10 w-10 rounded-full bg-slate-100 object-contain p-1" />
                          <div>
                            <p className="font-semibold text-slate-900">{bid.teams?.name || 'Unknown Team'}</p>
                            <p className="text-xs text-slate-500">{new Date(bid.created_at).toLocaleTimeString()}</p>
                          </div>
                        </div>
                        <p className="text-lg font-black text-slate-900">{formatMoneyWords(bid.bid_amount)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
