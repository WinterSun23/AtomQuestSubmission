import { supabase } from './supabase'
import { getMyProfile } from './userApi'

// ─── Goal Sheets (Manager) ───────────────────────────────────────────────────

export async function getTeamGoalSheets(cycleId) {
  const me = await getMyProfile()
  const { data, error } = await supabase
    .from('goal_sheets')
    .select(`
      id, status, submitted_at,
      employee:users!goal_sheets_employee_id_users_id_fk(id, name, department_id, departments(name))
    `)
    .eq('users.manager_id', me.id) // wait, users is joined, but we can't filter like this directly without a view.
    // Let's filter after fetch, or use inner join if possible.
  
  // Correction: We can fetch users where manager_id = me.id, then fetch their goal_sheets
  const { data: teamSheets, error: tsError } = await supabase
    .from('users')
    .select(`
      id, name, departments(name),
      goal_sheets:goal_sheets!goal_sheets_employee_id_users_id_fk (id, status, submitted_at, cycle_id)
    `)
    .eq('manager_id', me.id)
    
  if (tsError) throw tsError
  
  // Flatten for the UI, keeping only the sheet for the active cycle if it exists
  const results = teamSheets.map(user => {
    const sheet = (user.goal_sheets || []).find(s => s.cycle_id === cycleId)
    return {
      employeeId: user.id,
      employeeName: user.name,
      department: user.departments?.name,
      sheetId: sheet?.id,
      status: sheet?.status || 'not_started',
      submittedAt: sheet?.submitted_at
    }
  })
  
  return results
}

export async function getEmployeeGoalSheet(sheetId) {
  const { data, error } = await supabase
    .from('goal_sheets')
    .select(`
      id, status, rework_note, submitted_at, employee_id,
      goals (
        id, thrust_area_id, thrust_areas(name), title, description, uom_type, target, target_date, weightage, is_locked, is_shared
      ),
      employee:users!goal_sheets_employee_id_users_id_fk(name)
    `)
    .eq('id', sheetId)
    .single()
  
  if (error) throw error
  return data
}

export async function approveGoalSheet(sheetId) {
  const me = await getMyProfile()
  // Approve sheet and lock all goals
  const { error: sheetError } = await supabase
    .from('goal_sheets')
    .update({ 
      status: 'approved', 
      approved_at: new Date().toISOString(),
      approved_by: me.id
    })
    .eq('id', sheetId)
    
  if (sheetError) throw sheetError

  const { error: goalsError } = await supabase
    .from('goals')
    .update({ is_locked: true })
    .eq('goal_sheet_id', sheetId)

  if (goalsError) throw goalsError
}

export async function returnGoalSheet(sheetId, reworkNote) {
  const { error } = await supabase
    .from('goal_sheets')
    .update({ 
      status: 'returned', 
      rework_note: reworkNote 
    })
    .eq('id', sheetId)
    
  if (error) throw error
}

export async function updateGoalByManager(goalId, { target, target_date, weightage }) {
  // Manager inline edit
  const { error } = await supabase
    .from('goals')
    .update({ 
      target: target || null, 
      target_date: target_date || null,
      weightage 
    })
    .eq('id', goalId)
    .eq('is_locked', false) // safety check
    
  if (error) throw error
}

// ─── Shared Goals ────────────────────────────────────────────────────────────

export async function pushSharedGoal(goalData, employeeIds, cycleId) {
  // 1. Ensure each employee has a goal sheet for the cycle (create draft if missing)
  const sheets = await Promise.all(employeeIds.map(async empId => {
    let { data: sheet } = await supabase
      .from('goal_sheets')
      .select('id, status')
      .eq('employee_id', empId)
      .eq('cycle_id', cycleId)
      .maybeSingle()
      
    if (!sheet) {
      const { data: newSheet } = await supabase
        .from('goal_sheets')
        .insert({ employee_id: empId, cycle_id: cycleId, status: 'draft' })
        .select()
        .single()
      sheet = newSheet
    }
    return sheet
  }))
  
  // 2. Insert the shared goals linked to these sheets
  const toInsert = sheets.map(sheet => ({
    goal_sheet_id: sheet.id,
    thrust_area_id: goalData.thrust_area_id,
    title: goalData.title,
    description: goalData.description,
    uom_type: goalData.uom_type,
    target: (goalData.target === '' || goalData.target === undefined) ? null : goalData.target,
    target_date: (goalData.target_date === '' || goalData.target_date === undefined) ? null : goalData.target_date,
    weightage: goalData.weightage,
    is_shared: true
    // We could store shared_source_id if we created a template goal somewhere
  }))
  
  const { error } = await supabase.from('goals').insert(toInsert)
  if (error) throw error
}

// ─── Check-ins (Manager) ─────────────────────────────────────────────────────

export async function getTeamCheckInsSummary(windowId) {
  const me = await getMyProfile()
  // Needs to list direct reports and their check-in completion status for the window.
  // Can be complex, for now we will just get the users and maybe fetch all checkins
  const { data: team } = await supabase.from('users').select('id, name, departments(name)').eq('manager_id', me.id)
  
  // fetch manager comments
  const { data: comments } = await supabase
    .from('manager_comments')
    .select('employee_id, comment')
    .eq('window_id', windowId)
    .in('employee_id', team.map(t => t.id))
    
  return team.map(t => ({
    employeeId: t.id,
    employeeName: t.name,
    department: t.departments?.name,
    hasComment: comments.some(c => c.employee_id === t.id)
  }))
}

export async function saveManagerComment(employeeId, windowId, comment) {
  const me = await getMyProfile()
  const { error } = await supabase
    .from('manager_comments')
    .insert({
      employee_id: employeeId,
      manager_id: me.id,
      window_id: windowId,
      comment
    })
  if (error) throw error
}

export async function getQuarterlyTeamStats(quarter) {
  const me = await getMyProfile()
  
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

  // 3. Get team members
  const { data: team } = await supabase.from('users').select('id').eq('manager_id', me.id)
  const teamIds = team.map(t => t.id)
  if (teamIds.length === 0) return { total: 0, completed: 0, avgScore: 0 }

  // 4. Fetch all check-ins for this window belonging to the team
  const { data: checkins } = await supabase
    .from('check_ins')
    .select('status, computed_score, goal:goals!inner(goal_sheet:goal_sheets!inner(employee_id))')
    .eq('window_id', window.id)
    .in('goal.goal_sheet.employee_id', teamIds)
  
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

export async function getTeamEscalations() {
  const me = await getMyProfile()
  
  // 1. Fetch employee IDs under this manager
  const { data: employees } = await supabase
    .from('users')
    .select('id')
    .eq('manager_id', me.id)
    
  const employeeIds = employees ? employees.map(e => e.id) : []
  if (employeeIds.length === 0) return []
  
  // 2. Fetch open escalations for these employees
  const { data, error } = await supabase
    .from('escalation_log')
    .select(`
      id, rule_id, escalation_level, sent_at, resolved_at, resolve_note,
      employee:users!employee_id(name, email),
      notified:users!notified_user_id(name, email)
    `)
    .in('employee_id', employeeIds)
    .is('resolved_at', null)
    .order('sent_at', { ascending: false })
    
  if (error) throw error
  return data
}
