'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import TopNav from '../../components/TopNav'
import PlayerMetaBadges from '../../components/PlayerMetaBadges'
import { formatMoneyWords } from '../../../lib/format'
import { requireOwnerClient } from '../../../lib/auth-guards'

type Player = {
  id: number
  name: string
  category: string
  base_price: number
  image_url?: string | null
  country?: string | null
  availability?: string | null
  auction_pool?: string | null
  playing_psl_first_time?: boolean | null
}

export default function OwnerEndQueuePage() {
  const [players, setPlayers] = useState<Player[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  const links = [{ label: 'Back to Live Auction', href: '/live' }]

  const loadData = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('players')
      .select('id, name, category, base_price, image_url, country, availability, auction_pool, playing_psl_first_time')
      .eq('status', 'unsold')
      .eq('auction_pool', 'end')
      .order('queue_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
    setPlayers((data as Player[]) || [])
    setLoading(false)
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
      .channel('owner-end-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, loadData)
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return players
    return players.filter((player) =>
      [player.name, player.category, player.country, player.availability].some((value) =>
        (value || '').toLowerCase().includes(q)
      )
    )
  }, [players, search])

  if (checkingAuth) return <div className="min-h-screen bg-slate-100 flex items-center justify-center">Checking access...</div>
  if (!authorized) return null
  if (loading) return <div className="min-h-screen bg-slate-100 flex items-center justify-center">Loading end queue...</div>

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <TopNav title="End Queue" subtitle="Players waiting for a second chance" links={links} />
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">End Queue Players</h2>
              <p className="text-slate-500">{players.length} player(s) currently in end queue</p>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search player, category, country, or availability"
              className="w-full md:w-80 rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400"
            />
          </div>
          {filtered.length === 0 ? <p className="mt-6 text-slate-600">No players found in end queue.</p> : (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((player) => (
                <div key={player.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 h-40 overflow-hidden rounded-2xl bg-white flex items-center justify-center">
                    {player.image_url ? <img src={player.image_url} alt={player.name} className="h-full w-full object-cover" /> : <span className="text-sm text-slate-500">No Image</span>}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">{player.name}</h3>
                  <p className="text-sm text-slate-500">{player.category}</p>
                  <PlayerMetaBadges country={player.country} availability={player.availability} firstTimePsl={player.playing_psl_first_time} />
                  <p className="mt-3 font-semibold text-slate-900">Base Price: {formatMoneyWords(player.base_price)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
