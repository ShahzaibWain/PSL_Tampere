'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import TopNav from '../components/TopNav'
import { formatMoneyWords } from '../../lib/format'

type Player = {
  id: number
  name: string
  category: string
  base_price: number
  sold_price?: number | null
  sold_to_team_id?: number | null
  status: string
  image_url?: string | null
}

type Team = {
  id: number
  name: string
  logo_url?: string | null
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'sold' | 'unsold'>('all')
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    setLoading(true)

    const { data: playersData } = await supabase
      .from('players')
      .select('id, name, category, base_price, sold_price, sold_to_team_id, status, image_url')
      .order('id', { ascending: true })

    const { data: teamsData } = await supabase.from('teams').select('id, name, logo_url').order('id', { ascending: true })

    setPlayers((playersData as Player[]) || [])
    setTeams((teamsData as Team[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()

    const channel = supabase
      .channel('players-page-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, async () => {
        await loadData()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, async () => {
        await loadData()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const getTeam = (teamId?: number | null) => {
    if (!teamId) return null
    return teams.find((team) => team.id === teamId) || null
  }

  const filteredPlayers = useMemo(() => {
    let result = [...players]
    if (statusFilter !== 'all') result = result.filter((player) => player.status === statusFilter)

    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (player) =>
          player.name.toLowerCase().includes(q) ||
          (player.category || '').toLowerCase().includes(q) ||
          player.status.toLowerCase().includes(q)
      )
    }

    return result
  }, [players, search, statusFilter])

  const statusBadge = (status: string) => {
    if (status === 'sold') return 'bg-emerald-50 text-emerald-700'
    if (status === 'unsold') return 'bg-amber-50 text-amber-700'
    return 'bg-blue-50 text-blue-700'
  }

  if (loading) return <div className="min-h-screen bg-slate-100 flex items-center justify-center">Loading players...</div>

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl bg-gradient-to-r from-slate-900 to-slate-800 text-white p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <img src="/team-logos/psl.png" alt="PSL" className="h-16 w-16 rounded-full bg-white object-contain p-1" />
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-slate-300">PSL 2026</p>
              <h1 className="text-3xl font-bold">Registered Players</h1>
            </div>
          </div>
        </div>

        <TopNav title="Players" subtitle="Search and filter all registered players" />

        <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Player List</h2>
              <p className="mt-1 text-slate-500">Filter by status or search by name and category</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by player, category, or status" className="w-full sm:w-80 rounded-xl border border-slate-300 px-4 py-2 text-slate-900 outline-none focus:border-blue-500" />

              <div className="flex rounded-xl border border-slate-300 bg-slate-50 p-1">
                {['all', 'available', 'sold', 'unsold'].map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status as any)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium ${statusFilter === status ? 'bg-blue-600 text-white' : 'text-slate-700'}`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredPlayers.map((player) => {
              const soldTeam = getTeam(player.sold_to_team_id)
              return (
                <div key={player.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex gap-4">
                    <div className="h-24 w-24 overflow-hidden rounded-2xl bg-white flex items-center justify-center">
                      {player.image_url ? <img src={player.image_url} alt={player.name} className="h-full w-full object-cover" /> : <span className="text-xs text-slate-500">No Image</span>}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-bold text-slate-900">{player.name}</h3>
                          <p className="text-sm text-slate-500">{player.category}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.15em] ${statusBadge(player.status)}`}>{player.status}</span>
                      </div>

                      <div className="mt-3 grid gap-2">
                        <div>
                          <p className="text-sm text-slate-500">Base Price</p>
                          <p className="font-semibold text-slate-900">{formatMoneyWords(player.base_price)}</p>
                        </div>

                        {player.status === 'sold' ? (
                          <>
                            <div>
                              <p className="text-sm text-slate-500">Sold Price</p>
                              <p className="font-semibold text-emerald-600">{formatMoneyWords(player.sold_price)}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <img src={soldTeam?.logo_url || '/team-logos/psl.png'} alt={soldTeam?.name || 'Team'} className="h-8 w-8 rounded-full bg-white object-contain p-1" />
                              <p className="text-sm font-medium text-slate-700">{soldTeam?.name || 'Unknown Team'}</p>
                            </div>
                          </>
                        ) : null}

                        {player.status === 'unsold' ? <p className="text-sm font-medium text-amber-700">This player was marked unsold.</p> : null}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
