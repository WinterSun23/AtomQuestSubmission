require('dotenv').config({ path: '../.env' })
require('dotenv').config({ path: '.env' })
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function run() {
  const { data, error } = await supabase.from('users').select('name, email, role')
  if (error) {
    console.error('Error fetching users:', error.message)
  } else {
    console.log('Available Users in Database:')
    console.log(JSON.stringify(data, null, 2))
  }
}
run()
