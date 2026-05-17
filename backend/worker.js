const { Worker } = require('bullmq')
const { connectionOpts } = require('./queue')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

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

  // 4. Mock Email Delivery
  if (emailEnabled) {
    console.log(`
┌────────────────────────────────────────────────────────────┐
│ ✉️ [MOCK EMAIL SENT VIA BULLMQ]                             │
│ To: ${user.name} <${user.email}>                           │
│ Action: ${actionType}                                      │
│ Subject: Performance Portal Notification                    │
├────────────────────────────────────────────────────────────┤
│ Hello ${user.name},                                        │
│                                                            │
│ ${message}                                                 │
│                                                            │
│ Click here to view details: http://localhost:5173${link}    │
└────────────────────────────────────────────────────────────┘
    `)
  }

  // 5. Mock Teams Delivery
  if (teamsEnabled) {
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
  connection: connectionOpts
})

worker.on('completed', job => {
  console.log(`[Worker] Job ${job.id} completed successfully!`)
})

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed with error:`, err.message)
})

module.exports = worker
