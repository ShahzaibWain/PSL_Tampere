'use client'

import { useEffect } from 'react'

export default function AdminTeamsPage() {
  useEffect(() => {
    window.location.href = '/admin/leaderboard'
  }, [])

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-center">
      <div className="rounded-3xl bg-white p-8 shadow-sm border border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900">Teams page moved</h1>
        <p className="mt-3 text-slate-600">Use the Leaderboard page for team budgets, squads, and exports.</p>
      </div>
    </div>
  )
}
