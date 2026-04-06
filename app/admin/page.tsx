'use client'

import Link from 'next/link'
import TopNav from '../components/TopNav'
import { dashboardLinks } from '../../lib/dashboard-links'

export default function AdminHomePage() {
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl bg-gradient-to-r from-slate-900 to-slate-800 text-white p-6 shadow-lg">
          <div className="flex items-center gap-4">
            <img
              src="/team-logos/psl.png"
              alt="PSL"
              className="h-16 w-16 rounded-full bg-white object-contain p-1"
            />
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-slate-300">PSL 2026</p>
              <h1 className="text-3xl font-bold">Admin Dashboard</h1>
            </div>
          </div>
        </div>

        <TopNav
          title="Admin Home"
          subtitle="Manage auction, live display, leaderboard, history, and registered players"
        />

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {dashboardLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <h2 className="text-xl font-semibold text-slate-900">{link.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{link.description}</p>
              <div className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                Open
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}