require('dotenv').config({ path: '../.env' })
require('dotenv').config({ path: '.env' })
const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')
const exceljs = require('exceljs')
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

const app = express()
app.use(cors())
app.use(express.json())

// Create Supabase client using Service Role Key to bypass RLS
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  console.error("Missing VITE_SUPABASE_URL. Ensure it is in the .env file in the root directory.")
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[WARNING] SUPABASE_SERVICE_ROLE_KEY is missing. Falling back to VITE_SUPABASE_ANON_KEY. Note: Some RLS-protected queries might require active auth.")
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// ─── S3 Configuration & Client ──────────────────────────────────────────────
const s3Endpoint = process.env.S3_ENDPOINT
const s3Client = s3Endpoint ? new S3Client({
  forcePathStyle: true,
  region: process.env.S3_REGION || 'ap-south-1',
  endpoint: s3Endpoint,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || 'bbiseaaabhzsfskvqizl',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  }
}) : null

// Save to storage helper with fallback
async function saveReportToStorage(client, fileName, buffer) {
  if (s3Client) {
    try {
      console.log('Attempting to upload to S3 compatible gateway:', fileName)
      const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET || 'reports',
        Key: fileName,
        Body: buffer,
        ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      await s3Client.send(command)
      console.log('S3 upload succeeded!')
      return 's3'
    } catch (err) {
      console.error('S3 upload failed, falling back to Supabase client API:', err.message)
    }
  }

  // Fallback using scoped client
  console.log('Uploading using Supabase Storage client API:', fileName)
  const { error: uploadErr } = await client.storage.from('reports').upload(fileName, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true
  })
  if (uploadErr) throw uploadErr
  return 'supabase'
}

// Retrieve signed URL from storage helper
async function getReportSignedUrl(client, fileName) {
  if (s3Client) {
    try {
      console.log('Generating signed URL via S3 client:', fileName)
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET || 'reports',
        Key: fileName
      })
      const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 })
      console.log('S3 presigned URL generated successfully!')
      return url
    } catch (err) {
      console.error('S3 presigned URL generation failed, falling back to Supabase client API:', err.message)
    }
  }

  // Fallback using scoped client
  console.log('Generating signed URL using Supabase Storage client API:', fileName)
  const { data, error } = await client.storage.from('reports').createSignedUrl(fileName, 60 * 60)
  if (error) throw error
  return data.signedUrl
}

// List objects from storage helper
async function listReportsFromStorage(client) {
  if (s3Client) {
    try {
      console.log('Listing bucket contents via S3 client...')
      const command = new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET || 'reports'
      })
      const response = await s3Client.send(command)
      const contents = response.Contents || []
      return contents.map(item => ({
        name: item.Key,
        created_at: item.LastModified || new Date(),
        metadata: { size: item.Size || 0 }
      }))
    } catch (err) {
      console.error('S3 list objects failed, falling back to Supabase client API:', err.message)
    }
  }

  // Fallback using scoped client
  console.log('Listing bucket contents using Supabase Storage client API...')
  const { data, error } = await client.storage.from('reports').list()
  if (error) throw error
  return (data || []).map(item => ({
    name: item.name,
    created_at: item.created_at || new Date(),
    metadata: { size: item.metadata?.size || 0 }
  }))
}

