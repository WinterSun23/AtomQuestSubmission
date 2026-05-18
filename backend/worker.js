const { Worker } = require('bullmq')
const { connectionOpts } = require('./queue')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env' })
require('dotenv').config({ path: 'backend/.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

console.log('[Worker] Starting BullMQ Worker consumer...')

const worker = new Worker('notification-queue', async job => {
  const { recipientId, message, link, actionType } = job.data
  console.log(`[Worker] Processing job ${job.id} for recipient ${recipientId}...`)

  // 1. Fetch user details
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('id', recipientId)
    .single()

  if (!user) {
    throw new Error(`Recipient user not found in database: ${recipientId}`)
  }

  // 2. Fetch notification preferences
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', recipientId)
    .maybeSingle()

  const emailEnabled = prefs ? prefs.email_enabled : true
  const teamsEnabled = prefs ? prefs.teams_enabled : false

  const EVENT_SEVERITIES = {
    SUBMIT_GOAL_SHEET: 'medium',
    APPROVE_GOAL_SHEET: 'medium',
    RETURN_GOAL_SHEET: 'high',
    UPDATE_PROGRESS: 'low',
    CHANGE_MANAGER: 'low',
    DEADLINE_REMINDER: 'medium',
    DEADLINE_MISSED: 'high',
    RESOLVE_ESCALATION: 'low'
  }

  const SEVERITY_LEVELS = {
    low: 1,
    medium: 2,
    high: 3
  }

  const eventSeverity = EVENT_SEVERITIES[actionType] || 'low'
  const minEmailSeverity = prefs ? prefs.min_email_severity : 'low'
  const minTeamsSeverity = prefs ? prefs.min_teams_severity : 'low'

  const emailAllowed = emailEnabled && ((SEVERITY_LEVELS[eventSeverity] || 1) >= (SEVERITY_LEVELS[minEmailSeverity] || 1))
  const teamsAllowed = teamsEnabled && ((SEVERITY_LEVELS[eventSeverity] || 1) >= (SEVERITY_LEVELS[minTeamsSeverity] || 1))

  // 3. Deliver In-App notification
  const { error: inAppError } = await supabase.from('notifications').insert({
    user_id: recipientId,
    message: message,
    link: link,
    is_read: false
  })
  
  if (inAppError) {
    console.error(`[Worker] Error inserting in-app notification:`, inAppError.message)
  }

  // 4. Actual Email Delivery
  if (emailAllowed) {
    const { sendActualEmail } = require('./emailService')
    const htmlBody = `
      <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #4F46E5;">Performance Portal Alert</h2>
        <p>Hello <strong>${user.name}</strong>,</p>
        <p style="font-size: 16px; line-height: 1.5;">${message}</p>
        <div style="margin: 25px 0;">
          <a href="http://localhost:5173${link}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">View Portal Details</a>
        </div>
        <hr style="border: 0; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #888;">This is an automated system notification. Please do not reply directly.</p>
      </div>
    `
    await sendActualEmail({
      to: user.email,
      subject: `Performance Portal: ${message.slice(0, 45)}...`,
      htmlBody,
      message,
      actionType
    })
  }

  // 5. Mock Teams Delivery
  if (teamsAllowed) {
    console.log(`
┌────────────────────────────────────────────────────────────┐
│ 💬 [MOCK MS TEAMS ADAPTIVE CARD SENT]                        │
│ Channel/User Direct Alert to: ${user.name}                  │
├────────────────────────────────────────────────────────────┤
│ {                                                          │
│   "type": "AdaptiveCard",                                  │
│   "body": [                                                │
│     { "type": "TextBlock", "text": "🚨 Portal Alert" },     │
│     { "type": "TextBlock", "text": "${message}" }          │
│   ],                                                       │
│   "actions": [                                             │
│     {                                                      │
│       "type": "Action.OpenUrl",                            │
│       "title": "Open Portal",                              │
│       "url": "http://localhost:5173${link}"                │
│     }                                                      │
│   ]                                                        │
│ }                                                          │
└────────────────────────────────────────────────────────────┘
    `)
  }

}, {
  connection: connectionOpts,
  drainDelay: 60 // Wait up to 60 seconds when idle, reducing Upstash commands by 90%+
})

worker.on('completed', job => {
  console.log(`[Worker] Job ${job.id} completed successfully!`)
})

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed with error:`, err.message)
})

module.exports = worker
