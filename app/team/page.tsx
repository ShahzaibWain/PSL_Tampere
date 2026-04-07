'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import TopNav from '../components/TopNav'

const isHiddenTeam = (team: any) => ((team?.name || '') as string).toLowerCase().includes('multan')

type Profile = {
  id: string
  full_name: string
  role: 'admin' | 'owner'
  team_id: number | null
}

type Team = {
  id: number
  name: string
  budget_total: number
  budget_remaining: number
  max_players: number
}

type TeamPlayer = {
  id: number
  bought_price: number
  player_id: number
  players: {
    name: string
    category: string
    image_url?: string | null
  }
}

export default function TeamPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [teamPlayers, setTeamPlayers] = useState<TeamPlayer[]>([])
  const [loading, setLoading] = useState(true)

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

      if (!profileData) {
        window.location.href = '/'
        return
      }

      setProfile(profileData)

      if (profileData.role !== 'owner' || !profileData.team_id) {
        setLoading(false)
        return
      }

      const { data: teamData } = await supabase
        .from('teams')
        .select('*')
        .eq('id', profileData.team_id)
        .single()

      const { data: wonPlayers } = await supabase
        .from('team_players')
        .select(`
          id,
          bought_price,
          player_id,
          players (
            name,
            category,
            image_url
          )
        `)
        .eq('team_id', profileData.team_id)
        .order('id', { ascending: true })

      setTeam(isHiddenTeam(teamData) ? null : teamData)
      setTeamPlayers((wonPlayers as any) || [])
      setLoading(false)
    }

    load()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        Loading team...
      </div>
    )
  }

  if (!profile || profile.role !== 'owner') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        This page is for team owners only.
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <TopNav title="My Team" subtitle="Track your budget and won players" />

        {team && (
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl bg-white p-6 shadow-sm border">
              <p className="text-sm text-gray-600">Team</p>
              <p className="mt-2 text-xl font-bold text-gray-900">{team.name}</p>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border">
              <p className="text-sm text-gray-600">Total Budget</p>
              <p className="mt-2 text-xl font-bold text-gray-900">
                {team.budget_total.toLocaleString()}
              </p>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border">
              <p className="text-sm text-gray-600">Remaining Budget</p>
              <p className="mt-2 text-xl font-bold text-gray-900">
                {team.budget_remaining.toLocaleString()}
              </p>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm border">
              <p className="text-sm text-gray-600">Players Bought</p>
              <p className="mt-2 text-xl font-bold text-gray-900">
                {teamPlayers.length} / {team.max_players}
              </p>
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-white p-6 shadow-sm border">
          <h2 className="text-2xl font-semibold text-gray-900">Won Players</h2>

          {teamPlayers.length === 0 ? (
            <p className="mt-4 text-gray-600">No players won yet.</p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {teamPlayers.map((item) => (
                <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 h-40 overflow-hidden rounded-lg bg-gray-100 flex items-center justify-center">
                    {item.players?.image_url ? (
                      <img
                        src={item.players.image_url}
                        alt={item.players.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-sm text-gray-500">No Image</span>
                    )}
                  </div>

                  <h3 className="text-lg font-semibold text-gray-900">
                    {item.players?.name}
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Category: {item.players?.category || '-'}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    Bought Price: {item.bought_price.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}