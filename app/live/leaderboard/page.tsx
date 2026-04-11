'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import TopNav from '../../components/TopNav'
import PlayerMetaBadges from '../../components/PlayerMetaBadges'
import { formatMoneyWords } from '../../../lib/format'
import { requireOwnerClient } from '../../../lib/auth-guards'

const isHiddenTeam = (team: any) => ((team?.name || '') as string).toLowerCase().includes('multan')

export default function OwnerLeaderboardPage() {
  const [teams, setTeams] = useState<any[]>([])
  const [teamPlayers, setTeamPlayers] = useState<any[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  const links = [{ label: 'Back to Live Auction', href: '/live' }]

  const loadData = async () => {
    const { data: teamsRaw } = await supabase.from('teams').select('*').order('id', { ascending: true })
    const { data: teamPlayersRaw } = await supabase
      .from('team_players')
      .select(`
        id,
        team_id,
        player_id,
        bought_price,
        players ( id, name, category, country, availability, image_url, playing_psl_first_time )
      `)
      .order('id', { ascending: false })
    setTeams((teamsRaw || []).filter((team: any) => !isHiddenTeam(team)))
    setTeamPlayers(teamPlayersRaw || [])
  }

  useEffect(() => {
    const init = async () => {
      const result = await requireOwnerClient()
      if (!result.ok) return
      setAuthorized(true)
      setCheckingAuth(false)
      await loadData()
    }
    void init()

    const channel = supabase
      .channel('owner-leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_players' }, loadData)
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  const leaderboard = useMemo(() => {
    const rows = teams.map((team) => {
      const squad = teamPlayers.filter((tp) => tp.team_id === team.id)
      const playersBought = squad.length
      const totalSpent = squad.reduce((sum, item) => sum + (item.bought_price || 0), 0)
      const hasFirstTimePlayer = squad.some((item) => !!item.players?.playing_psl_first_time)
      return { ...team, squad, playersBought, totalSpent, hasFirstTimePlayer }
    })
    rows.sort((a, b) => {
      if (b.playersBought !== a.playersBought) return b.playersBought - a.playersBought
      return b.budget_remaining - a.budget_remaining
    })
    return rows
  }, [teams, teamPlayers])

  const selectedTeam = leaderboard.find((team) => team.id === selectedTeamId) || null

  if (checkingAuth) return <div className="min-h-screen bg-slate-100 flex items-center justify-center">Checking access...</div>
  if (!authorized) return null

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <TopNav title="Leaderboard" subtitle="Owner view of team standings and squads" links={links} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {leaderboard.map((team, index) => (
            <button key={team.id} onClick={() => setSelectedTeamId(team.id)} className={`rounded-3xl border p-6 text-left shadow-sm transition ${selectedTeamId === team.id ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-slate-200 bg-white hover:shadow-md'}`}>
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 font-bold text-white">{index + 1}</div>
                <img src={team.logo_url || '/team-logos/psl.png'} alt={team.name} className="h-16 w-16 rounded-full bg-slate-100 object-contain p-2" />
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{team.name}</h2>
                  <p className={`text-sm font-medium ${team.hasFirstTimePlayer ? 'text-emerald-600' : 'text-amber-600'}`}>
                    First-time PSL player: {team.hasFirstTimePlayer ? 'Yes' : 'No'}
                  </p>
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div><p className="text-sm text-slate-500">Players Bought</p><p className="text-lg font-bold text-slate-900">{team.playersBought} / {team.max_players}</p></div>
                <div><p className="text-sm text-slate-500">Remaining Budget</p><p className="text-lg font-bold text-slate-900">{formatMoneyWords(team.budget_remaining)}</p></div>
                <div><p className="text-sm text-slate-500">Total Spent</p><p className="text-lg font-bold text-slate-900">{formatMoneyWords(team.totalSpent)}</p></div>
              </div>
            </button>
          ))}
        </div>

        {selectedTeam ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <img src={selectedTeam.logo_url || '/team-logos/psl.png'} alt={selectedTeam.name} className="h-20 w-20 rounded-full bg-slate-100 object-contain p-2" />
              <div>
                <h2 className="text-3xl font-bold text-slate-900">{selectedTeam.name} Squad</h2>
                <p className="text-slate-500">{selectedTeam.playersBought} players bought</p>
              </div>
            </div>
            {selectedTeam.squad.length === 0 ? <p className="mt-6 text-slate-500">No players bought yet.</p> : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {selectedTeam.squad.map((player: any) => (
                  <div key={player.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex h-40 items-center justify-center overflow-hidden rounded-2xl bg-white">
                      {player.players?.image_url ? <img src={player.players.image_url} alt={player.players.name} className="h-full w-full object-cover" /> : <span className="text-sm text-slate-500">No Image</span>}
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">{player.players?.name || `Player #${player.player_id}`}</h3>
                    <p className="mt-1 text-sm text-slate-500">{player.players?.category || '-'}</p>
                    <PlayerMetaBadges country={player.players?.country} availability={player.players?.availability} firstTimePsl={player.players?.playing_psl_first_time} />
                    <p className="mt-3 font-semibold text-slate-900">Bought Price: {formatMoneyWords(player.bought_price)}</p>
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
