require('dotenv').config({ path: '.env' })
require('dotenv').config({ path: 'backend/.env' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const cronScript = require('./cron.js')

// If runEscalations is exported, we can call it. But it's not exported.
// Let's just read the file and eval it, or we can just tell the user to wait a minute since the cron job runs automatically!
