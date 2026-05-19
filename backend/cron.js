const cron = require('node-cron')
const { enqueueNotificationJob } = require('./queue')

// Actual email service integration
const { sendActualEmail } = require('./emailService')

const sendEmail = async (to, subject, body, actionType = 'ESCALATION') => {
  const portalUrl = process.env.PORTAL_URL || 'http://localhost:5173'
  const htmlBody = `
    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; border: 1px solid #ddd; border-radius: 8px;">
      <h2 style="color: #DC2626;">🚨 Performance Portal System Alert</h2>
      <p style="font-size: 16px; line-height: 1.5; color: #111;">${body}</p>
      <div style="margin: 25px 0;">
        <a href="${portalUrl}/dashboard" style="background-color: #DC2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Open Portal Dashboard</a>
      </div>
      <hr style="border: 0; border-top: 1px solid #eee;" />
      <p style="font-size: 12px; color: #888;">This is an automated administrative notification. Please do not reply directly.</p>
    </div>
  `
  await sendActualEmail({
    to,
    subject,
    htmlBody,
    message: body,
    actionType
  })
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
    
    // Fetch first admin for L3/HR escalations
    const { data: admin } = await supabase.from('users').select('id, email, name').eq('role', 'admin').limit(1).maybeSingle()

    // 1. Fetch active cycle
    const { data: cycles } = await supabase.from('cycles').select('*').eq('is_active', true).maybeSingle()
    if (!cycles) {
      console.log('[Cron] No active cycle found. Skipping.')
      return
    }

    // Helper to calculate difference
    const getDiff = (date1, date2) => {
      const ms = date1 - date2
      if (unit === 'minutes') {
        return Math.floor(ms / (1000 * 60))
      }
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
      // Only escalate employees (not managers or admins who may lack goal sheets by design)
      const { data: users } = await supabase.from('users').select('id, name, email, manager_id').eq('role', 'employee')
      const { data: sheets } = await supabase.from('goal_sheets').select('employee_id, status').eq('cycle_id', cycles.id)
      
      for (const user of users) {
        const sheet = sheets?.find(s => s.employee_id === user.id)
        if (!sheet || sheet.status === 'draft') {
          let escalationLevel = '1'
          let notifiedUserId = user.id
          let emailTo = user.email
          let message = `Employee ${user.name} has not submitted their goal sheet for ${cycles.name}`
          let emailBody = `Your goal setting window opened more than ${deadline} ${unit} ago. Please submit your goals for approval. Link: /dashboard/my-goals`
          
          if (diff > 3 * deadline && admin) {
            escalationLevel = '3'
            notifiedUserId = admin.id
            emailTo = admin.email
            message = `[L3 Escalation] Employee ${user.name} has still not submitted their goal sheet after ${3 * deadline} ${unit}`
            emailBody = `Notice: Employee ${user.name} goal sheet setting remains overdue after ${3 * deadline} ${unit}. Action is required at HR/Admin level. Link: /admin/escalations`
          } else if (diff > 2 * deadline && user.manager_id) {
            const { data: manager } = await supabase.from('users').select('id, email, name').eq('id', user.manager_id).single()
            if (manager) {
              escalationLevel = '2'
              notifiedUserId = manager.id
              emailTo = manager.email
              message = `[L2 Escalation] Employee ${user.name} has not submitted their goal sheet after ${2 * deadline} ${unit}`
              emailBody = `Notice: Your direct report ${user.name} has not submitted their goals for approval for ${cycles.name} after ${2 * deadline} ${unit}. Link: /dashboard/team-goals`
            }
          }

          await triggerEscalation(supabase, {
            employeeId: user.id,
            ruleId: 'E1',
            escalationLevel,
            notifiedUserId,
            message,
            emailTo,
            emailSubject: escalationLevel === '1' ? 'Action Required: Submit Your Goal Sheet' : `Escalation Notice Level ${escalationLevel}: Goal Sheet Overdue`,
            emailBody
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
            let escalationLevel = '1'
            let notifiedUserId = manager.id
            let emailTo = manager.email
            let message = `Manager ${manager.name} has pending goal approvals older than ${deadline} ${unit} for ${sheet.users.name}`
            let emailBody = `You have pending goal sheet submissions from ${sheet.users.name} that are over ${deadline} ${unit} old. Link: /dashboard/team-goals`

            if (subDiff > 2 * deadline && admin) {
              escalationLevel = '2'
              notifiedUserId = admin.id
              emailTo = admin.email
              message = `[L2 Escalation] Manager ${manager.name} has still not approved goal sheets for ${sheet.users.name} after ${2 * deadline} ${unit}`
              emailBody = `Notice: Manager ${manager.name} has not approved goal sheets for ${sheet.users.name} after ${2 * deadline} ${unit}. Link: /admin/escalations`
            }

            await triggerEscalation(supabase, {
              employeeId: sheet.users.id,
              ruleId: 'E2',
              escalationLevel,
              notifiedUserId,
              message,
              emailTo,
              emailSubject: escalationLevel === '1' ? 'Action Required: Approve Goal Sheets' : `Escalation Notice Level ${escalationLevel}: Pending Approvals Overdue`,
              emailBody
            })
          }
        }
      }
    }

    // 4. Escalation: Employee has not completed check-ins within N days of check-in window opening (E3)
    const { data: activeWindows } = await supabase.from('check_in_windows')
      .select('*')
      .eq('cycle_id', cycles.id)
    
    if (activeWindows) {
      for (const w of activeWindows) {
        const winDiff = getDiff(today, new Date(w.window_open))
        if (winDiff > deadline) {
          // Find employees with approved goal sheets
          const { data: approvedSheets } = await supabase.from('goal_sheets')
            .select('employee_id, users!goal_sheets_employee_id_users_id_fk(id, name, email, manager_id)')
            .eq('status', 'approved')
            .eq('cycle_id', cycles.id)
          
          if (approvedSheets) {
            for (const sheet of approvedSheets) {
              if (!sheet.users) continue
              
              // Fetch goals for this employee sheet
              const { data: empGoals } = await supabase.from('goals')
                .select('id')
                .eq('goal_sheet_id', sheet.employee_id)
              
              const goalIds = empGoals?.map(g => g.id) || []
              let hasCheckins = false
              if (goalIds.length > 0) {
                const { data: cIn } = await supabase.from('check_ins')
                  .select('id')
                  .eq('window_id', w.id)
                  .in('goal_id', goalIds)
                if (cIn && cIn.length > 0) hasCheckins = true
              }
              
              if (!hasCheckins) {
                let escalationLevel = '1'
                let notifiedUserId = sheet.users.id
                let emailTo = sheet.users.email
                let message = `Employee ${sheet.users.name} has not completed check-ins for ${w.quarter}`
                let emailBody = `The check-in window for ${w.quarter} opened more than ${deadline} ${unit} ago. Please update your achievements. Link: /dashboard/my-checkins`

                if (winDiff > 3 * deadline && admin) {
                  escalationLevel = '3'
                  notifiedUserId = admin.id
                  emailTo = admin.email
                  message = `[L3 Escalation] Employee ${sheet.users.name} has still not completed check-ins for ${w.quarter} after ${3 * deadline} ${unit}`
                  emailBody = `Notice: Employee ${sheet.users.name} check-in remains overdue after ${3 * deadline} ${unit}. Action is required at HR/Admin level. Link: /admin/escalations`
                } else if (winDiff > 2 * deadline && sheet.users.manager_id) {
                  const { data: manager } = await supabase.from('users').select('id, email, name').eq('id', sheet.users.manager_id).single()
                  if (manager) {
                    escalationLevel = '2'
                    notifiedUserId = manager.id
                    emailTo = manager.email
                    message = `[L2 Escalation] Employee ${sheet.users.name} has not completed check-ins for ${w.quarter} after ${2 * deadline} ${unit}`
                    emailBody = `Notice: Your direct report ${sheet.users.name} check-in is overdue for ${w.quarter} after ${2 * deadline} ${unit}. Link: /dashboard/team-goals`
                  }
                }

                await triggerEscalation(supabase, {
                  employeeId: sheet.users.id,
                  ruleId: 'E3',
                  escalationLevel,
                  notifiedUserId,
                  message,
                  emailTo,
                  emailSubject: escalationLevel === '1' ? `Action Required: Complete ${w.quarter} Check-ins` : `Escalation Notice Level ${escalationLevel}: Check-ins Overdue`,
                  emailBody
                })
              }
            }
          }
        }
      }
    }

    // 5. Escalation: Manager review/comment overdue for check-in (E4)
    if (activeWindows) {
      for (const w of activeWindows) {
        // Find check-ins in this window
        const { data: windowCheckins } = await supabase.from('check_ins')
          .select(`
            id, updated_at,
            goals!check_ins_goal_id_goals_id_fk(
              goal_sheet_id,
              goal_sheets!goals_goal_sheet_id_goal_sheets_id_fk(
                employee_id,
                users!goal_sheets_employee_id_users_id_fk(id, name, manager_id)
              )
            )
          `)
          .eq('window_id', w.id)

        if (windowCheckins) {
          // Group check-ins by employee
          const empMap = new Map()
          for (const c of windowCheckins) {
            const empUser = c.goals?.goal_sheets?.users
            if (!empUser || !empUser.manager_id) continue
            
            if (!empMap.has(empUser.id)) {
              empMap.set(empUser.id, {
                user: empUser,
                lastUpdate: new Date(c.updated_at)
              })
            } else {
              const current = empMap.get(empUser.id)
              if (new Date(c.updated_at) > current.lastUpdate) {
                current.lastUpdate = new Date(c.updated_at)
              }
            }
          }

          for (const [empId, info] of empMap.entries()) {
            const checkinDiff = getDiff(today, info.lastUpdate)
            if (checkinDiff > deadline) {
              // Check if manager commented for this window & employee
              const { data: comments } = await supabase.from('manager_comments')
                .select('id')
                .eq('employee_id', empId)
                .eq('window_id', w.id)
                .limit(1)

              if (!comments || comments.length === 0) {
                const { data: manager } = await supabase.from('users')
                  .select('id, name, email')
                  .eq('id', info.user.manager_id)
                  .single()
                
                if (manager) {
                  let escalationLevel = '1'
                  let notifiedUserId = manager.id
                  let emailTo = manager.email
                  let message = `Manager ${manager.name} has overdue check-in reviews for ${info.user.name} (${w.quarter})`
                  let emailBody = `You have pending check-in reviews for ${info.user.name} in ${w.quarter} that are over ${deadline} ${unit} old. Link: /dashboard/team-checkins`

                  if (checkinDiff > 2 * deadline && admin) {
                    escalationLevel = '2'
                    notifiedUserId = admin.id
                    emailTo = admin.email
                    message = `[L2 Escalation] Manager ${manager.name} has still not reviewed check-ins for ${info.user.name} (${w.quarter}) after ${2 * deadline} ${unit}`
                    emailBody = `Notice: Manager ${manager.name} has pending check-in reviews for ${info.user.name} in ${w.quarter} that are over ${2 * deadline} ${unit} old. Link: /admin/escalations`
                  }

                  await triggerEscalation(supabase, {
                    employeeId: empId,
                    ruleId: 'E4',
                    escalationLevel,
                    notifiedUserId,
                    message,
                    emailTo,
                    emailSubject: escalationLevel === '1' ? 'Action Required: Complete Check-in Review' : `Escalation Notice Level ${escalationLevel}: Check-in Reviews Overdue`,
                    emailBody
                  })
                }
              }
            }
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
    let activeQ = 'phase1'
    if (month === 5 || month === 6) activeQ = 'phase1'
    else if (month >= 7 && month <= 9) activeQ = 'Q1'
    else if (month >= 10 && month <= 12) activeQ = 'Q2'
    else if (month === 1 || month === 2) activeQ = 'Q3'
    else if (month === 3 || month === 4) activeQ = 'Q4'

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
