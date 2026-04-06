'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import TopNav from '../../components/TopNav'

type Profile = {
  id: string
  full_name: string
  role: 'admin' | 'owner'
}

type Team = {
  id: number
  name: string
  budget_total: number
  budget_remaining: number
  max_players: number
}

export default function AdminTeamsPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
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

      if (!profileData || profileData.role !== 'admin') {
        window.location.href = '/live'
        return
      }

      const { data: teamsData } = await supabase
        .from('teams')
        .select('*')
        .order('id', { ascending: true })

      setProfile(profileData)
      setTeams(teamsData || [])
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('admin-teams-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teams' },
        async () => {
          const { data: teamsData } = await supabase
            .from('teams')
            .select('*')
            .order('id', { ascending: true })

          setTeams(teamsData || [])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        Loading teams...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <TopNav title="Teams" subtitle="View teams and remaining budgets" />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <div key={team.id} className="rounded-2xl bg-white p-6 shadow-sm border">
              <h2 className="text-xl font-semibold text-gray-900">{team.name}</h2>

              <div className="mt-4 space-y-2 text-sm text-gray-600">
                <p>
                  <span className="font-medium text-gray-900">Total Budget:</span>{' '}
                  {team.budget_total.toLocaleString()}
                </p>
                <p>
                  <span className="font-medium text-gray-900">Remaining Budget:</span>{' '}
                  {team.budget_remaining.toLocaleString()}
                </p>
                <p>
                  <span className="font-medium text-gray-900">Max Players:</span>{' '}
                  {team.max_players}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}