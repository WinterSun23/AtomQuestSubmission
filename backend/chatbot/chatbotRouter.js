const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')

// Create Supabase client using Service Role Key to bypass RLS and fetch all company data securely on the backend
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Strict Admin Authorization Middleware
const requireAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) {
      return res.status(401).json({ error: 'Authentication token is required.' })
    }
    
    // Validate session token with Supabase Auth
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      return res.status(401).json({ error: 'Invalid or expired session token.' })
    }
    
    // Check if the user is explicitly configured as an 'admin' in the users table
    const { data: profile, error: dbErr } = await supabase
      .from('users')
      .select('role, id')
      .eq('auth_id', user.id)
      .single()
      
    if (dbErr || !profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin role access required.' })
    }
    
    req.user = profile
    next()
  } catch (err) {
    console.error('Admin Auth Middleware error:', err)
    res.status(500).json({ error: 'Authentication internal server error.' })
  }
}

router.post('/chat', requireAdmin, async (req, res) => {
  try {
    const { messages } = req.body
    const groqApiKey = process.env.GROQ_API_KEY

    // 1. Payload validation (Crash Potential Prevention)
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid payload: "messages" must be a valid array.' })
    }

    if (!groqApiKey) {
      return res.status(500).json({ error: 'Missing GROQ_API_KEY in backend environment.' })
    }

    // 2. Fetch live company data from Supabase (Safe select excluding hashes)
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, name, email, role, department_id, manager_id')
    
    const { data: departments, error: deptsErr } = await supabase
      .from('departments')
      .select('id, name')

    const { data: goals, error: goalsErr } = await supabase
      .from('goals')
      .select('id, title, description, uom_type, target, weightage, goal_sheet_id, is_shared')

    const { data: goalSheets, error: sheetsErr } = await supabase
      .from('goal_sheets')
      .select('id, employee_id, cycle_id, status')

    if (usersErr || deptsErr || goalsErr || sheetsErr) {
      console.error('Error fetching database snapshot for chatbot:', { usersErr, deptsErr, goalsErr, sheetsErr })
      return res.status(500).json({ error: 'Failed to retrieve context data from Supabase.' })
    }

    // 3. Map manager/department names for clearer context
    const enrichedUsers = (users || []).map(u => {
      const dept = (departments || []).find(d => d.id === u.department_id)
      const manager = (users || []).find(m => m.id === u.manager_id)
      return {
        name: u.name,
        email: u.email,
        role: u.role,
        department: dept ? dept.name : 'None',
        manager: manager ? manager.name : 'None'
      }
    })

    const enrichedGoals = (goals || []).map(g => {
      const sheet = (goalSheets || []).find(s => s.id === g.goal_sheet_id)
      const owner = sheet ? (users || []).find(u => u.id === sheet.employee_id) : null
      return {
        title: g.title,
        description: g.description,
        uom: g.uom_type,
        target: g.target,
        weightage: g.weightage,
        owner: owner ? owner.name : 'Unknown',
        sheet_status: sheet ? sheet.status : 'unknown'
      }
    })

    // 4. Construct System Prompt with the live DB snapshot
    const systemPrompt = `
You are the GoalFlow Portal AI Assistant. Your job is to help administrators analyze and understand their performance portal data.
You have access to a secure, live database snapshot below. NEVER reveal raw UUIDs or any database keys. Always refer to users, goals, and departments by name.

=== SNAPSHOT OF COMPANY DIRECTORY & HIERARCHY ===
${JSON.stringify(enrichedUsers, null, 2)}

=== SNAPSHOT OF DEPARTMENTS ===
${JSON.stringify((departments || []).map(d => d.name), null, 2)}

=== SNAPSHOT OF ALL STRATEGIC GOALS ===
${JSON.stringify(enrichedGoals, null, 2)}

=== GUIDELINES ===
1. Use only the provided database snapshot to answer questions.
2. Be helpful, professional, and concise.
3. If asked about a user's manager, department, or goals, check the snapshot above and provide a clear answer.
4. If a user asks to modify data, explain that you are read-only and they must use the portal interface.
5. If the requested information is not in the snapshot, politely say you don't have access to that specific information.
6. Absolutely no sensitive data (like passwords, auth tokens, or RLS secrets) are exposed to you. Keep it that way.
`

    // 5. Send request to Groq API
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature: 0.3
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Groq API Error Response:', errText)
      return res.status(response.status).json({ error: 'Error communicating with Groq AI API.' })
    }

    const data = await response.json()
    const reply = data.choices[0].message.content

    res.json({ reply })

  } catch (error) {
    console.error('Chatbot API Exception:', error)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

module.exports = router
