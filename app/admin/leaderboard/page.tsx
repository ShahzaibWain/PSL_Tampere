"use client"

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import TopNav from '../../components/TopNav'
import PlayerMetaBadges from '../../components/PlayerMetaBadges'
import { formatMoneyWords } from '../../../lib/format'

const isHiddenTeam = (team: any) => ((team?.name || '') as string).toLowerCase().includes('multan')

type Team = {
  id: number
  name: string
  logo_url?: string | null
  budget_total: number
  budget_remaining: number
  max_players: number
}

type TeamPlayerRow = {
  id: number
  team_id: number
  player_id: number
  bought_price: number
  players?: {
    id: number
    name: string
    category: string
    country?: string | null
    availability?: string | null
    image_url?: string | null
  } | null
}

const links = [
  { label: 'Admin Home', href: '/admin' },
  { label: 'Auction', href: '/admin/auction' },
  { label: 'Live Screen', href: '/admin/live' },
  { label: 'Leaderboard', href: '/admin/leaderboard' },
  { label: 'Auction History', href: '/admin/history' },
  { label: 'Registered Players', href: '/players' },
]

export default function AdminLeaderboardPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [teamPlayers, setTeamPlayers] = useState<TeamPlayerRow[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)

  useEffect(() => {
    void loadData()

    const channel = supabase
      .channel('leaderboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_players' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, loadData)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  const loadData = async () => {
    const { data: teamsDataRaw } = await supabase.from('teams').select('*').order('id', { ascending: true })
    const { data: teamPlayersDataRaw } = await supabase
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
          image_url
        ),
        teams (
          id,
          name
        )
      `)
      .order('id', { ascending: true })

    const visibleTeams = ((teamsDataRaw as Team[]) || []).filter((team: any) => !isHiddenTeam(team))
    const visibleTeamIds = new Set(visibleTeams.map((team) => team.id))
    const visibleTeamPlayers = ((teamPlayersDataRaw as any[]) || []).filter((row: any) => visibleTeamIds.has(row.team_id))

    setTeams(visibleTeams)
    setTeamPlayers(visibleTeamPlayers)

    if (!selectedTeamId && visibleTeams.length > 0) setSelectedTeamId(visibleTeams[0].id)
    if (selectedTeamId && !visibleTeamIds.has(selectedTeamId)) setSelectedTeamId(visibleTeams[0]?.id || null)
  }

  const leaderboard = useMemo(() => {
    const rows = teams.map((team) => {
      const squad = teamPlayers.filter((tp) => tp.team_id === team.id)
      const playersBought = squad.length
      const totalSpent = squad.reduce((sum, item) => sum + (item.bought_price || 0), 0)
      const remainingSlots = Math.max(team.max_players - playersBought, 0)

      return { ...team, squad, playersBought, totalSpent, remainingSlots }
    })

    rows.sort((a, b) => {
      if (b.playersBought !== a.playersBought) return b.playersBought - a.playersBought
      return b.budget_remaining - a.budget_remaining
    })

    return rows
  }, [teams, teamPlayers])

  const selectedTeam = leaderboard.find((t) => t.id === selectedTeamId) || null

  const exportSelectedTeam = () => {
    if (!selectedTeam) return
    const rows = selectedTeam.squad.map((item, index) => ({
      sr: index + 1,
      team: selectedTeam.name,
      player_name: item.players?.name || `Player #${item.player_id}`,
      category: item.players?.category || '',
      country: item.players?.country || '',
      availability: item.players?.availability || '',
      bought_price: item.bought_price,
      bought_price_words: formatMoneyWords(item.bought_price),
    }))

    const headers = ['Sr', 'Team', 'Player Name', 'Category', 'Country', 'Availability', 'Bought Price', 'Bought Price Words']
    const csvLines = [
      headers.join(','),
      ...rows.map((row) => [row.sr, `"${row.team}"`, `"${row.player_name}"`, `"${row.category}"`, `"${row.country}"`, `"${row.availability}"`, row.bought_price, `"${row.bought_price_words}"`].join(',')),
    ]

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedTeam.name.replace(/\s+/g, '_').toLowerCase()}_squad.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl bg-gradient-to-r from-slate-900 to-slate-800 p-6 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <img src="/team-logos/psl.png" alt="PSL" className="h-16 w-16 rounded-full bg-white object-contain p-1" />
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-slate-300">PSL 2026</p>
              <h1 className="text-3xl font-bold">Leaderboard</h1>
            </div>
          </div>
        </div>

        <TopNav title="Leaderboard" subtitle="Click any team to view and export its squad" links={links} />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {leaderboard.map((team, index) => (
            <button key={team.id} onClick={() => setSelectedTeamId(team.id)} className={`rounded-3xl border p-6 text-left shadow-sm transition ${selectedTeamId === team.id ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-slate-200 bg-white hover:shadow-md'}`}>
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 font-bold text-white">{index + 1}</div>
                <img src={team.logo_url || '/team-logos/psl.png'} alt={team.name} className="h-16 w-16 rounded-full bg-slate-100 object-contain p-2" />
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{team.name}</h2>
                  <p className="text-sm text-slate-500">Click to view squad</p>
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div><p className="text-sm text-slate-500">Players Bought</p><p className="text-lg font-bold text-slate-900">{team.playersBought} / {team.max_players}</p></div>
                <div><p className="text-sm text-slate-500">Remaining Slots</p><p className="text-lg font-bold text-slate-900">{team.remainingSlots}</p></div>
                <div><p className="text-sm text-slate-500">Remaining Budget</p><p className="text-lg font-bold text-slate-900">{formatMoneyWords(team.budget_remaining)}</p></div>
                <div><p className="text-sm text-slate-500">Total Spent</p><p className="text-lg font-bold text-slate-900">{formatMoneyWords(team.totalSpent)}</p></div>
              </div>
            </button>
          ))}
        </div>

        {selectedTeam ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <img src={selectedTeam.logo_url || '/team-logos/psl.png'} alt={selectedTeam.name} className="h-20 w-20 rounded-full bg-slate-100 object-contain p-2" />
                <div>
                  <h2 className="text-3xl font-bold text-slate-900">{selectedTeam.name} Squad</h2>
                  <p className="text-slate-500">{selectedTeam.playersBought} players bought • {selectedTeam.remainingSlots} slots left</p>
                </div>
              </div>
              <div className="flex flex-col gap-3 md:items-end">
                <div className="grid gap-3 text-right sm:grid-cols-3">
                  <div><p className="text-sm text-slate-500">Remaining Budget</p><p className="text-xl font-bold text-slate-900">{formatMoneyWords(selectedTeam.budget_remaining)}</p></div>
                  <div><p className="text-sm text-slate-500">Total Spent</p><p className="text-xl font-bold text-slate-900">{formatMoneyWords(selectedTeam.totalSpent)}</p></div>
                  <div><p className="text-sm text-slate-500">Players Bought</p><p className="text-xl font-bold text-slate-900">{selectedTeam.playersBought}</p></div>
                </div>
                <button onClick={exportSelectedTeam} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Export Squad CSV</button>
              </div>
            </div>

            {selectedTeam.squad.length === 0 ? <p className="mt-6 text-slate-500">No players bought yet.</p> : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {selectedTeam.squad.map((player) => (
                  <div key={player.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex h-40 items-center justify-center overflow-hidden rounded-2xl bg-white">
                      {player.players?.image_url ? <img src={player.players.image_url} alt={player.players.name} className="h-full w-full object-cover" /> : <span className="text-sm text-slate-500">No Image</span>}
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">{player.players?.name || `Player #${player.player_id}`}</h3>
                    <p className="mt-1 text-sm text-slate-500">{player.players?.category || '-'}</p>
                    <PlayerMetaBadges country={player.players?.country} availability={player.players?.availability} />
                    <p className="mt-3 text-sm text-slate-500">Bought Price</p>
                    <p className="font-semibold text-slate-900">{formatMoneyWords(player.bought_price)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
