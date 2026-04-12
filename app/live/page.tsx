'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import PlayerMetaBadges from '../components/PlayerMetaBadges'
import { formatMoneyWords } from '../../lib/format'

const isHiddenTeam = (team: any) => ((team?.name || '') as string).toLowerCase().includes('multan')
const BASE_PRICE = 5_000_000
const BID_LOCK_MS = 1000

type FlashMessage = {
  type: 'success' | 'error' | 'info'
  text: string
}

export default function LivePage() {
  const router = useRouter()

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
  const [bidLockedUntil, setBidLockedUntil] = useState<number>(0)
  const [flash, setFlash] = useState<FlashMessage | null>(null)

  const countdownStartedRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const flashTimeoutRef = useRef<any>(null)

  useEffect(() => {
    audioRef.current = new Audio('/sounds/countdown.mp3')
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    }
  }, [])

  const showFlash = (type: FlashMessage['type'], text: string, duration = 2200) => {
    setFlash({ type, text })
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = setTimeout(() => setFlash(null), duration)
  }

  useEffect(() => {
    loadData()

    const channel = supabase
      .channel('live-bidding')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_state' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids' }, async () => {
        setBidLockedUntil(Date.now() + BID_LOCK_MS)
        await loadData()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_players' }, loadData)
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
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

      const diff = Math.max(
        0,
        Math.floor((new Date(auction.ends_at).getTime() - Date.now()) / 1000)
      )

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

    if (timeLeft === 0) {
      countdownStartedRef.current = false
    }
  }, [timeLeft, auction?.status])

  const loadData = async () => {
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      window.location.href = '/'
      return
    }

    setUser(userData.user)

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userData.user.id)
      .single()

    if (!profile || profile.role !== 'owner' || !profile.team_id) {
      window.location.href = '/admin'
      return
    }

    const { data: teamData } = await supabase
      .from('teams')
      .select('*')
      .eq('id', profile.team_id)
      .single()

    setTeam(isHiddenTeam(teamData) ? null : teamData)

    const { data: auctionData } = await supabase
      .from('auction_state')
      .select('*')
      .eq('id', 1)
      .single()

    setAuction(auctionData)

    if (auctionData?.current_player_id) {
      const { data: playerData } = await supabase
        .from('players')
        .select('*')
        .eq('id', auctionData.current_player_id)
        .single()

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

      setRecentBids((bidsData || []).filter((bid: any) => !isHiddenTeam(bid.teams)))
    } else {
      setPlayer(null)
      setRecentBids([])
    }

    if (auctionData?.current_highest_team_id) {
      const { data: leadTeam } = await supabase
        .from('teams')
        .select('*')
        .eq('id', auctionData.current_highest_team_id)
        .single()

      setLeadingTeam(isHiddenTeam(leadTeam) ? null : leadTeam)
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
          country,
          availability,
          image_url,
          playing_psl_first_time
        )
      `)
      .eq('team_id', teamData.id)
      .order('id', { ascending: true })

    setTeamPlayers(tp || [])
  }

  const remainingSlots = team ? Math.max(team.max_players - teamPlayers.length, 0) : 0
  const minRequiredBudget = remainingSlots * BASE_PRICE

  const remainingSlotsIfWin = team ? Math.max(team.max_players - (teamPlayers.length + 1), 0) : 0
  const reserveIfWin = remainingSlotsIfWin * BASE_PRICE

  const currentBid = auction?.current_highest_bid || player?.base_price || 0
  const isMyTeamLeading = auction?.current_highest_team_id === team?.id

  const committedBid = isMyTeamLeading ? currentBid : 0

  const maxAllowedBid = team
    ? Math.max(team.budget_remaining - reserveIfWin, 0)
    : 0

  const usableBudget = team
    ? Math.max(team.budget_remaining - reserveIfWin - committedBid, 0)
    : 0

  const bidTemporarilyLocked = Date.now() < bidLockedUntil

  const canBid =
    auction?.status === 'running' &&
    player &&
    timeLeft > 0 &&
    !isMyTeamLeading &&
    !bidTemporarilyLocked

  const squadFull = !!team && teamPlayers.length >= team.max_players

  const canRaiseBy = (incrementMillions: number) => {
    if (!canBid || squadFull || !team) return false
    const newBid = currentBid + incrementMillions * 1_000_000
    return newBid <= maxAllowedBid
  }

  const canBuyAtBase =
    canBid &&
    !auction?.current_highest_bid &&
    !!player &&
    !squadFull &&
    player.base_price <= maxAllowedBid

  const customBidMillions = parseInt(customBid || '0', 10)
  const customBidAmount =
    customBidMillions > 0 ? currentBid + customBidMillions * 1_000_000 : 0

  const isCustomBidValid =
    canBid &&
    !squadFull &&
    customBidMillions > 0 &&
    customBidAmount <= maxAllowedBid

  const submitBidAmount = async (newBid: number) => {
    if (!player || !team || !user) return

    setLoading(true)
    setBidLockedUntil(Date.now() + BID_LOCK_MS)

    const { data, error } = await supabase.rpc('place_live_bid', {
      p_player_id: player.id,
      p_team_id: team.id,
      p_user_id: user.id,
      p_bid_amount: newBid,
    })

    setLoading(false)

    if (error) {
      showFlash('error', error.message || 'Bid not accepted. Please try again.')
      await loadData()
      return
    }

    const result = Array.isArray(data) ? data[0] : data

    if (!result) {
      showFlash('error', 'Bid not accepted. Please try again.')
      await loadData()
      return
    }

    if (result.ok === false) {
      const message =
        result.message ||
        'Another team already placed this bid. Please place a higher bid.'
      showFlash('error', message)
      await loadData()
      return
    }

    showFlash('success', 'Bid accepted.')
    await loadData()
  }

  const placeBid = async (incrementMillions: number) => {
    if (!canBid) return

    if (squadFull) {
      showFlash('error', 'Squad full.')
      return
    }

    const increment = incrementMillions * 1_000_000
    const newBid = currentBid + increment

    if (newBid > team.budget_remaining) {
      showFlash('error', 'Not enough total budget.')
      return
    }

    if (newBid > maxAllowedBid) {
      showFlash('error', 'Not enough live usable bidding budget.')
      return
    }

    if (newBid <= currentBid) {
      showFlash('error', 'Bid must be higher than current highest bid.')
      return
    }

    await submitBidAmount(newBid)
  }

  const buyAtBase = async () => {
    if (!canBid) return
    if (auction.current_highest_bid) return

    if (squadFull) {
      showFlash('error', 'Squad full.')
      return
    }

    if (player.base_price > team.budget_remaining) {
      showFlash('error', 'Not enough budget.')
      return
    }

    if (player.base_price > maxAllowedBid) {
      showFlash('error', 'Not enough live usable bidding budget.')
      return
    }

    await submitBidAmount(player.base_price)
  }

  const placeCustomBid = async () => {
    if (!isCustomBidValid) return
    await placeBid(customBidMillions)
    setCustomBid('')
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const timerLabel = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, '0')}`

  const hasFirstTimePlayer = teamPlayers.some(
    (tp) => tp.players?.playing_psl_first_time === true
  )

  if (!team) return <div className="p-6">Loading...</div>

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <div className="rounded-3xl bg-gradient-to-r from-slate-900 to-slate-800 text-white p-6 shadow-lg">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <img
                src="/team-logos/psl.png"
                alt="PSL"
                className="h-16 w-16 rounded-full bg-white object-contain p-1"
              />
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-slate-300">PSL 2026</p>
                <h1 className="text-3xl font-bold">Live Auction</h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/live/players"
                className="rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                Registered Players
              </Link>

              <Link
                href="/live/end-queue"
                className="rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                End Queue
              </Link>

              <Link
                href="/live/leaderboard"
                className="rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                Leaderboard
              </Link>

              <div className="rounded-2xl bg-black/20 px-5 py-4 text-right">
                <p className="text-sm text-slate-300">Timer</p>
                <p className="text-3xl font-bold text-rose-300">{timerLabel}</p>
              </div>

              <button
                onClick={handleLogout}
                className="rounded-2xl bg-red-600 px-5 py-4 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {flash ? (
          <div
            className={`rounded-2xl px-4 py-3 text-sm font-medium shadow-sm ${
              flash.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : flash.type === 'error'
                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                : 'bg-sky-50 text-sky-700 border border-sky-200'
            }`}
          >
            {flash.text}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-sm">
              {player ? (
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="overflow-hidden rounded-2xl bg-slate-100 h-[340px] flex items-center justify-center">
                    {player.image_url ? (
                      <img src={player.image_url} alt={player.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-slate-500">No Image</span>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-slate-500">Player Name</p>
                      <h2 className="text-4xl font-bold text-slate-900">{player.name}</h2>
                    </div>

                    <div>
                      <p className="text-sm text-slate-500">Category</p>
                      <p className="text-xl font-semibold text-slate-900">{player.category}</p>
                      <PlayerMetaBadges
						  country={player.country}
						  availability={player.availability}
						  firstTimePsl={player.playing_psl_first_time}
						/>
                    </div>

                    <div>
                      <p className="text-sm text-slate-500">Current Highest Bid</p>
                      <p className="text-3xl font-bold text-emerald-600">
                        {formatMoneyWords(currentBid)}
                      </p>
                    </div>

                    <div className={`rounded-2xl p-4 ${leadingTeam ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50 border border-slate-200'}`}>
                      <p className="text-sm text-slate-500">Leading Team</p>

                      {leadingTeam ? (
                        <div className="mt-2 flex items-center gap-4">
                          <img
                            src={leadingTeam.logo_url || '/team-logos/psl.png'}
                            alt={leadingTeam.name}
                            className="h-14 w-14 rounded-full bg-white object-contain p-1 shadow"
                          />
                          <div>
                            <p className="text-2xl font-bold text-slate-900">{leadingTeam.name}</p>
                            {isMyTeamLeading ? (
                              <p className="text-sm font-medium text-emerald-700">You are currently leading</p>
                            ) : (
                              <p className="text-sm font-medium text-amber-700">Another team is leading</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 text-lg font-semibold text-slate-800">No bids yet</p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="text-sm text-emerald-800">Max bid you can place right now</p>
                      <p className="mt-1 text-2xl font-bold text-emerald-700">
                        {formatMoneyWords(maxAllowedBid)}
                      </p>
                    </div>

                    {!auction?.current_highest_bid && (
                      <button
                        onClick={buyAtBase}
                        disabled={!canBuyAtBase || loading}
                        className="w-full rounded-xl bg-green-600 px-4 py-3 text-white font-semibold hover:bg-green-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
                      >
                        Buy at Base Price ({formatMoneyWords(player.base_price)})
                      </button>
                    )}

                    <div>
                      <p className="text-sm text-slate-500 mb-2">Quick Raise</p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[1, 2, 5, 10].map((n) => {
                          const disabled = !canRaiseBy(n) || loading

                          return (
                            <button
                              key={n}
                              disabled={disabled}
                              onClick={() => placeBid(n)}
                              className="rounded-xl bg-blue-600 px-4 py-3 text-white font-semibold hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
                            >
                              +{n}M
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <input
                        value={customBid}
                        onChange={(e) => setCustomBid(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="Enter increment in millions, e.g. 4"
                        className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 bg-white"
                      />
                      <button
                        onClick={placeCustomBid}
                        disabled={!isCustomBidValid || loading}
                        className="rounded-xl bg-slate-900 px-5 py-3 text-white font-semibold hover:bg-black disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
                      >
                        Bid
                      </button>
                    </div>

                    {customBidMillions > 0 && (
                      <div className={`rounded-xl px-4 py-3 text-sm ${
                        customBidAmount <= maxAllowedBid
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}>
                        Your bid would become {formatMoneyWords(customBidAmount)}.
                        {customBidAmount > maxAllowedBid && (
                          <> This is above your live usable bidding limit.</>
                        )}
                      </div>
                    )}

                    {!canBid && (
                      <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
                        {bidTemporarilyLocked
                          ? 'Bid update in progress. You can place the next higher bid in a moment.'
                          : auction?.status === 'paused'
                          ? 'Bidding is paused by admin.'
                          : timeLeft === 0 && auction?.current_player_id
                          ? 'Timer is over. Waiting for admin action.'
                          : isMyTeamLeading
                          ? 'You are currently leading.'
                          : 'Waiting for admin to start bidding.'}
                      </div>
                    )}

                    {canBid && squadFull && (
                      <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        Your squad is already full, so bidding is disabled.
                      </div>
                    )}

                    {canBid && !squadFull && currentBid >= maxAllowedBid && (
                      <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        You cannot place a higher bid because the current price has already reached your maximum usable limit.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-16 text-center">
                  <p className="text-3xl font-bold text-slate-800">Waiting for next player</p>
                </div>
              )}
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <h3 className="text-2xl font-bold text-slate-900">Recent Bids</h3>

              {recentBids.length === 0 ? (
                <p className="mt-4 text-slate-600">No bids yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {recentBids.map((bid) => (
                    <div key={bid.id} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={bid.teams?.logo_url || '/team-logos/psl.png'}
                          alt={bid.teams?.name || 'Team'}
                          className="h-10 w-10 rounded-full bg-slate-100 object-contain p-1"
                        />
                        <div>
                          <p className="font-semibold text-slate-900">{bid.teams?.name || 'Unknown Team'}</p>
                          <p className="text-sm text-slate-500">{new Date(bid.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                      <p className="text-lg font-bold text-slate-900">{formatMoneyWords(bid.bid_amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <img
                  src={team.logo_url || '/team-logos/psl.png'}
                  alt={team.name}
                  className="h-16 w-16 rounded-full bg-slate-100 object-contain p-2"
                />
                <div>
                  <p className="text-sm text-slate-500">Your Team</p>
                  <h3 className="text-2xl font-bold text-slate-900">{team.name}</h3>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <p className="text-sm text-slate-500">Total Remaining Budget</p>
                  <p className="text-xl font-bold text-slate-900">{formatMoneyWords(team.budget_remaining)}</p>
                </div>

                <div>
                  <p className="text-sm text-slate-500">Reserved For Remaining Slots</p>
                  <p className="text-xl font-bold text-slate-900">{formatMoneyWords(minRequiredBudget)}</p>
                </div>

                <div>
                  <p className="text-sm text-slate-500">Current Committed Bid</p>
                  <p className="text-xl font-bold text-slate-900">{formatMoneyWords(committedBid)}</p>
                </div>

                <div>
                  <p className="text-sm text-slate-500">Live Usable Bidding Budget</p>
                  <p className="text-xl font-bold text-emerald-600">{formatMoneyWords(usableBudget)}</p>
                </div>

                <div>
                  <p className="text-sm text-slate-500">Players Bought</p>
                  <p className="text-xl font-bold text-slate-900">
                    {teamPlayers.length} / {team.max_players}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-slate-500">First-time PSL player picked</p>
                  <p className={`text-xl font-bold ${hasFirstTimePlayer ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {hasFirstTimePlayer ? 'Yes' : 'No'}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <h3 className="text-2xl font-bold text-slate-900">Won Players</h3>

              {teamPlayers.length === 0 ? (
                <p className="mt-4 text-slate-600">No players won yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {teamPlayers.map((tp) => (
                    <div key={tp.id} className="rounded-2xl border border-slate-200 px-4 py-3">
                      <div className="flex gap-3">
                        <div className="h-14 w-14 overflow-hidden rounded-xl bg-slate-100 flex items-center justify-center">
                          {tp.players?.image_url ? (
                            <img
                              src={tp.players.image_url}
                              alt={tp.players.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="text-[10px] text-slate-500">No Image</span>
                          )}
                        </div>

                        <div className="flex-1">
                          <p className="font-semibold text-slate-900">
                            {tp.players?.name || `Player #${tp.player_id}`}
                          </p>
                          <p className="text-sm text-slate-500">
                            {tp.players?.category || 'Unknown Category'}
                          </p>
                          <PlayerMetaBadges
							  country={tp.players?.country}
							  availability={tp.players?.availability}
							  firstTimePsl={tp.players?.playing_psl_first_time}
							/>
                          <p className="text-sm text-slate-500">
                            Bought Price: {formatMoneyWords(tp.bought_price)}
                          </p>
                        </div>
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