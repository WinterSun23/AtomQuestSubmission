const cron = require('node-cron')
const { enqueueNotificationJob } = require('./queue')

// Mock email service
const sendEmail = (to, subject, body) => {
  console.log(`\n[MOCK EMAIL SENT]`)
  console.log(`To: ${to}`)
  console.log(`Subject: ${subject}`)
  console.log(`Body: ${body}\n`)
}

async function runEscalations(supabase) {
  console.log('[Cron] Running Escalation Engine...')
  
  try {
    const today = new Date()

    // Fetch settings
    const { data: settings } = await supabase.from('app_settings').select('*')
    const deadlineVal = settings?.find(s => s.key === 'escalation_deadline_days')?.value
    const deadline = deadlineVal ? parseInt(deadlineVal, 10) : 7
    const unit = settings?.find(s => s.key === 'escalation_deadline_unit')?.value || 'days'
    
    // 1. Fetch active cycle
    const { data: cycles } = await supabase.from('cycles').select('*').eq('is_active', true).maybeSingle()
    if (!cycles) {
      console.log('[Cron] No active cycle found. Skipping.')
      return
    }

    // Helper to calculate difference
    const getDiff = (date1, date2) => {
      const ms = date1 - date2
      if (unit === 'hours') {
        return Math.floor(ms / (1000 * 60 * 60))
      }
      return Math.floor(ms / (1000 * 60 * 60 * 24))
    }

    // 2. Escalation: Employee has not submitted goals within deadline of cycle open
    const startBase = cycles.goal_window_start ? new Date(cycles.goal_window_start) : new Date(cycles.created_at)
    const diff = getDiff(today, startBase)
    
    if (diff > deadline) {
      // Find employees without a submitted/approved goal sheet for this cycle
      const { data: users } = await supabase.from('users').select('id, name, email, manager_id').eq('role', 'employee')
      const { data: sheets } = await supabase.from('goal_sheets').select('employee_id, status').eq('cycle_id', cycles.id)
      
      for (const user of users) {
        const sheet = sheets?.find(s => s.employee_id === user.id)
        if (!sheet || sheet.status === 'draft') {
          await triggerEscalation(supabase, {
            employeeId: user.id,
            ruleId: 'E1',
            escalationLevel: '1',
            notifiedUserId: user.id,
            message: `Employee ${user.name} has not submitted their goal sheet for ${cycles.name}`,
            emailTo: user.email,
            emailSubject: 'Action Required: Submit Your Goal Sheet',
            emailBody: `Your goal setting window opened more than ${deadline} ${unit} ago. Please submit your goals for approval. Link: /dashboard/my-goals`
          })
        }
      }
    }

    // 3. Escalation: Manager has not approved goals within deadline of submission
    const { data: submittedSheets } = await supabase.from('goal_sheets')
      .select('id, employee_id, submitted_at, users!goal_sheets_employee_id_users_id_fk(id, name, manager_id)')
      .eq('status', 'submitted')
      .eq('cycle_id', cycles.id)

    if (submittedSheets) {
      for (const sheet of submittedSheets) {
        if (!sheet.submitted_at) continue
        const subDiff = getDiff(today, new Date(sheet.submitted_at))
        if (subDiff > deadline && sheet.users?.manager_id) {
          // Get manager details
          const { data: manager } = await supabase.from('users').select('id, email, name').eq('id', sheet.users.manager_id).single()
          if (manager) {
            await triggerEscalation(supabase, {
              employeeId: sheet.users.id,
              ruleId: 'E2',
              escalationLevel: '1',
              notifiedUserId: manager.id,
              message: `Manager ${manager.name} has pending goal approvals older than ${deadline} ${unit} for ${sheet.users.name}`,
              emailTo: manager.email,
              emailSubject: 'Action Required: Approve Goal Sheets',
              emailBody: `You have pending goal sheet submissions from ${sheet.users.name} that are over ${deadline} ${unit} old. Link: /dashboard/team-goals`
            })
          }
        }
      }
    }

    console.log('[Cron] Escalation Engine completed.')
  } catch (err) {
    console.error('[Cron] Error running escalations:', err)
  }
}

async function triggerEscalation(supabase, { employeeId, ruleId, escalationLevel, notifiedUserId, message, emailTo, emailSubject, emailBody }) {
  // Check if escalation already logged to prevent duplicates
  const { data: existing } = await supabase.from('escalation_log')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('rule_id', ruleId)
    .eq('escalation_level', escalationLevel)
    .is('resolved_at', null)
    .maybeSingle()

  if (existing) return // Already escalated and unresolved

  // Insert escalation log
  await supabase.from('escalation_log').insert({
    employee_id: employeeId,
    rule_id: ruleId,
    escalation_level: escalationLevel,
    notified_user_id: notifiedUserId,
    sent_at: new Date().toISOString()
  })

  // Insert In-App Notification
  await supabase.from('notifications').insert({
    user_id: notifiedUserId,
    message: message,
    link: emailBody.split('Link: ')[1] || '/dashboard'
  })

  // Send Email
  if (emailTo) {
    sendEmail(emailTo, emailSubject, emailBody)
  }
}

