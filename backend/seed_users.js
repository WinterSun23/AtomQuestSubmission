require('dotenv').config({ path: '.env' })
require('dotenv').config({ path: 'backend/.env' })
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing credentials! Please ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your environment.')
  process.exit(1)
}

// Create a Supabase client with the Service Role Key to bypass RLS and use Auth Admin API
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

const SEED_USERS = [
  {
    email: 'cbersq+admin@gmail.com',
    password: 'Password123',
    name: 'ash (Admin)',
    role: 'admin'
  },
  {
    email: 'cbersq+maintainer1@gmail.com',
    password: 'Password123',
    name: 'ash (Manager)',
    role: 'manager'
  },
  {
    email: 'cbersq+maintainer2@gmail.com',
    password: 'Password123',
    name: 'bob (Manager)',
    role: 'manager'
  },
  {
    email: 'cbersq+user1@gmail.com',
    password: 'Password123',
    name: 'ash (Employee)',
    role: 'employee',
    managerEmail: 'cbersq+maintainer1@gmail.com'
  },
  {
    email: 'cbersq+user2@gmail.com',
    password: 'Password123',
    name: 'bob (Employee)',
    role: 'employee',
    managerEmail: 'cbersq+maintainer1@gmail.com'
  },
  {
    email: 'cbersq+user3@gmail.com',
    password: 'Password123',
    name: 'charlie (Employee)',
    role: 'employee',
    managerEmail: 'cbersq+maintainer2@gmail.com'
  }
]

async function seed() {
  console.log('🚀 Starting Supabase Test Users Seeding Script...')

  try {
    // 1. Fetch all existing auth users
    console.log('🔍 Checking existing auth users...')
    const { data: { users: existingAuthUsers }, error: listError } = await supabase.auth.admin.listUsers()
    if (listError) throw listError

    const emailToAuthId = {}

    // 2. Provision or retrieve users in auth
    for (const u of SEED_USERS) {
      const existing = existingAuthUsers.find(au => au.email === u.email)

      if (existing) {
        console.log(`✨ Auth user already exists: ${u.email} (Auth ID: ${existing.id})`)
        emailToAuthId[u.email] = existing.id
      } else {
        console.log(`🆕 Creating new auth user: ${u.email}...`)
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true // Bypasses email confirmation completely!
        })

        if (createError) {
          console.error(`❌ Failed to create auth user ${u.email}:`, createError.message)
          continue
        }

        console.log(`✅ Created auth user: ${u.email} (Auth ID: ${newUser.user.id})`)
        emailToAuthId[u.email] = newUser.user.id
      }
    }

    // Give a short delay to allow the DB trigger to run and auto-provision public.users records
    console.log('⏳ Waiting for public.users trigger synchronization...')
    await new Promise(resolve => setTimeout(resolve, 1500))

    // 3. Update public profiles (roles, names)
    console.log('✏️ Synchronizing public.users roles and display names...')
    const emailToDbId = {}

    for (const u of SEED_USERS) {
      const authId = emailToAuthId[u.email]
      if (!authId) continue

      // Verify or upsert record in public.users
      const { data: existingProfile, error: profileErr } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', authId)
        .maybeSingle()

      let dbId

      if (existingProfile) {
        dbId = existingProfile.id
        // Update role and name
        const { error: updateErr } = await supabase
          .from('users')
          .update({ name: u.name, role: u.role })
          .eq('id', dbId)

        if (updateErr) throw updateErr
      } else {
        // Fallback insert if trigger didn't fire
        const { data: newProfile, error: insertErr } = await supabase
          .from('users')
          .insert({
            auth_id: authId,
            email: u.email,
            name: u.name,
            role: u.role
          })
          .select('id')
          .single()

        if (insertErr) throw insertErr
        dbId = newProfile.id
      }

      console.log(`👤 Profile synced: ${u.email} ➡️ Role: ${u.role}, Name: ${u.name} (DB ID: ${dbId})`)
      emailToDbId[u.email] = dbId
    }

    // 4. Link manager-employee relationships
    console.log('🔗 Linking manager-reporter relationships...')
    for (const u of SEED_USERS) {
      if (u.managerEmail) {
        const employeeDbId = emailToDbId[u.email]
        const managerDbId = emailToDbId[u.managerEmail]

        if (employeeDbId && managerDbId) {
          const { error: linkErr } = await supabase
            .from('users')
            .update({ manager_id: managerDbId })
            .eq('id', employeeDbId)

          if (linkErr) {
            console.error(`❌ Failed to link ${u.email} to manager ${u.managerEmail}:`, linkErr.message)
          } else {
            console.log(`🔗 Successfully linked: ${u.name} reports to ${SEED_USERS.find(s => s.email === u.managerEmail).name}`)
          }
        }
      }
    }

    // 5. Ensure auto active quarter and escalation configuration settings exist in the DB
    console.log('⚙️ Synchronizing app settings configurations...')
    const month = new Date().getMonth() + 1 // 1-12
    let activeQ = 'phase1'
    if (month === 5 || month === 6) activeQ = 'phase1'
    else if (month >= 7 && month <= 9) activeQ = 'Q1'
    else if (month >= 10 && month <= 12) activeQ = 'Q2'
    else if (month === 1 || month === 2) activeQ = 'Q3'
    else if (month === 3 || month === 4) activeQ = 'Q4'

    await supabase.from('app_settings').delete().eq('key', 'email_notifications_level')

    await supabase.from('app_settings').upsert([
      { key: 'auto_active_quarter', value: activeQ, description: 'Automatically calculated active quarter' },
      { key: 'escalation_deadline_days', value: '7', description: 'Duration threshold allowed for submission/approval before escalating' },
      { key: 'escalation_deadline_unit', value: 'days', description: 'Time unit (days, hours, minutes) for the escalation deadline' }
    ])
    console.log(`⚙️ Seeding completed: auto_active_quarter = ${activeQ}, escalation_deadline_days = 7, escalation_deadline_unit = days`)

    console.log('\n🎉 Seeding complete! All test accounts are provisioned, auto-confirmed, and linked successfully!')
    console.log('================================================================================')
    console.log('🔑 Use the following credentials to log in:')
    SEED_USERS.forEach(u => {
      console.log(`   - Role: [${u.role.toUpperCase()}] Email: ${u.email} | Password: ${u.password}`)
    })
    console.log('================================================================================')

  } catch (err) {
    console.error('💥 Seeding aborted due to an error:', err.message)
  }
}

seed()
