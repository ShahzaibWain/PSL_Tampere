import { supabase } from './supabase'

export async function requireAdminClient() {
  const { data: userData } = await supabase.auth.getUser()

  if (!userData.user) {
    window.location.href = '/'
    return { ok: false }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    window.location.href = '/live'
    return { ok: false }
  }

  return {
    ok: true,
    user: userData.user,
    profile,
  }
}

export async function requireOwnerClient() {
  const { data: userData } = await supabase.auth.getUser()

  if (!userData.user) {
    window.location.href = '/'
    return { ok: false }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .single()

  if (!profile || profile.role !== 'owner') {
    window.location.href = '/admin'
    return { ok: false }
  }

  return {
    ok: true,
    user: userData.user,
    profile,
  }
}

export async function requireLoggedInClient() {
  const { data: userData } = await supabase.auth.getUser()

  if (!userData.user) {
    window.location.href = '/'
    return { ok: false }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .single()

  if (!profile) {
    window.location.href = '/'
    return { ok: false }
  }

  return {
    ok: true,
    user: userData.user,
    profile,
  }
}
