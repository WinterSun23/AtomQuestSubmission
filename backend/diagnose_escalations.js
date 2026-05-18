/**
 * Escalation Diagnostic Script
 * Covers:
 *   1. Settings audit  — verifies all escalation app_settings are read correctly
 *   2. Self-manager fix — finds & nullifies users where manager_id = their own id
 *   3. Escalation dry-run — simulates the full E1/E2/E3/E4 engine and reports
 *      what WOULD fire, without writing to DB or sending any emails
 *
 * Run: node backend/diagnose_escalations.js
 * Add --fix to actually clear self-manager references in the DB
 */
require('dotenv').config({ path: '.env' })
require('dotenv').config({ path: 'backend/.env' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
)

const FIX_MODE = process.argv.includes('--fix')
const BOLD  = s => `\x1b[1m${s}\x1b[0m`
const GREEN = s => `\x1b[32m${s}\x1b[0m`
const RED   = s => `\x1b[31m${s}\x1b[0m`
const YELLOW= s => `\x1b[33m${s}\x1b[0m`
const CYAN  = s => `\x1b[36m${s}\x1b[0m`

async function main() {
  console.log(BOLD('\n======================================================'))
  console.log(BOLD('  GoalFlow Escalation Diagnostic Tool'))
  console.log(BOLD('======================================================'))
  if (FIX_MODE) console.log(YELLOW('  [--fix mode] Self-manager rows will be repaired.\n'))
  else console.log(CYAN('  [dry-run]  Pass --fix to repair self-manager rows.\n'))

  // ─────────────────────────────────────────────────────
  // PART 1: Settings Audit
  // ─────────────────────────────────────────────────────
  console.log(BOLD('\n── Part 1: App Settings Audit ─────────────────────'))
  const { data: settings, error: setErr } = await supabase.from('app_settings').select('*')
  if (setErr) { console.error(RED('Failed to fetch settings:'), setErr); process.exit(1) }

  const RELEVANT = [
    'escalation_enabled',
    'escalation_deadline_days',
    'escalation_deadline_unit',
    'auto_active_quarter',
    'active_quarter_override',
    'goal_window_open',
    'autosubmit_drafts_on_close',
  ]

  const settingsMap = {}
  settings.forEach(s => settingsMap[s.key] = s.value)

  RELEVANT.forEach(key => {
    const val = settingsMap[key]
    if (val === undefined) {
      console.log(`  ${RED('MISSING')}  ${key}`)
    } else {
      console.log(`  ${GREEN('OK')}       ${key} = "${val}"`)
    }
  })

  const deadlineVal = settingsMap['escalation_deadline_days']
  const deadline    = deadlineVal ? parseInt(deadlineVal, 10) : 7
  const unit        = settingsMap['escalation_deadline_unit'] || 'days'
  const enabled     = settingsMap['escalation_enabled']

  console.log(`\n  Effective deadline: ${BOLD(deadline)} ${unit}`)
  if (enabled === 'false') {
    console.log(YELLOW('  ⚠️  escalation_enabled = false → engine is DISABLED'))
  } else {
    console.log(GREEN('  ✅ Escalation engine is ENABLED'))
  }

  // ─────────────────────────────────────────────────────
  // PART 2: Self-Manager Bug Detection & Fix
  // ─────────────────────────────────────────────────────
  console.log(BOLD('\n── Part 2: Self-Manager Bug Audit ─────────────────'))
  const { data: allUsers } = await supabase.from('users').select('id, name, email, role, manager_id')
  const selfManagers = allUsers.filter(u => u.manager_id && u.manager_id === u.id)

  if (selfManagers.length === 0) {
    console.log(GREEN('  ✅ No self-manager references found. All reporting lines are clean.'))
  } else {
    console.log(RED(`  ❌ Found ${selfManagers.length} user(s) with manager_id = their own id:`))
    selfManagers.forEach(u => {
      console.log(`     - ${u.name} (${u.email}) [role: ${u.role}] id=${u.id}`)
    })

    if (FIX_MODE) {
      console.log(YELLOW('\n  Fixing: setting manager_id = NULL for these users...'))
      for (const u of selfManagers) {
        const { error: fixErr } = await supabase
          .from('users')
          .update({ manager_id: null })
          .eq('id', u.id)
        if (fixErr) console.log(RED(`  ❌ Failed to fix ${u.name}: ${fixErr.message}`))
        else console.log(GREEN(`  ✅ Fixed: ${u.name} → manager_id = NULL`))
      }
    } else {
      console.log(YELLOW('\n  Re-run with --fix to automatically clear these.'))
    }
  }

  // ─────────────────────────────────────────────────────
  // PART 3: Escalation Engine Dry-Run
  // ─────────────────────────────────────────────────────
  console.log(BOLD('\n── Part 3: Escalation Engine Dry-Run ──────────────'))
  const today = new Date()
  console.log(`  Simulation date: ${today.toLocaleString()}`)

  // Active cycle
  const { data: cycle } = await supabase.from('cycles').select('*').eq('is_active', true).maybeSingle()
  if (!cycle) {
    console.log(RED('\n  ❌ No active cycle found — escalation engine would skip entirely.'))
    process.exit(0)
  }
  console.log(GREEN(`  ✅ Active cycle: "${cycle.name}" (id: ${cycle.id})`))

  const getDiff = (d1, d2) => {
    const ms = d1 - d2
    return unit === 'hours'
      ? Math.floor(ms / (1000 * 60 * 60))
      : Math.floor(ms / (1000 * 60 * 60 * 24))
  }

  let totalWouldFire = 0

  // ── E1: Employee not submitted ──────────────────────
  console.log(BOLD('\n  [E1] Employees who have NOT submitted goals:'))
  const startBase = cycle.goal_window_start ? new Date(cycle.goal_window_start) : new Date(cycle.created_at)
  const diff = getDiff(today, startBase)
  console.log(`       Cycle start base: ${startBase.toDateString()} | Days elapsed: ${diff} | Threshold: ${deadline}`)

  const { data: employees } = await supabase.from('users').select('id, name, email, manager_id').eq('role', 'employee')
  const { data: sheets }    = await supabase.from('goal_sheets').select('employee_id, status').eq('cycle_id', cycle.id)

  const e1Would = []
  if (diff > deadline) {
    employees.forEach(u => {
      const sheet = sheets?.find(s => s.employee_id === u.id)
      if (!sheet || sheet.status === 'draft') e1Would.push(u)
    })
  }
  if (e1Would.length === 0) {
    console.log(GREEN('       ✅ No E1 escalations would fire.'))
  } else {
    e1Would.forEach(u => console.log(RED(`       🚨 WOULD ESCALATE: ${u.name} (${u.email})`)))
    totalWouldFire += e1Would.length
  }

  // ── E2: Manager not approved ────────────────────────
  console.log(BOLD('\n  [E2] Submitted sheets awaiting manager approval too long:'))
  const { data: submittedSheets } = await supabase
    .from('goal_sheets')
    .select('id, employee_id, submitted_at, users!goal_sheets_employee_id_users_id_fk(id, name, manager_id)')
    .eq('status', 'submitted')
    .eq('cycle_id', cycle.id)

  const e2Would = []
  if (submittedSheets) {
    for (const s of submittedSheets) {
      if (!s.submitted_at) continue
      const subDiff = getDiff(today, new Date(s.submitted_at))
      if (subDiff > deadline && s.users?.manager_id) {
        const { data: mgr } = await supabase.from('users').select('id, name, email').eq('id', s.users.manager_id).single()
        if (mgr) e2Would.push({ employee: s.users, manager: mgr, daysPending: subDiff })
      }
    }
  }
  if (e2Would.length === 0) {
    console.log(GREEN('       ✅ No E2 escalations would fire.'))
  } else {
    e2Would.forEach(r => console.log(RED(`       🚨 WOULD ESCALATE manager ${r.manager.name} → pending approval for ${r.employee.name} (${r.daysPending} ${unit})`)))
    totalWouldFire += e2Would.length
  }

  // ── E3: Employee check-in overdue ───────────────────
  console.log(BOLD('\n  [E3] Employees who have NOT completed check-ins:'))
  const { data: windows } = await supabase.from('check_in_windows').select('*').eq('cycle_id', cycle.id)
  const { data: approvedSheets } = await supabase
    .from('goal_sheets')
    .select('employee_id, users!goal_sheets_employee_id_users_id_fk(id, name, email)')
    .eq('status', 'approved')
    .eq('cycle_id', cycle.id)

  const e3Would = []
  if (windows && approvedSheets) {
    for (const w of windows) {
      const winDiff = getDiff(today, new Date(w.window_open))
      if (winDiff <= deadline) {
        console.log(CYAN(`       Window ${w.quarter}: only ${winDiff} ${unit} old (threshold ${deadline}) — skipping`))
        continue
      }
      for (const sheet of approvedSheets) {
        if (!sheet.users) continue
        const { data: goals } = await supabase.from('goals').select('id').eq('goal_sheet_id', sheet.employee_id)
        const goalIds = goals?.map(g => g.id) || []
        let hasCheckins = false
        if (goalIds.length > 0) {
          const { data: cins } = await supabase.from('check_ins').select('id').eq('window_id', w.id).in('goal_id', goalIds)
          if (cins && cins.length > 0) hasCheckins = true
        }
        if (!hasCheckins) e3Would.push({ employee: sheet.users, quarter: w.quarter })
      }
    }
  }
  if (e3Would.length === 0) {
    console.log(GREEN('       ✅ No E3 escalations would fire.'))
  } else {
    e3Would.forEach(r => console.log(RED(`       🚨 WOULD ESCALATE: ${r.employee.name} — no check-ins for ${r.quarter}`)))
    totalWouldFire += e3Would.length
  }

  // ── E4: Manager review overdue ──────────────────────
  console.log(BOLD('\n  [E4] Managers who have NOT reviewed check-ins:'))
  const e4Would = []
  if (windows) {
    for (const w of windows) {
      const { data: windowCheckins } = await supabase
        .from('check_ins')
        .select(`id, updated_at, goals!check_ins_goal_id_goals_id_fk(goal_sheet_id, goal_sheets!goals_goal_sheet_id_goal_sheets_id_fk(employee_id, users!goal_sheets_employee_id_users_id_fk(id, name, manager_id)))`)
        .eq('window_id', w.id)

      if (!windowCheckins) continue
      const empMap = new Map()
      for (const c of windowCheckins) {
        const empUser = c.goals?.goal_sheets?.users
        if (!empUser || !empUser.manager_id) continue
        if (!empMap.has(empUser.id)) empMap.set(empUser.id, { user: empUser, lastUpdate: new Date(c.updated_at) })
        else if (new Date(c.updated_at) > empMap.get(empUser.id).lastUpdate) empMap.get(empUser.id).lastUpdate = new Date(c.updated_at)
      }

      for (const [empId, info] of empMap.entries()) {
        const checkinDiff = getDiff(today, info.lastUpdate)
        if (checkinDiff <= deadline) continue
        const { data: comments } = await supabase.from('manager_comments').select('id').eq('employee_id', empId).eq('window_id', w.id).limit(1)
        if (!comments || comments.length === 0) {
          const { data: mgr } = await supabase.from('users').select('id, name, email').eq('id', info.user.manager_id).single()
          if (mgr) e4Would.push({ employee: info.user, manager: mgr, quarter: w.quarter })
        }
      }
    }
  }
  if (e4Would.length === 0) {
    console.log(GREEN('       ✅ No E4 escalations would fire.'))
  } else {
    e4Would.forEach(r => console.log(RED(`       🚨 WOULD ESCALATE manager ${r.manager.name} → no review for ${r.employee.name} (${r.quarter})`)))
    totalWouldFire += e4Would.length
  }

  // ── Summary ─────────────────────────────────────────
  console.log(BOLD('\n══════════════════════════════════════════════════'))
  console.log(BOLD(`  Dry-run complete. Total escalations that WOULD fire: ${totalWouldFire === 0 ? GREEN(0) : RED(totalWouldFire)}`))
  if (totalWouldFire > 0) {
    console.log(YELLOW('  To trigger these for real, use the Admin Cron Jobs tab → "Trigger Now" button.'))
  }
  console.log(BOLD('══════════════════════════════════════════════════\n'))
}

main().catch(console.error)
