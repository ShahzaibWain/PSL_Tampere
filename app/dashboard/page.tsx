'use client'

import { useEffect, useState } from 'react'
import { requireLoggedInClient } from '../../lib/auth-guards'

export default function DashboardRedirect() {
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    const checkUser = async () => {
      const result = await requireLoggedInClient()
      if (!result.ok) return

      if (result.profile.role === 'admin') {
        window.location.href = '/admin'
      } else {
        window.location.href = '/live'
      }

      setCheckingAuth(false)
    }

    void checkUser()
  }, [])

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-700">
      {checkingAuth ? 'Redirecting...' : 'Done'}
    </div>
  )
}
