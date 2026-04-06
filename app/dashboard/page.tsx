'use client'

import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function DashboardRedirect() {
  useEffect(() => {
    const checkUser = async () => {
      const { data: userData } = await supabase.auth.getUser()

      if (!userData.user) {
        window.location.href = '/'
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userData.user.id)
        .single()

      if (!profile) {
        window.location.href = '/'
        return
      }

      if (profile.role === 'admin') {
        window.location.href = '/admin'
      } else {
        window.location.href = '/live'
      }
    }

    checkUser()
  }, [])

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-700">
      Redirecting...
    </div>
  )
}