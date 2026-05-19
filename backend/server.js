require('dotenv').config({ path: '.env' })
require('dotenv').config({ path: 'backend/.env' })
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
    const { cycleId, quarter } = req.query
    
    // Fetch base data
    let usersQuery = supabase.from('users').select('id, name, email, manager_id, departments(name)')
    if (req.user.role === 'manager') {
      usersQuery = usersQuery.eq('manager_id', req.user.id)
    }
    const { data: users, error: usersErr } = await usersQuery
    if (usersErr) throw usersErr
    
    // Fetch all managers for mapping
    const { data: allManagers } = await supabase.from('users').select('id, name').in('role', ['manager', 'admin'])
    
    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'No users found for this report' })
    }
    
    const userIds = users.map(u => u.id)
    
    // If quarter is provided, fetch the corresponding window ID first
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

    // Fetch cycle metadata details
    let cycleInfo = null
    if (cycleId) {
      const { data: cycleData } = await supabase
        .from('cycles')
        .select('name, goal_window_start, goal_window_end')
        .eq('id', cycleId)
        .maybeSingle()
      cycleInfo = cycleData
    }

    // Fetch goal sheets for these users including rework notes and timestamps
    let sheetsQuery = supabase.from('goal_sheets').select(`
      id, employee_id, cycle_id, status, rework_note, submitted_at, approved_at,
      goals (
        id, title, description, thrust_area_id, thrust_areas(name), uom_type, target, target_date, weightage, is_shared,
        check_ins (actual_achievement, actual_date, status, computed_score, window_id, manager_comment, updated_at, check_in_windows(window_open))
      )
    `).in('employee_id', userIds)
    
    if (cycleId) sheetsQuery = sheetsQuery.eq('cycle_id', cycleId)
    const { data: sheets, error: sheetsErr } = await sheetsQuery
    if (sheetsErr) throw sheetsErr

    // Group employees by manager and sort alphabetically
    const managerGroups = {}
    users.forEach(u => {
      const mId = u.manager_id || 'unassigned'
      const mName = allManagers?.find(m => m.id === u.manager_id)?.name || 'Unassigned / Independent'
      
      if (!managerGroups[mId]) {
        managerGroups[mId] = {
          managerName: mName,
          employees: []
        }
      }
      managerGroups[mId].employees.push(u)
    })

    const sortedGroups = Object.keys(managerGroups)
      .map(key => ({
        managerId: key,
        managerName: managerGroups[key].managerName,
        employees: managerGroups[key].employees
      }))
      .sort((a, b) => a.managerName.localeCompare(b.managerName))

    // Generate Excel
    const workbook = new exceljs.Workbook()
    
    // Calculate Summary Metrics
    let totalGoals = 0
    let sumWeightage = 0
    let sumScore = 0
    let sumWeightedScore = 0

    sheets.forEach(s => {
      s.goals.forEach(g => {
        totalGoals++
        sumWeightage += g.weightage
        
        let targetCheckins = g.check_ins || []
        if (targetWindowId) {
          targetCheckins = targetCheckins.filter(c => c.window_id === targetWindowId)
        } else {
          // Sort by window_open date descending to get the latest check-in
          targetCheckins.sort((a, b) => new Date(b.check_in_windows?.window_open || 0) - new Date(a.check_in_windows?.window_open || 0))
        }
        const checkin = targetCheckins[0] || {}
        const score = checkin.computed_score || 0
        const weightedScore = score * (g.weightage / 100)

        sumScore += score
        sumWeightedScore += weightedScore
      })
    })

    const avgWeightage = totalGoals > 0 ? (sumWeightage / totalGoals) : 0
    const avgScore = totalGoals > 0 ? (sumScore / totalGoals) : 0
    const avgWeightedScore = totalGoals > 0 ? (sumWeightedScore / totalGoals) : 0

    // ── Worksheet 1: Overview & Executive Summary ──
    const summarySheet = workbook.addWorksheet('Executive Summary')
    
    // Add title block
    summarySheet.mergeCells('A1:D1')
    const titleCell = summarySheet.getCell('A1')
    titleCell.value = 'GoalFlow Performance & Achievement Executive Summary'
    titleCell.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFFFF' } }
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    summarySheet.getRow(1).height = 40

    // Add empty space
    summarySheet.addRow([])

    // Add metadata
    summarySheet.addRow(['Report Metadata', '', '', ''])
    summarySheet.mergeCells('A3:D3')
    const metaHeaderCell = summarySheet.getCell('A3')
    metaHeaderCell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF1F2937' } }
    metaHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
    summarySheet.getRow(3).height = 20

    const cycleScopedText = cycleInfo 
      ? `${cycleInfo.name} (${new Date(cycleInfo.goal_window_start).toLocaleDateString()} to ${new Date(cycleInfo.goal_window_end).toLocaleDateString()})` 
      : (cycleId || 'All Active Cycles')

    summarySheet.addRow(['Generated By:', req.user.role === 'admin' ? 'Organization Admin' : 'Reporting Manager', 'Generated At:', new Date().toLocaleString()])
    summarySheet.addRow(['Quarter Filter:', quarter || 'All Quarters', 'Cycle Scoped:', cycleScopedText])
    
    // Format metadata rows
    for (let r = 4; r <= 5; r++) {
      summarySheet.getRow(r).height = 18
      summarySheet.getRow(r).eachCell(c => {
        c.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF4B5563' } }
      })
    }

    summarySheet.addRow([]) // Spacer

    // Add Metrics Header
    summarySheet.addRow(['Key Performance Metrics', '', '', ''])
    summarySheet.mergeCells('A7:D7')
    const metricsHeaderCell = summarySheet.getCell('A7')
    metricsHeaderCell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF1F2937' } }
    metricsHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
    summarySheet.getRow(7).height = 20

    // Add Metrics Rows
    summarySheet.addRow(['Total Employees Tracked', users.length, 'Total Goal Sheets Enrolled', sheets.length])
    summarySheet.addRow(['Total Strategic Goals', totalGoals, 'Average Goal Weightage', `${avgWeightage.toFixed(1)}%`])
    summarySheet.addRow(['Average Goal Score', `${avgScore.toFixed(1)}%`, 'Average Weighted Performance', `${avgWeightedScore.toFixed(1)}%`])

    // Style the metrics cards
    for (let r = 8; r <= 10; r++) {
      summarySheet.getRow(r).height = 24
      summarySheet.getRow(r).eachCell((cell, colIndex) => {
        const isLabel = colIndex === 1 || colIndex === 3
        cell.font = { name: 'Segoe UI', size: 10, bold: isLabel, color: { argb: isLabel ? 'FF374151' : 'FF4F46E5' } }
        cell.alignment = { horizontal: isLabel ? 'left' : 'right', vertical: 'middle' }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        }
      })
    }

    summarySheet.getColumn('A').width = 25
    summarySheet.getColumn('B').width = 18
    summarySheet.getColumn('C').width = 25
    summarySheet.getColumn('D').width = 18

    // ── Worksheet 2: Completion Dashboard ──
    const completionSheet = workbook.addWorksheet('Completion Dashboard')
    completionSheet.columns = [
      { header: 'Employee Name', key: 'employee', width: 25 },
      { header: 'Employee Email', key: 'email', width: 28 },
      { header: 'Department', key: 'department', width: 22 },
      { header: 'Goal Sheet Status', key: 'sheet_status', width: 18 },
      { header: 'Submitted At', key: 'submitted_at', width: 20 },
      { header: 'Approved At', key: 'approved_at', width: 20 },
      { header: 'Rework Notes', key: 'rework_note', width: 35 },
      { header: 'Total Goals', key: 'total_goals', width: 15 },
      { header: 'Goals Updated', key: 'goals_updated', width: 18 },
      { header: 'Completion %', key: 'completion_pct', width: 18 },
      { header: 'Check-in Status', key: 'status', width: 20 },
    ]

    sortedGroups.forEach(group => {
      // Add manager divider header row
      const mgrHeaderRow = completionSheet.addRow({
        employee: `MANAGER: ${group.managerName.toUpperCase()}`,
        email: '',
        department: '',
        sheet_status: '',
        submitted_at: '',
        approved_at: '',
        rework_note: '',
        total_goals: '',
        goals_updated: '',
        completion_pct: '',
        status: ''
      })
      
      const rowNum = mgrHeaderRow.number
      completionSheet.mergeCells(`A${rowNum}:K${rowNum}`)
      
      const cell = completionSheet.getCell(`A${rowNum}`)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } } // Premium Lavender Fill
      cell.font = { name: 'Segoe UI', bold: true, color: { argb: 'FF3730A3' }, size: 11 }
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
      mgrHeaderRow.height = 28

      group.employees.forEach(u => {
        const userSheets = sheets.filter(s => s.employee_id === u.id)
        
        if (userSheets.length === 0) {
          completionSheet.addRow({
            employee: u.name,
            email: u.email,
            department: u.departments?.name || '-',
            sheet_status: 'NOT CREATED',
            submitted_at: '-',
            approved_at: '-',
            rework_note: '-',
            total_goals: 0,
            goals_updated: 0,
            completion_pct: '0%',
            status: 'NO GOALS'
          })
        } else {
          userSheets.forEach(s => {
            let gTotal = s.goals?.length || 0
            let gUpdated = 0
            s.goals?.forEach(g => {
              let targetCheckins = g.check_ins || []
              if (targetWindowId) {
                targetCheckins = targetCheckins.filter(c => c.window_id === targetWindowId)
              } else {
                targetCheckins.sort((a, b) => new Date(b.check_in_windows?.window_open || 0) - new Date(a.check_in_windows?.window_open || 0))
              }
              const checkin = targetCheckins[0]
              if (checkin && checkin.status !== 'not_started') {
                gUpdated++
              }
            })
            
            let pct = gTotal > 0 ? Math.round((gUpdated / gTotal) * 100) : 0
            let statusText = pct === 100 ? 'COMPLETED' : (pct > 0 ? 'IN PROGRESS' : 'NOT STARTED')
            
            completionSheet.addRow({
              employee: u.name,
              email: u.email,
              department: u.departments?.name || '-',
              sheet_status: (s.status || 'draft').replace('_', ' ').toUpperCase(),
              submitted_at: s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '-',
              approved_at: s.approved_at ? new Date(s.approved_at).toLocaleString() : '-',
              rework_note: s.rework_note || '-',
              total_goals: gTotal,
              goals_updated: gUpdated,
              completion_pct: `${pct}%`,
              status: statusText
            })
          })
        }
      })
    })

    // Stylize Completion Dashboard
    const compHeaderRow = completionSheet.getRow(1)
    compHeaderRow.height = 30
    compHeaderRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } }
      cell.font = { name: 'Segoe UI', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'medium', color: { argb: 'FF10B981' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
      }
    })

    completionSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      
      const firstCellVal = row.getCell(1).value
      if (typeof firstCellVal === 'string' && firstCellVal.startsWith('MANAGER:')) {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFC7D2FE' } },
            bottom: { style: 'thin', color: { argb: 'FFC7D2FE' } },
            left: { style: 'thin', color: { argb: 'FFC7D2FE' } },
            right: { style: 'thin', color: { argb: 'FFC7D2FE' } }
          }
        })
        return
      }

      row.height = 22
      const isEven = rowNumber % 2 === 0
      row.eachCell((cell) => {
        cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF333333' } }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        }
        if (isEven) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }
        }
      })
      row.getCell('total_goals').alignment = { horizontal: 'center', vertical: 'middle' }
      row.getCell('goals_updated').alignment = { horizontal: 'center', vertical: 'middle' }
      row.getCell('completion_pct').alignment = { horizontal: 'right', vertical: 'middle' }
    })

    // ── Worksheet 3: Detailed Achievements ──
    const detailSheetTitle = quarter ? `Detailed Achievements (${quarter})` : 'Detailed Achievements'
    const sheet = workbook.addWorksheet(detailSheetTitle)
    sheet.columns = [
      { header: 'Employee Name', key: 'employee', width: 25 },
      { header: 'Employee Email', key: 'email', width: 28 },
      { header: 'Department', key: 'department', width: 22 },
      { header: 'Goal Sheet Status', key: 'sheet_status', width: 18 },
      { header: 'Submitted At', key: 'submitted_at', width: 20 },
      { header: 'Approved At', key: 'approved_at', width: 20 },
      { header: 'Goal Type', key: 'goal_type', width: 15 },
      { header: 'Goal Title', key: 'goal', width: 45 },
      { header: 'Goal Description', key: 'description', width: 50 },
      { header: 'Thrust Area', key: 'thrust_area', width: 22 },
      { header: 'UoM', key: 'uom', width: 15 },
      { header: 'Planned Target', key: 'target', width: 18 },
      { header: 'Actual Achievement', key: 'actual', width: 18 },
      { header: 'Actual Date', key: 'actual_date', width: 15 },
      { header: 'Check-in Status', key: 'checkin_status', width: 18 },
      { header: 'Manager Comment', key: 'manager_comment', width: 45 },
      { header: 'Last Progress Logged', key: 'last_logged', width: 20 },
      { header: 'Weightage %', key: 'weightage', width: 15 },
      { header: 'Progress Score %', key: 'score', width: 18 },
      { header: 'Weighted Score', key: 'weighted_score', width: 18 },
    ]

    sortedGroups.forEach(group => {
      // Add manager divider header row
      const mgrHeaderRow = sheet.addRow({
        employee: `MANAGER: ${group.managerName.toUpperCase()}`,
        email: '',
        department: '',
        sheet_status: '',
        submitted_at: '',
        approved_at: '',
        goal_type: '',
        goal: '',
        description: '',
        thrust_area: '',
        uom: '',
        target: '',
        actual: '',
        actual_date: '',
        checkin_status: '',
        manager_comment: '',
        last_logged: '',
        weightage: '',
        score: '',
        weighted_score: ''
      })
      
      const rowNum = mgrHeaderRow.number
      sheet.mergeCells(`A${rowNum}:T${rowNum}`)
      
      const cell = sheet.getCell(`A${rowNum}`)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } } // Premium Lavender Fill
      cell.font = { name: 'Segoe UI', bold: true, color: { argb: 'FF3730A3' }, size: 11 }
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
      mgrHeaderRow.height = 28

      group.employees.forEach(u => {
        const userSheets = sheets.filter(s => s.employee_id === u.id)
        
        userSheets.forEach(s => {
          s.goals.forEach(g => {
            let targetCheckins = g.check_ins || []
            if (targetWindowId) {
              targetCheckins = targetCheckins.filter(c => c.window_id === targetWindowId)
            } else {
              targetCheckins.sort((a, b) => new Date(b.check_in_windows?.window_open || 0) - new Date(a.check_in_windows?.window_open || 0))
            }
            
            const checkin = targetCheckins[0] || {}
            const score = checkin.computed_score || 0
            const weightedScore = (score * (g.weightage / 100))
            
            sheet.addRow({
              employee: u.name,
              email: u.email || '-',
              department: u.departments?.name || '-',
              sheet_status: (s.status || 'draft').replace('_', ' ').toUpperCase(),
              submitted_at: s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '-',
              approved_at: s.approved_at ? new Date(s.approved_at).toLocaleString() : '-',
              goal_type: g.is_shared ? 'SHARED' : 'PERSONAL',
              goal: g.title,
              description: g.description || '-',
              thrust_area: g.thrust_areas?.name || '-',
              uom: g.uom_type?.replace('_', ' '),
              target: g.uom_type === 'timeline' ? g.target_date : g.target,
              actual: checkin.actual_achievement || '-',
              actual_date: checkin.actual_date || '-',
              checkin_status: (checkin.status || 'not started').replace('_', ' ').toUpperCase(),
              manager_comment: checkin.manager_comment || '-',
              last_logged: checkin.updated_at ? new Date(checkin.updated_at).toLocaleString() : '-',
              weightage: g.weightage,
              score: score.toFixed(2),
              weighted_score: weightedScore.toFixed(2)
            })
          })
        })
      })
    })

    // ── Stylize the Excel Sheet for Corporate Branded UI ──
    const headerRow = sheet.getRow(1)
    headerRow.height = 30
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4F46E5' } // Branded Indigo Header
      }
      cell.font = {
        name: 'Segoe UI',
        bold: true,
        color: { argb: 'FFFFFFFF' },
        size: 11
      }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'medium', color: { argb: 'FF4F46E5' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
      }
    })

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      
      const firstCellVal = row.getCell(1).value
      if (typeof firstCellVal === 'string' && firstCellVal.startsWith('MANAGER:')) {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFC7D2FE' } },
            bottom: { style: 'thin', color: { argb: 'FFC7D2FE' } },
            left: { style: 'thin', color: { argb: 'FFC7D2FE' } },
            right: { style: 'thin', color: { argb: 'FFC7D2FE' } }
          }
        })
        return
      }
      
      row.height = 22
      const isEven = rowNumber % 2 === 0
      
      row.eachCell((cell) => {
        cell.font = {
          name: 'Segoe UI',
          size: 10,
          color: { argb: 'FF333333' }
        }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        }
        
        if (isEven) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF9FAFB' } // Zebra striping
          }
        }
      })
      
      row.getCell('weightage').alignment = { horizontal: 'right', vertical: 'middle' }
      row.getCell('score').alignment = { horizontal: 'right', vertical: 'middle' }
      row.getCell('weighted_score').alignment = { horizontal: 'right', vertical: 'middle' }
    })

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer()
    
    // Create unique filename based on criteria to prevent duplicates
    const fileName = `achievement_report_cycle_${cycleId || 'all'}_quarter_${quarter || 'all'}_manager_${req.user.id}.xlsx`
    
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

// Chatbot route
app.use('/api/chatbot', require('./chatbot/chatbotRouter'))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`)
  // Start cron jobs
  require('./cron').startCron(supabase)
  // Start background queue worker
  require('./worker')
})
