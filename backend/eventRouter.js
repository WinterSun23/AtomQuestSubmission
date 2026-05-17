const { enqueueNotificationJob } = require('./queue')

/**
 * Standard utility to insert audit log entry and dispatch notifications.
 */
async function logEventAndNotify(supabase, {
  actorId,
  action,
  goalId = null,
  goalSheetId = null,
  fieldChanged = null,
  oldValue = null,
  newValue = null,
  reason = null,
  description = ''
}) {
  console.log(`[EventRouter] Logging activity: ${action} by user ${actorId}...`)

  try {
    // 1. Log event in public.audit_log
    const { error: auditError } = await supabase.from('audit_log').insert({
      user_id: actorId,
      goal_id: goalId,
      goal_sheet_id: goalSheetId,
      action,
      field_changed: fieldChanged,
      old_value: oldValue,
      new_value: newValue,
      reason
    })
    
    if (auditError) {
      console.error('[EventRouter] Error inserting into audit_log:', auditError.message)
    }

    // 2. Resolve target recipients based on action
    const recipients = await resolveRecipients(supabase, { actorId, goalSheetId, action, newValue })

    // 3. Dispatch to background queue for each recipient
    for (const rec of recipients) {
      await enqueueNotificationJob({
        recipientId: rec.id,
        message: description,
        link: getActionLink(action, goalSheetId),
        actionType: action
      })
    }
  } catch (err) {
    console.error('[EventRouter] Uncaught exception in logEventAndNotify:', err)
  }
}

/**
 * Resolve who should receive the notification based on the activity.
 */
async function resolveRecipients(supabase, { actorId, goalSheetId, action, newValue }) {
  const recipients = []
  
  try {
    let employeeId = null
    let managerId = null

    if (goalSheetId) {
      const { data: sheet } = await supabase
        .from('goal_sheets')
        .select('employee_id, users!goal_sheets_employee_id_users_id_fk(manager_id)')
        .eq('id', goalSheetId)
        .maybeSingle()
      
      if (sheet) {
        employeeId = sheet.employee_id
        managerId = sheet.users?.manager_id
      }
    }

    switch (action) {
      case 'SUBMIT_GOAL_SHEET':
        if (managerId) {
          const { data: mgr } = await supabase.from('users').select('id').eq('id', managerId).maybeSingle()
          if (mgr) recipients.push(mgr)
        }
        break

      case 'APPROVE_GOAL_SHEET':
      case 'RETURN_GOAL_SHEET':
        if (employeeId) {
          const { data: emp } = await supabase.from('users').select('id').eq('id', employeeId).maybeSingle()
          if (emp) recipients.push(emp)
        }
        break

      case 'UPDATE_PROGRESS':
        if (managerId) {
          const { data: mgr } = await supabase.from('users').select('id').eq('id', managerId).maybeSingle()
          if (mgr) recipients.push(mgr)
        }
        break

      case 'CHANGE_MANAGER':
        // actorId is employee, newValue is new manager ID
        if (actorId) {
          recipients.push({ id: actorId })
        }
        if (newValue) {
          recipients.push({ id: newValue })
        }
        break

      case 'DEADLINE_REMINDER':
      case 'DEADLINE_MISSED':
        if (employeeId) {
          recipients.push({ id: employeeId })
        } else if (actorId) {
          recipients.push({ id: actorId })
        }
        break

      default:
        break
    }
  } catch (err) {
    console.error('[EventRouter] Error resolving recipients:', err)
  }

  return recipients
}

/**
 * Helper to build navigation URLs for in-app or email action buttons.
 */
function getActionLink(action, goalSheetId) {
  switch (action) {
    case 'SUBMIT_GOAL_SHEET':
      return '/dashboard/team-goals'
    case 'APPROVE_GOAL_SHEET':
    case 'RETURN_GOAL_SHEET':
      return '/dashboard/my-goals'
    case 'UPDATE_PROGRESS':
      return '/dashboard/team-checkins'
    case 'CHANGE_MANAGER':
      return '/dashboard'
    case 'DEADLINE_REMINDER':
      return '/dashboard/my-goals'
    default:
      return '/dashboard'
  }
}

module.exports = { logEventAndNotify }
