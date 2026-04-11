'use client'

import Link from 'next/link'
import { supabase } from '../../lib/supabase'

type Props = {
  title: string
  subtitle?: string
  links?: { label: string; href: string }[]
}

export default function TopNav({ title, subtitle, links = [] }: Props) {
  const logout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm border">
      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[1fr_auto_1fr] xl:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-2 text-gray-600">{subtitle}</p>}
        </div>

        <div className="flex justify-center xl:justify-center">
          <img
            src="/team-logos/sponsor.png"
            alt="Sponsor"
            className="h-16 w-auto max-w-[180px] object-contain"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 xl:justify-end">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {link.label}
            </Link>
          ))}

          <button
            onClick={logout}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  )
}