async function runDeadlineReminders(supabase) {
  console.log('[Cron] Running Automated Deadline Reminders...')
  try {
    const today = new Date()

    // 1. Fetch active cycle
    const { data: cycles } = await supabase.from('cycles').select('*').eq('is_active', true).maybeSingle()
    if (!cycles) return

    // Calculate remaining days for Goal Sheet submission
    if (cycles.goal_window_end) {
      const daysLeft = Math.ceil((new Date(cycles.goal_window_end) - today) / (1000 * 60 * 60 * 24))
      
      if (daysLeft > 0) {
        const { data: employees } = await supabase.from('users').select('id, name, email').eq('role', 'employee')
        const { data: sheets } = await supabase.from('goal_sheets').select('employee_id, status').eq('cycle_id', cycles.id)
        
        for (const emp of employees) {
          const sheet = sheets?.find(s => s.employee_id === emp.id)
          if (!sheet || sheet.status === 'draft') {
            // Fetch preferred reminder day setting
            const { data: pref } = await supabase.from('notification_preferences').select('reminder_days_before').eq('user_id', emp.id).maybeSingle()
            const triggerDays = pref ? pref.reminder_days_before : 3 // Default to 3 days
            
            if (daysLeft === triggerDays) {
              console.log(`[Cron] Enqueuing Goal Submission reminder for ${emp.name} (${daysLeft} days left)`)
              await enqueueNotificationJob({
                recipientId: emp.id,
                message: `Reminder: You have ${daysLeft} days remaining to submit your goal sheet for ${cycles.name} before the window closes.`,
                link: '/dashboard/my-goals',
                actionType: 'DEADLINE_REMINDER'
              })
            }
          }
        }
      }
    }

    // 2. Fetch active check-in window
    const { data: activeWindow } = await supabase.from('check_in_windows')
      .select('*')
      .eq('cycle_id', cycles.id)
      .lte('window_open', today.toISOString().split('T')[0])
      .gte('window_close', today.toISOString().split('T')[0])
      .maybeSingle()

    if (activeWindow && activeWindow.window_close) {
      const daysLeft = Math.ceil((new Date(activeWindow.window_close) - today) / (1000 * 60 * 60 * 24))
      
      if (daysLeft > 0) {
        const { data: approvedSheets } = await supabase.from('goal_sheets').select('employee_id, status').eq('cycle_id', cycles.id).eq('status', 'approved')
        
        if (approvedSheets) {
          for (const sheet of approvedSheets) {
            const { data: pref } = await supabase.from('notification_preferences').select('reminder_days_before').eq('user_id', sheet.employee_id).maybeSingle()
            const triggerDays = pref ? pref.reminder_days_before : 3
            
            if (daysLeft === triggerDays) {
              // Check if they completed all check-ins (at least one check-in entry exists for their goals)
              const { data: checkins } = await supabase.from('check_ins').select('id').eq('window_id', activeWindow.id)
              
              if (!checkins || checkins.length === 0) {
                console.log(`[Cron] Enqueuing Check-in reminder for employee ${sheet.employee_id} (${daysLeft} days left)`)
                await enqueueNotificationJob({
                  recipientId: sheet.employee_id,
                  message: `Reminder: You have ${daysLeft} days remaining to submit your check-in updates for ${activeWindow.quarter}.`,
                  link: '/dashboard/my-checkins',
                  actionType: 'DEADLINE_REMINDER'
                })
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[Cron] Error running deadline reminders:', err.message)
  }
}

async function updateActiveQuarter(supabase) {
  try {
    const { data: settings } = await supabase.from('app_settings').select('*')
    const override = settings?.find(s => s.key === 'active_quarter_override')?.value

    if (override && override !== 'auto' && override !== '') {
      console.log(`[Cron] Active Quarter overridden by Admin to: ${override}`)
      return
    }

    const month = new Date().getMonth() + 1 // 1-12
    let activeQ = 'Q1'
    if (month >= 7 && month <= 9) activeQ = 'Q1'
    else if (month >= 10 && month <= 12) activeQ = 'Q2'
    else if (month >= 1 && month <= 3) activeQ = 'Q3'
    else if (month >= 4 && month <= 6) activeQ = 'Q4'

    await supabase.from('app_settings').upsert({ key: 'auto_active_quarter', value: activeQ, description: 'Automatically calculated active quarter' })
    console.log(`[Cron] Auto Active Quarter set to: ${activeQ}`)

    // Auto-submit drafts on close check
    const autosubmitSet = settings?.find(s => s.key === 'autosubmit_drafts_on_close')?.value
    if (autosubmitSet === 'true' && activeQ === 'Q1') {
      const { data: activeCycle } = await supabase.from('cycles').select('id').eq('is_active', true).maybeSingle()
      if (activeCycle) {
        const { error: updateErr } = await supabase
          .from('goal_sheets')
          .update({ status: 'submitted', submitted_at: new Date().toISOString() })
          .eq('cycle_id', activeCycle.id)
          .eq('status', 'draft')
        
        if (updateErr) {
          console.error('[Cron] Error auto-submitting drafts:', updateErr.message)
        } else {
          console.log('[Cron] Goal setting window closed: Auto-submitted all draft goal sheets successfully!')
        }
      }
    }
  } catch(err) {
    console.error('[Cron] Error updating quarter:', err)
  }
}

function startCron(supabase) {
  // Run on startup
  console.log('[Cron] Executing startup checks...')
  updateActiveQuarter(supabase)
  runEscalations(supabase)
  runDeadlineReminders(supabase)

  // Run daily at midnight
  cron.schedule('0 0 * * *', () => {
    updateActiveQuarter(supabase)
    runEscalations(supabase)
    runDeadlineReminders(supabase)
  })
  console.log('[Cron] Scheduler started.')
}

module.exports = { startCron, runEscalations, updateActiveQuarter, runDeadlineReminders }
