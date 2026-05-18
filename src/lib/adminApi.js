import { supabase } from './supabase'

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getAllSettings() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .order('key')
  if (error) throw error
  return data  // [{ key, value, description, updated_at }]
}

export async function updateSetting(key, value) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value: String(value) }, { onConflict: 'key' })
  if (error) throw error
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function getAllUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, role, manager_id, created_at')
    .order('name')
  if (error) throw error
  return data
}

export async function updateUserRole(userId, role) {
  const { error } = await supabase
    .from('users')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}

export async function updateUserManager(userId, managerId) {
  const { error } = await supabase
    .from('users')
    .update({ manager_id: managerId, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}

// ─── Thrust Areas ─────────────────────────────────────────────────────────────

export async function getThrustAreas() {
  const { data, error } = await supabase.from('thrust_areas').select('*').order('name')
  if (error) throw error
  return data
}

export async function createThrustArea(name) {
  const { error } = await supabase.from('thrust_areas').insert({ name: name.trim() })
  if (error) throw error
}

export async function deleteThrustArea(id) {
  const { error } = await supabase.from('thrust_areas').delete().eq('id', id)
  if (error) throw error
}

// ─── Cycles ───────────────────────────────────────────────────────────────────

export async function getCycles() {
  const { data, error } = await supabase
    .from('cycles')
    .select(`*, check_in_windows(*)`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createCycle({ name }) {
  const { data, error } = await supabase
    .from('cycles')
    .insert({ 
      name, 
      goal_window_start: '2000-01-01', 
      goal_window_end: '2099-12-31' 
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function activateCycle(id) {
  // Deactivate all others first, then activate this one
  await supabase.from('cycles').update({ is_active: false }).neq('id', id)
  const { error } = await supabase.from('cycles').update({ is_active: true }).eq('id', id)
  if (error) throw error
}

export async function upsertCheckInWindow({ cycleId, quarter, windowOpen, windowClose }) {
  const { error } = await supabase
    .from('check_in_windows')
    .upsert(
      { cycle_id: cycleId, quarter, window_open: windowOpen, window_close: windowClose },
      { onConflict: 'cycle_id,quarter' }
    )
  if (error) throw error
}

// ─── Goal Sheet Unlock ────────────────────────────────────────────────────────

export async function searchLockedSheets(query) {
  if (query && query.trim()) {
    const trimmed = query.trim()
    const { data: matchedUsers } = await supabase
      .from('users')
      .select('id')
      .or(`name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`)
    
    if (!matchedUsers || matchedUsers.length === 0) {
      return []
    }
    
    const userIds = matchedUsers.map(u => u.id)
    const { data, error } = await supabase
      .from('goal_sheets')
      .select('id, status, approved_at, employee:users!employee_id(id, name, email)')
      .eq('status', 'approved')
      .in('employee_id', userIds)
      .order('approved_at', { ascending: false })
      .limit(50)
      
    if (error) throw error
    return data
  } else {
    // If query is empty, return all approved sheets
    const { data, error } = await supabase
      .from('goal_sheets')
      .select('id, status, approved_at, employee:users!employee_id(id, name, email)')
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(50)
      
    if (error) throw error
    return data
  }
}

export async function unlockGoalSheet(sheetId, reason) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('users').select('id').eq('auth_id', user.id).single()

  // Unlock the sheet
  const { error } = await supabase
    .from('goal_sheets')
    .update({ status: 'draft', approved_at: null, approved_by: null, updated_at: new Date().toISOString() })
    .eq('id', sheetId)
  if (error) throw error

  // Unlock all goals on this sheet
  await supabase.from('goals').update({ is_locked: false }).eq('goal_sheet_id', sheetId)

  // Write audit entry
  await supabase.from('audit_log').insert({
    user_id: me.id,
    goal_sheet_id: sheetId,
    action: 'unlock',
    reason,
  })
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export async function getAuditLog({ from, to, page = 0, pageSize = 50 } = {}) {
  let q = supabase
    .from('audit_log')
    .select(`
      id, action, field_changed, old_value, new_value, reason, changed_at,
      actor:users!user_id(name, email),
      goal:goals!goal_id(title)
    `, { count: 'exact' })
    .order('changed_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (from) q = q.gte('changed_at', from)
  if (to) q = q.lte('changed_at', to)

  const { data, error, count } = await q
  if (error) throw error
  return { data, count }
}

// ─── Escalation Log ───────────────────────────────────────────────────────────

export async function getEscalations({ resolved = false } = {}) {
  let q = supabase
    .from('escalation_log')
    .select(`
      id, rule_id, escalation_level, sent_at, resolved_at, resolve_note,
      employee:users!employee_id(name, email),
      notified:users!notified_user_id(name, email),
      resolver:users!resolved_by(name)
    `)
    .order('sent_at', { ascending: false })

  if (resolved) {
    q = q.not('resolved_at', 'is', null)
  } else {
    q = q.is('resolved_at', null)
  }

  const { data, error } = await q
  if (error) throw error
  return data
}

export async function resolveEscalation(id, note) {
  const { data: { user: authUser } } = await supabase.auth.getUser()
  let myProfileId = null
  if (authUser) {
    const { data: me } = await supabase.from('users').select('id').eq('auth_id', authUser.id).maybeSingle()
    if (me) myProfileId = me.id
  }

  const { error } = await supabase
    .from('escalation_log')
    .update({ 
      resolved_at: new Date().toISOString(), 
      resolve_note: note,
      resolved_by: myProfileId
    })
    .eq('id', id)
  
  if (error) throw error

  // Log resolving escalation as audit event
  if (myProfileId) {
    await supabase.from('audit_log').insert({
      user_id: myProfileId,
      action: 'RESOLVE_ESCALATION',
      reason: note
    })
  }
}

// ─── Dashboard summary cards ──────────────────────────────────────────────────

export async function getAdminSummary() {
  const [usersRes, sheetsRes, escalationsRes, cycleRes] = await Promise.all([
    supabase.from('users').select('role', { count: 'exact', head: true }),
    supabase.from('goal_sheets').select('status', { count: 'exact', head: true }).neq('status', 'draft'),
    supabase.from('escalation_log').select('id', { count: 'exact', head: true }).is('resolved_at', null),
    supabase.from('cycles').select('id, name').eq('is_active', true).maybeSingle(),
  ])
  return {
    totalUsers: usersRes.count ?? 0,
    totalSheets: sheetsRes.count ?? 0,
    openEscalations: escalationsRes.count ?? 0,
    activeCycle: cycleRes.data,
  }
}

export async function getQuarterlyAdminStats(quarter) {
  // 1. Get active cycle
  const { data: activeCycle } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
  if (!activeCycle) return null

  // 2. Get window_id for the quarter safely
  const { data: windows } = await supabase
    .from('check_in_windows')
    .select('id')
    .eq('cycle_id', activeCycle.id)
    .eq('quarter', quarter)
    .order('window_open', { ascending: false })
    .limit(1)
  const window = windows?.[0]
  if (!window) return null

  // 3. Fetch all check-ins for this window
  const { data: checkins } = await supabase.from('check_ins').select('status, computed_score').eq('window_id', window.id)
  
  if (!checkins || checkins.length === 0) {
    return { total: 0, completed: 0, avgScore: 0 }
  }

  const completed = checkins.filter(c => c.status === 'completed').length
  const totalScore = checkins.reduce((sum, c) => sum + (Number(c.computed_score) || 0), 0)
  
  return {
    total: checkins.length,
    completed,
    avgScore: (totalScore / checkins.length).toFixed(1)
  }
}