// Middleware to verify user role from frontend token
const requireRole = (roles) => async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token provided' })
  
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })
  
  const { data: profile } = await supabase.from('users').select('role, id').eq('auth_id', user.id).single()
  if (!profile || !roles.includes(profile.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  
  req.user = profile
  next()
}

// Generate Achievement Report
app.get('/api/reports/achievement', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const { cycleId, departmentId, quarter } = req.query
    
    // Fetch base data
    let usersQuery = supabase.from('users').select('id, name, department_id, departments(name)')
    if (req.user.role === 'manager') {
      usersQuery = usersQuery.eq('manager_id', req.user.id)
    }
    if (departmentId) {
      usersQuery = usersQuery.eq('department_id', departmentId)
    }
    const { data: users, error: usersErr } = await usersQuery
    if (usersErr) throw usersErr
    
    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'No users found for this report' })
    }
    
    const userIds = users.map(u => u.id)
    
    // If quarter is provided, fetch the corresponding window ID first (safely order and limit 1 to avoid PGRST116)
    let targetWindowId = null
    if (quarter && cycleId) {
      const { data: windows } = await supabase
        .from('check_in_windows')
        .select('id')
        .eq('cycle_id', cycleId)
        .eq('quarter', quarter)
        .order('window_open', { ascending: false })
        .limit(1)
      if (windows && windows[0]) targetWindowId = windows[0].id
    }

    // Fetch goal sheets for these users
    let sheetsQuery = supabase.from('goal_sheets').select(`
      id, employee_id, cycle_id,
      goals (
        id, title, thrust_area_id, thrust_areas(name), uom_type, target, target_date, weightage,
        check_ins (actual_achievement, actual_date, status, computed_score, window_id)
      )
    `).in('employee_id', userIds)
    
    if (cycleId) sheetsQuery = sheetsQuery.eq('cycle_id', cycleId)
    const { data: sheets, error: sheetsErr } = await sheetsQuery
    if (sheetsErr) throw sheetsErr

    // Generate Excel
    const workbook = new exceljs.Workbook()
    const sheetTitle = quarter ? `Achievement Report ${quarter}` : 'Achievement Report'
    const sheet = workbook.addWorksheet(sheetTitle)
    sheet.columns = [
      { header: 'Employee', key: 'employee', width: 25 },
      { header: 'Department', key: 'department', width: 25 },
      { header: 'Goal Title', key: 'goal', width: 40 },
      { header: 'Thrust Area', key: 'thrust_area', width: 20 },
      { header: 'UoM', key: 'uom', width: 15 },
      { header: 'Target', key: 'target', width: 15 },
      { header: 'Actual', key: 'actual', width: 15 },
      { header: 'Weightage %', key: 'weightage', width: 15 },
      { header: 'Score %', key: 'score', width: 15 },
      { header: 'Weighted Score', key: 'weighted_score', width: 15 },
    ]

    sheets.forEach(s => {
      const user = users.find(u => u.id === s.employee_id)
      s.goals.forEach(g => {
        let targetCheckins = g.check_ins || []
        if (targetWindowId) {
          targetCheckins = targetCheckins.filter(c => c.window_id === targetWindowId)
        }
        
        const checkin = targetCheckins[0] || {}
        const score = checkin.computed_score || 0
        const weightedScore = (score * (g.weightage / 100))
        
        sheet.addRow({
          employee: user?.name,
          department: user?.departments?.name || '-',
          goal: g.title,
          thrust_area: g.thrust_areas?.name || '-',
          uom: g.uom_type,
          target: g.target_date || g.target,
          actual: checkin.actual_date || checkin.actual_achievement || '-',
          weightage: g.weightage,
          score: score.toFixed(2),
          weighted_score: weightedScore.toFixed(2)
        })
      })
    })

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer()
    
    // Create unique filename based on criteria to prevent duplicates
    const fileName = `achievement_report_cycle_${cycleId || 'all'}_dept_${departmentId || 'all'}_quarter_${quarter || 'all'}_manager_${req.user.id}.xlsx`
    
    // Create scoped Supabase client with the user's JWT token
    const token = req.headers.authorization?.split(' ')[1]
    const userClient = createClient(supabaseUrl, token)

    // Save to storage
    await saveReportToStorage(userClient, fileName, buffer)

    // Log report generation
    try {
      const { logEventAndNotify } = require('./eventRouter')
      await logEventAndNotify(supabase, {
        actorId: req.user.id,
        action: 'GENERATE_REPORT',
        description: `${req.user.role === 'admin' ? 'Admin' : 'Manager'} generated achievement report: ${fileName}`
      })
    } catch (logErr) {
      console.error('[server.js] Failed to log report generation event:', logErr.message)
    }
    
    // Get URL
    const signedUrl = await getReportSignedUrl(userClient, fileName)

    res.json({ success: true, url: signedUrl })

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error', details: err.message })
  }
})

// List reports
app.get('/api/reports/list', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    const userClient = createClient(supabaseUrl, token)
    const list = await listReportsFromStorage(userClient)
    res.json({ success: true, reports: list })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to list reports', details: err.message })
  }
})

// Download / Get Signed URL
app.get('/api/reports/download/:fileName', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const { fileName } = req.params
    const token = req.headers.authorization?.split(' ')[1]
    const userClient = createClient(supabaseUrl, token)
    const url = await getReportSignedUrl(userClient, fileName)
    res.json({ success: true, url })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to retrieve report signed link', details: err.message })
  }
})

// Log Event and Notify dynamically from frontend
app.post('/api/events/log', requireRole(['employee', 'manager', 'admin']), async (req, res) => {
  try {
    const { logEventAndNotify } = require('./eventRouter')
    const { action, goalId, goalSheetId, fieldChanged, oldValue, newValue, reason, description } = req.body
    
    await logEventAndNotify(supabase, {
      actorId: req.user.id,
      action,
      goalId,
      goalSheetId,
      fieldChanged,
      oldValue,
      newValue,
      reason,
      description
    })
    
    res.json({ success: true })
  } catch (err) {
    console.error('[server.js] Error in /api/events/log:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Trigger Cron manually for testing
app.post('/api/cron/trigger', async (req, res) => {
  const { runEscalations, updateActiveQuarter } = require('./cron')
  await updateActiveQuarter(supabase)
  await runEscalations(supabase)
  res.json({ success: true, message: 'Cron job executed' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`)
  // Start cron jobs
  require('./cron').startCron(supabase)
  // Start background queue worker
  require('./worker')
})
