import { supabase } from './supabase'
import { calculateProgressScore } from './scoreUtils'

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Helper to get current user's DB profile ID
export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase.from('users').select('*').eq('auth_id', user.id).single()
  if (error) throw error
  return data
}

// ─── Reference Data ──────────────────────────────────────────────────────────

export async function getActiveCycle() {
  const { data, error } = await supabase
    .from('cycles')
    .select('id, name, goal_window_start, goal_window_end')
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getThrustAreas() {
  const { data, error } = await supabase.from('thrust_areas').select('*').order('name')
  if (error) throw error
  return data
}

// ─── Goal Sheets (Employee) ──────────────────────────────────────────────────

export async function getMyGoalSheet(cycleId) {
  const me = await getMyProfile()
  const { data, error } = await supabase
    .from('goal_sheets')
    .select(`
      id, status, rework_note, submitted_at, approved_at,
      goals (
        id, thrust_area_id, title, description, uom_type, target, target_date, weightage, is_locked, is_shared
      )
    `)
    .eq('employee_id', me.id)
    .eq('cycle_id', cycleId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function createGoalSheet(cycleId) {
  const me = await getMyProfile()
  const { data, error } = await supabase
    .from('goal_sheets')
    .insert({ employee_id: me.id, cycle_id: cycleId, status: 'draft' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function saveGoals(sheetId, goals) {
  // We need to upsert goals. Since UI might remove goals, we can just delete and recreate, 
  // or use upsert + delete missing. For simplicity, if status is draft/returned, 
  // we delete all existing non-shared goals and insert the new ones.
  // Actually, better to just upsert and delete missing.

  const { data: sheet } = await supabase.from('goal_sheets').select('status').eq('id', sheetId).single()
  if (sheet.status === 'submitted' || sheet.status === 'approved') {
    throw new Error('Cannot edit goals after submission')
  }

  // Find existing goals to see what to delete
  const { data: existingGoals } = await supabase.from('goals').select('id, is_shared').eq('goal_sheet_id', sheetId)

  const incomingIds = goals.map(g => g.id).filter(Boolean)
  const toDelete = existingGoals.filter(eg => !eg.is_shared && !incomingIds.includes(eg.id)).map(eg => eg.id)

  if (toDelete.length > 0) {
    await supabase.from('goals').delete().in('id', toDelete)
  }

  const toUpdate = []
  const toInsert = []

  goals.forEach(g => {
    const payload = {
      goal_sheet_id: sheetId,
      thrust_area_id: g.thrust_area_id,
      title: g.title,
      description: g.description,
      uom_type: g.uom_type,
      target: g.target || null,
      target_date: g.target_date || null,
      weightage: g.weightage,
      is_shared: g.is_shared || false,
      updated_at: new Date().toISOString()
    }

    if (g.id) {
      toUpdate.push({ ...payload, id: g.id })
    } else {
      toInsert.push(payload)
    }
  })

  if (toUpdate.length > 0) {
    const { error: updateErr } = await supabase.from('goals').upsert(toUpdate)
    if (updateErr) throw updateErr
  }

  if (toInsert.length > 0) {
    const { error: insertErr } = await supabase.from('goals').insert(toInsert)
    if (insertErr) throw insertErr
  }
}

export async function submitGoalSheet(sheetId) {
  const { error } = await supabase
    .from('goal_sheets')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', sheetId)
  if (error) throw error
}

export function getQuarterFixedDates(quarter) {
  const currentYear = new Date().getFullYear()
  let startMonth, endMonth, startDay, endDay
  if (quarter === 'Q1') {
    startMonth = 7; endMonth = 9; startDay = 1; endDay = 30
  } else if (quarter === 'Q2') {
    startMonth = 10; endMonth = 12; startDay = 1; endDay = 31
  } else if (quarter === 'Q3') {
    startMonth = 1; endMonth = 3; startDay = 1; endDay = 31
  } else if (quarter === 'Q4') {
    startMonth = 4; endMonth = 6; startDay = 1; endDay = 30
  }
  const pad = (n) => String(n).padStart(2, '0')
  return {
    open: `${currentYear}-${pad(startMonth)}-${pad(startDay)}`,
    close: `${currentYear}-${pad(endMonth)}-${pad(endDay)}`
  }
}

// ─── Check-ins (Employee) ────────────────────────────────────────────────────

export async function getActiveCheckInWindow(cycleId) {
  // Get active quarter from settings
  const { data: settings } = await supabase.from('app_settings').select('*')
  const override = settings?.find(s => s.key === 'active_quarter_override')?.value
  const auto = settings?.find(s => s.key === 'auto_active_quarter')?.value

  let currentQ = override && override !== 'auto' && override !== '' ? override : (auto || 'Q1')

  let { data: windows, error } = await supabase
    .from('check_in_windows')
    .select('*')
    .eq('cycle_id', cycleId)
    .eq('quarter', currentQ)
    .order('window_open', { ascending: false })
    .limit(1)

  if (error) throw error
  let window = windows?.[0] || null

  // Auto-create window if it doesn't exist for the fixed timeline
  if (!window) {
    const dates = getQuarterFixedDates(currentQ)
    const { data: newWindow, error: insertErr } = await supabase
      .from('check_in_windows')
      .insert({
        cycle_id: cycleId,
        quarter: currentQ,
        window_open: dates.open,
        window_close: dates.close
      })
      .select()
      .single()

    if (insertErr) throw insertErr
    window = newWindow
  }

  return window
}

export async function getMyCheckIns(windowId) {
  // Get check-ins for the window via goals that belong to current user
  const me = await getMyProfile()
  const { data, error } = await supabase
    .from('check_ins')
    .select(`
      id, actual_achievement, actual_date, status, computed_score, weighted_score,
      goal:goals!inner(id, title, target, uom_type, weightage, goal_sheet:goal_sheets!inner(employee_id))
    `)
    .eq('window_id', windowId)
    .eq('goal.goal_sheet.employee_id', me.id)
  if (error) throw error
  return data
}

export async function saveCheckIn({ goalId, windowId, actualAchievement, actualDate, status }) {
  // 1. Fetch current goal details
  const { data: currentGoal } = await supabase
    .from('goals')
    .select('title, thrust_area_id, is_shared, uom_type, target, target_date')
    .eq('id', goalId)
    .single()

  if (!currentGoal) throw new Error('Goal not found')

  const score = calculateProgressScore(
    currentGoal.uom_type,
    currentGoal.target,
    actualAchievement,
    actualDate,
    currentGoal.target_date
  )

  const payload = {
    goal_id: goalId,
    window_id: windowId,
    actual_achievement: (actualAchievement !== undefined && actualAchievement !== null && actualAchievement !== '') ? actualAchievement : null,
    actual_date: (actualDate !== undefined && actualDate !== null && actualDate !== '') ? actualDate : null,
    status: status,
    computed_score: score,
    updated_at: new Date().toISOString()
  }

  // Always insert a new, independent check-in log entry
  const { error } = await supabase.from('check_ins').insert(payload)
  if (error) throw error

  // 2. If it is a shared goal, automatically sync achievements to matching siblings
  if (currentGoal.is_shared) {
    const { data: siblingGoals } = await supabase
      .from('goals')
      .select('id')
      .eq('title', currentGoal.title)
      .eq('thrust_area_id', currentGoal.thrust_area_id)
      .eq('is_shared', true)
      .neq('id', goalId)

    if (siblingGoals && siblingGoals.length > 0) {
      const promises = siblingGoals.map(async sibling => {
        const sibPayload = {
          goal_id: sibling.id,
          window_id: windowId,
          actual_achievement: payload.actual_achievement,
          actual_date: payload.actual_date,
          status: status,
          computed_score: score,
          updated_at: new Date().toISOString()
        }
        await supabase.from('check_ins').insert(sibPayload)
      })
      await Promise.all(promises)
    }
  }
}

export async function isGoalSubmissionWindowOpen() {
  try {
    const { data: settings } = await supabase.from('app_settings').select('key, value')
    if (!settings) return false
    const override = settings.find(s => s.key === 'goal_window_open')?.value
    if (override === 'true') return true
    if (override === 'false') return false

    // Auto calendar mode: May 1st to June 30th
    const month = new Date().getMonth() + 1 // 1-12
    return month === 5 || month === 6
  } catch (err) {
    console.error('Error checking goal window status:', err)
    return false
  }
}

export async function logEvent({ action, goalId = null, goalSheetId = null, fieldChanged = null, oldValue = null, newValue = null, reason = null, description = '' }) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    await fetch(`${API_URL}/api/events/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        action,
        goalId,
        goalSheetId,
        fieldChanged,
        oldValue,
        newValue,
        reason,
        description
      })
    })
  } catch (err) {
    console.error('[logEvent] Failed to log frontend event to backend:', err)
  }
}
