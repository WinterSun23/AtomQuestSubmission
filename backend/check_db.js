require('dotenv').config({ path: '.env' })
require('dotenv').config({ path: 'backend/.env' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  const { data: cycles } = await supabase.from('cycles').select('*')
  console.log('--- Cycles ---')
  console.log(cycles)

  const { data: logs } = await supabase.from('escalation_log').select('*')
  console.log('--- Escalation Logs ---')
  console.log(logs)

  process.exit(0)
}

run()
