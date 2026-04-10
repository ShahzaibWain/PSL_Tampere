'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import TopNav from '../../components/TopNav'
import PlayerMetaBadges from '../../components/PlayerMetaBadges'
import { formatMoneyWords } from '../../../lib/format'
import { requireAdminClient } from '../../../lib/auth-guards'

const isHiddenTeam = (team: any) => ((team?.name || '') as string).toLowerCase().includes('multan')

const links = [
  { label: 'Admin Home', href: '/admin' },
  { label: 'Auction', href: '/admin/auction' },
  { label: 'Live Screen', href: '/admin/live' },
  { label: 'Leaderboard', href: '/admin/leaderboard' },
  { label: 'Auction History', href: '/admin/history' },
  { label: 'Registered Players', href: '/players' },
]

export default function AdminHistoryPage() {
  const [events, setEvents] = useState<any[]>([])
  const [playersMap, setPlayersMap] = useState<Record<number, any>>({})
  const [teamsMap, setTeamsMap] = useState<Record<number, any>>({})
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [search, setSearch] = useState('')
  const [eventFilter, setEventFilter] = useState<'all' | 'sold' | 'unsold' | 'reopened'>('all')
  const [teamFilter, setTeamFilter] = useState<string>('all')
  const [historyReady, setHistoryReady] = useState(true)

  useEffect(() => {
    loadData()

    const channel = supabase
      .channel('history-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_events' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, loadData)
      .subscribe()

    return () => {
	  void supabase.removeChannel(channel)
	}
  }, [])

  const loadData = async () => {
    const { data: teamsData } = await supabase.from('teams').select('id, name, logo_url').order('id', { ascending: true })
    setTeamsMap(Object.fromEntries((teamsData || []).filter((item: any) => !isHiddenTeam(item)).map((item: any) => [item.id, item])))

    const { data: historyData, error } = await supabase
      .from('auction_events')
      .select('id, player_id, team_id, event_type, amount, note, created_at')
      .order('id', { ascending: false })
      .limit(200)

    if (error) {
      setHistoryReady(false)
      const { data: fallbackPlayers } = await supabase
        .from('players')
        .select('id, name, category, country, availability, image_url, sold_price, sold_to_team_id, status')
        .in('status', ['sold', 'unsold'])
        .order('id', { ascending: false })

      const fallback = (fallbackPlayers || []).map((item: any) => ({
        id: item.id,
        player_id: item.id,
        team_id: item.sold_to_team_id,
        event_type: item.status === 'sold' ? 'sold' : 'unsold',
        amount: item.sold_price,
        created_at: null,
      }))

      setEvents(fallback)
      setPlayersMap(Object.fromEntries((fallbackPlayers || []).map((item: any) => [item.id, item])))
      return
    }

    setHistoryReady(true)
    setEvents(historyData || [])

    const playerIds = Array.from(new Set((historyData || []).map((item: any) => item.player_id).filter(Boolean)))
    const { data: playersData } = playerIds.length
      ? await supabase.from('players').select('id, name, category, country, availability, image_url, status').in('id', playerIds)
      : { data: [] as any[] }

    setPlayersMap(Object.fromEntries(((playersData as any[]) || []).map((item) => [item.id, item])))
  }

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (eventFilter !== 'all' && event.event_type !== eventFilter) return false
      if (teamFilter !== 'all' && String(event.team_id || '') !== teamFilter) return false

      const player = playersMap[event.player_id]
      const team = teamsMap[event.team_id]
      const q = search.trim().toLowerCase()
      if (!q) return true

      if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center text-slate-700">
        Checking access...
      </div>
    )
  }

  if (!authorized) return null

  return (
        (player?.name || '').toLowerCase().includes(q) ||
        (player?.category || '').toLowerCase().includes(q) ||
        (player?.country || '').toLowerCase().includes(q) ||
        (player?.availability || '').toLowerCase().includes(q) ||
        (team?.name || '').toLowerCase().includes(q) ||
        (event.event_type || '').toLowerCase().includes(q)
      )
    })
  }, [events, eventFilter, playersMap, search, teamFilter, teamsMap])

  const exportCsv = () => {
    const rows = [
      ['Event', 'Player', 'Category', 'Team', 'Amount', 'Time'],
      ...filteredEvents.map((event) => [
        event.event_type,
        playersMap[event.player_id]?.name || `Player #${event.player_id}`,
        playersMap[event.player_id]?.category || '',
        teamsMap[event.team_id]?.name || '',
        event.amount || '',
        event.created_at ? new Date(event.created_at).toLocaleString() : '',
      ]),
    ]

    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'auction_history.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <TopNav title="Auction History" subtitle="Sold, reopened, and unsold activity with filters and export" links={links} />

        {!historyReady ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Full event history needs the Supabase SQL setup for auction_events. You are currently seeing a basic fallback view.
          </div>
        ) : null}

        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">History Filters</h2>
              <p className="mt-1 text-slate-500">Search by player, category, team, or event type.</p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search history" className="w-full md:w-72 rounded-xl border border-slate-300 px-4 py-2 text-slate-900 outline-none focus:border-blue-500" />

              <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value as any)} className="rounded-xl border border-slate-300 px-4 py-2 text-slate-900 outline-none focus:border-blue-500">
                <option value="all">All events</option>
                <option value="sold">Sold</option>
                <option value="unsold">Unsold</option>
                <option value="reopened">Reopened</option>
              </select>

              <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="rounded-xl border border-slate-300 px-4 py-2 text-slate-900 outline-none focus:border-blue-500">
                <option value="all">All teams</option>
                {Object.values(teamsMap).map((team: any) => (
                  <option key={team.id} value={String(team.id)}>{team.name}</option>
                ))}
              </select>

              <button onClick={exportCsv} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                Export History CSV
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredEvents.map((event) => {
            const player = playersMap[event.player_id]
            const team = teamsMap[event.team_id]
            const color = event.event_type === 'sold' ? 'text-emerald-600 bg-emerald-50' : event.event_type === 'unsold' ? 'text-amber-700 bg-amber-50' : 'text-blue-700 bg-blue-50'

            return (
              <div key={`${event.id}-${event.event_type}`} className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] ${color}`}>{event.event_type}</span>
                  <span className="text-xs text-slate-500">{event.created_at ? new Date(event.created_at).toLocaleString() : 'Time unavailable'}</span>
                </div>

                <div className="mt-5 flex items-center gap-4">
                  <div className="h-16 w-16 overflow-hidden rounded-2xl bg-slate-100 flex items-center justify-center">
                    {player?.image_url ? <img src={player.image_url} alt={player?.name} className="h-full w-full object-cover" /> : <span className="text-xs text-slate-500">No Image</span>}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">{player?.name || `Player #${event.player_id}`}</h2>
                    <p className="text-sm text-slate-500">{player?.category || '-'}</p>
                    <PlayerMetaBadges country={player?.country} availability={player?.availability} />
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-4">
                  <img src={team?.logo_url || '/team-logos/psl.png'} alt={team?.name || 'Team'} className="h-12 w-12 rounded-full bg-slate-100 object-contain p-2" />
                  <div>
                    <p className="text-sm text-slate-500">Team</p>
                    <p className="text-lg font-bold text-slate-900">{team?.name || (event.event_type === 'unsold' ? 'No team' : 'Unknown team')}</p>
                  </div>
                </div>

                <div className="mt-5">
                  <p className="text-sm text-slate-500">Amount</p>
                  <p className="text-2xl font-bold text-slate-900">{event.amount ? formatMoneyWords(event.amount) : '-'}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
