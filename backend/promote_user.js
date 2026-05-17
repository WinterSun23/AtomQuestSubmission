require('dotenv').config({ path: '../.env' })
require('dotenv').config({ path: '.env' })
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function run() {
  const email = process.argv[2] || 'admin@example.com'
  const { data, error } = await supabase
    .from('users')
    .update({ role: 'admin' })
    .eq('email', email)
    .select()

  if (error) {
    console.error('Error promoting user:', error.message)
  } else {
    console.log(`Promoted user ${email} to admin!`, data)
  }
}
run()
