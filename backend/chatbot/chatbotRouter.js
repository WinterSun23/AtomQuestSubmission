const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const frontendMap = require('./frontendMap.json')

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

    // 4. Construct System Prompt with the live DB snapshot and JSON schema instructions
    const systemPrompt = `
You are the GoalFlow Portal AI Assistant. Your job is to help users analyze data, navigate the portal, and perform administrative actions.
You must return your response in JSON format. Do not return any text before or after the JSON object.

=== JSON RESPONSE SCHEMA ===
Your response MUST be a single JSON object matching this schema:
{
  "reply": "Your conversational text response (markdown supported). Be concise, helpful, and professional.",
  "action": null | {
    "type": "navigate" | "api_call",
    "path": "/admin/escalations", // Required ONLY for type: "navigate"
    "endpoint": "/api/cron/trigger", // Required ONLY for type: "api_call"
    "method": "POST" | "GET", // Required ONLY for type: "api_call"
    "payload": {}, // Optional, ONLY for type: "api_call"
    "label": "Action Button Label (e.g. 'Go to Escalations', 'Run Escalations')",
    "confirmationPrompt": "Optional prompt to ask the user before calling the API" // Optional, ONLY for type: "api_call"
  }
}

=== KNOWN FRONTEND ROUTES (type: "navigate") ===
Use these routes to navigate the user to different pages when they ask how to see or manage something:
${JSON.stringify(frontendMap.routes, null, 2)}

=== KNOWN API AUTOMATIONS (type: "api_call") ===
Use this to trigger actions on the backend. Always require a confirmation prompt:
${JSON.stringify(frontendMap.api_automations, null, 2)}

=== SNAPSHOT OF COMPANY DIRECTORY & HIERARCHY ===
${JSON.stringify(enrichedUsers, null, 2)}

=== SNAPSHOT OF DEPARTMENTS ===
${JSON.stringify((departments || []).map(d => d.name), null, 2)}

=== SNAPSHOT OF ALL STRATEGIC GOALS ===
${JSON.stringify(enrichedGoals, null, 2)}

=== GUIDELINES ===
1. Use the database snapshot to answer factual questions.
2. If the user asks to go somewhere, see a page, or execute a task listed above, populate the "action" block based on the provided schemas.
3. If no page or API matches the user's intent, set "action" to null.
4. Never suggest admin pages (/admin/*) or admin APIs (/api/cron/*) to non-admin users. Only do so if you see their role is admin or they are in the admin dashboard.
5. Do not reveal database keys or raw UUIDs.
6. Make all explanations, instructions, and replies highly explainable, simple, and intuitive for non-technical users to align with the system's "User Friendliness" goals. Avoid technical developer terms.
`

    // 5. Send request to Groq API with JSON Mode enabled
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        response_format: { type: "json_object" },
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
    const rawReply = data.choices[0].message.content
    
    // Parse JSON safely from LLM response
    let parsedResponse
    try {
      parsedResponse = JSON.parse(rawReply)
    } catch (e) {
      console.error('Failed to parse LLM JSON reply:', rawReply, e)
      parsedResponse = {
        reply: rawReply,
        action: null
      }
    }

    res.json({
      reply: parsedResponse.reply,
      action: parsedResponse.action
    })

  } catch (error) {
    console.error('Chatbot API Exception:', error)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

module.exports = router
