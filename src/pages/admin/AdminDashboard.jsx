import { useState, useEffect } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { getAdminSummary, getEscalations, resolveEscalation, getQuarterlyAdminStats } from '../../lib/adminApi'
import { triggerBackgroundCron } from '../../lib/backendApi'
import { supabase } from '../../lib/supabase'

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']
const RULE_LABELS = {
  E1: 'Goals not submitted',
  E2: 'Goals not approved',
  E3: 'Check-in not completed',
  E4: 'Manager review overdue',
}

const LEVEL_LABELS = { '1': 'Notified employee', '2': 'Notified manager', '3': 'Escalated to HR' }

export default function AdminDashboard() {
  const [summary,     setSummary]     = useState(null)
  const [escalations, setEscalations] = useState([])
  const [resolving,   setResolving]   = useState(null)
  const [note,        setNote]        = useState('')

  // Top-level tabs: 'analytics' or 'cron'
  const [mainTab, setMainTab] = useState('analytics')
  
  // Real-time Tracker variables
  const [trackerTab, setTrackerTab] = useState('phase1') // 'phase1', 'Q1', 'Q2', 'Q3', 'Q4'
  const [trackerData, setTrackerData] = useState([])

  // Analytics Filter variables
  const [analyticsLevel, setAnalyticsLevel] = useState('org') // 'org', 'team_alice', 'team_bob', 'user_1'
  const [activeTab, setActiveTab] = useState('Q1')
  const [quarterStats, setQuarterStats] = useState(null)
  const [qoqData, setQoqData] = useState({ Q1: null, Q2: null, Q3: null, Q4: null })
  const [thrustStats, setThrustStats] = useState([])
  const [uomStats, setUomStats] = useState([])
  const [statusStats, setStatusStats] = useState([])

  // Cron triggering variables
  const [triggering, setTriggering] = useState(false)
  const [triggerMessage, setTriggerMessage] = useState('')

  // Live Settings
  const [settingsList, setSettingsList] = useState([])

  const [matrixData, setMatrixData] = useState([])
  const [managersStats, setManagersStats] = useState([])
  const [allEmployeesList, setAllEmployeesList] = useState([])
  const [allManagersList, setAllManagersList] = useState([])

  // Modal open states
  const [isTrackerModalOpen, setIsTrackerModalOpen] = useState(false)
  const [isManagerModalOpen, setIsManagerModalOpen] = useState(false)
  
  // Modal filter states
  const [trackerSearch, setTrackerSearch] = useState('')
  const [trackerStatusFilter, setTrackerStatusFilter] = useState('all')
  const [managerSearch, setManagerSearch] = useState('')
  const [managerFilter, setManagerFilter] = useState('all')

  async function load() {
    const [s, e, qStats, q1, q2, q3, q4, goalsRes, usersRes, sheetsRes, settingsRes, windowsRes] = await Promise.all([
      getAdminSummary(), 
      getEscalations({ resolved: false }),
      getQuarterlyAdminStats(activeTab),
      getQuarterlyAdminStats('Q1'),
      getQuarterlyAdminStats('Q2'),
      getQuarterlyAdminStats('Q3'),
      getQuarterlyAdminStats('Q4'),
      supabase.from('goals').select('id, thrust_areas:thrust_area_id(name), uom_type, check_ins(status)'),
      supabase.from('users').select('id, name, role, manager_id'),
      supabase.from('goal_sheets').select(`
        id, employee_id, status, cycle_id,
        goals(
          id,
          check_ins(window_id, status)
        )
      `),
      supabase.from('app_settings').select('*'),
      supabase.from('check_in_windows').select('id, quarter')
    ])

    setSummary(s)
    setEscalations(e)
    setQuarterStats(qStats)
    setQoqData({ Q1: q1, Q2: q2, Q3: q3, Q4: q4 })
    if (settingsRes.data) setSettingsList(settingsRes.data)

    // Compute goal distributions
    if (goalsRes.data && goalsRes.data.length > 0) {
      // 1. Thrust areas
      const thrustCounts = {}
      goalsRes.data.forEach(g => {
        const name = g.thrust_areas?.name || 'Unassigned'
        thrustCounts[name] = (thrustCounts[name] || 0) + 1
      })
      setThrustStats(Object.keys(thrustCounts).map(name => ({
        name,
        count: thrustCounts[name],
        percentage: (thrustCounts[name] / goalsRes.data.length) * 100
      })))

      // 2. UoM types
      const uomCounts = {}
      goalsRes.data.forEach(g => {
        const type = g.uom_type?.replace('_', ' ') || 'Unassigned'
        uomCounts[type] = (uomCounts[type] || 0) + 1
      })
      setUomStats(Object.keys(uomCounts).map(name => ({
        name,
        percentage: (uomCounts[name] / goalsRes.data.length) * 100
      })))

      // 3. Statuses
      const statusCounts = { not_started: 0, on_track: 0, completed: 0 }
      goalsRes.data.forEach(g => {
        const checkin = g.check_ins?.[0]
        const st = checkin?.status || 'not_started'
        statusCounts[st] = (statusCounts[st] || 0) + 1
      })
      setStatusStats(Object.keys(statusCounts).map(name => ({
        name: name.replace('_', ' '),
        percentage: (statusCounts[name] / goalsRes.data.length) * 100
      })))
    }

    // Compile real-time tracker details
    if (usersRes.data) {
      const allUsers = usersRes.data
      const employees = allUsers.filter(u => u.role === 'employee')
      const managerMap = {}
      allUsers.forEach(u => {
        managerMap[u.id] = u.name
      })

      const windows = windowsRes.data || []

      const compiledTracker = employees.map(emp => {
        const managerName = emp.manager_id ? managerMap[emp.manager_id] || 'L1 Manager' : 'No Manager Assigned'
        const empSheet = (sheetsRes.data || []).find(s => s.employee_id === emp.id)
        
        // Status checks
        const sheetStatus = empSheet ? empSheet.status : 'not_started'
        
        // Check-in status per quarter
        const qCheckins = { Q1: 'Pending', Q2: 'Pending', Q3: 'Pending', Q4: 'Pending', phase1: 'Pending' }
        if (empSheet) {
          qCheckins.phase1 = empSheet.status === 'approved' ? 'Completed' : 'Draft'
        }
        
        if (empSheet && empSheet.goals) {
          empSheet.goals.forEach(g => {
            if (g.check_ins) {
              g.check_ins.forEach(c => {
                 const w = windows.find(win => win.id === c.window_id)
                 if (w) {
                   const qKey = w.quarter
                   qCheckins[qKey] = c.status === 'approved' || c.status === 'submitted' ? 'Completed' : 'Pending'
                 }
              })
            }
          })
        }

        return {
          id: emp.id,
          name: emp.name,
          manager: managerName,
          goalSheetStatus: sheetStatus,
          qCheckins
        }
      })
      setTrackerData(compiledTracker)

      // Dynamic L1 Manager Teams Heatmap Matrix calculation
      const managers = allUsers.filter(u => u.role === 'manager' || u.role === 'admin' || allUsers.some(sub => sub.manager_id === u.id))
      const managerTeamsMap = {}
      
      managers.forEach(m => {
        managerTeamsMap[m.id] = {
          unit: `${m.name}'s Team`,
          q1Count: 0, q2Count: 0, q3Count: 0, q4Count: 0,
          totalSubs: 0
        }
      })
      
      employees.forEach(emp => {
        const row = compiledTracker.find(tr => tr.id === emp.id)
        if (row && emp.manager_id && managerTeamsMap[emp.manager_id]) {
          const team = managerTeamsMap[emp.manager_id]
          team.totalSubs++
          if (row.qCheckins.Q1 === 'Completed') team.q1Count++
          if (row.qCheckins.Q2 === 'Completed') team.q2Count++
          if (row.qCheckins.Q3 === 'Completed') team.q3Count++
          if (row.qCheckins.Q4 === 'Completed') team.q4Count++
        }
      })
      
      const dynamicMatrix = Object.values(managerTeamsMap)
        .filter(t => t.totalSubs > 0)
        .map(t => ({
          unit: t.unit,
          q1: Math.round((t.q1Count / t.totalSubs) * 100) || 0,
          q2: Math.round((t.q2Count / t.totalSubs) * 100) || 0,
          q3: Math.round((t.q3Count / t.totalSubs) * 100) || 0,
          q4: Math.round((t.q4Count / t.totalSubs) * 100) || 0
        }))
      setMatrixData(dynamicMatrix)

      const dynamicManagersList = Object.values(managerTeamsMap)
        .filter(t => t.totalSubs > 0)
        .map(t => {
          const avgVerification = Math.round(((t.q1Count + t.q2Count + t.q3Count + t.q4Count) / (t.totalSubs * 4)) * 100) || 0
          return {
            name: t.unit.replace("'s Team", ""),
            verification: avgVerification,
            subCount: t.totalSubs
          }
        }).sort((a, b) => b.verification - a.verification)
      setManagersStats(dynamicManagersList)
      setAllEmployeesList(employees)
      setAllManagersList(managers.filter(m => allUsers.some(sub => sub.manager_id === m.id)))
    }
  }

  useEffect(() => { load() }, [activeTab])

  async function handleResolve(id) {
    if (!note.trim()) return
    setResolving(id)
    await resolveEscalation(id, note)
    setNote('')
    setResolving(null)
    load()
  }

  async function handleTriggerCron() {
    setTriggering(true)
    setTriggerMessage('')
    try {
      await triggerBackgroundCron()
      setTriggerMessage('✅ Background Escalations & Cron Engine executed successfully!')
      load()
    } catch (err) {
      setTriggerMessage(`❌ Failure: ${err.message}`)
    } finally {
      setTriggering(false)
    }
  }

  // Mathematics-based mapping coordinates for QoQ Area Trend Chart (with dynamic database statistics)
  const getLevelsStats = () => {
    if (analyticsLevel.startsWith('team_')) {
      const managerId = analyticsLevel.replace('team_', '')
      const teamEmps = allEmployeesList.filter(e => e.manager_id === managerId)
      if (teamEmps.length === 0) return { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
      
      const q1 = Math.round((teamEmps.filter(e => {
        const tr = trackerData.find(t => t.id === e.id)
        return tr && tr.qCheckins.Q1 === 'Completed'
      }).length / teamEmps.length) * 100) || 0
      
      const q2 = Math.round((teamEmps.filter(e => {
        const tr = trackerData.find(t => t.id === e.id)
        return tr && tr.qCheckins.Q2 === 'Completed'
      }).length / teamEmps.length) * 100) || 0

      const q3 = Math.round((teamEmps.filter(e => {
        const tr = trackerData.find(t => t.id === e.id)
        return tr && tr.qCheckins.Q3 === 'Completed'
      }).length / teamEmps.length) * 100) || 0

      const q4 = Math.round((teamEmps.filter(e => {
        const tr = trackerData.find(t => t.id === e.id)
        return tr && tr.qCheckins.Q4 === 'Completed'
      }).length / teamEmps.length) * 100) || 0

      return { Q1: q1, Q2: q2, Q3: q3, Q4: q4 }
    }
    
    if (analyticsLevel.startsWith('user_')) {
      const userId = analyticsLevel.replace('user_', '')
      const tr = trackerData.find(t => t.id === userId)
      if (!tr) return { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
      return {
        Q1: tr.qCheckins.Q1 === 'Completed' ? 100 : 0,
        Q2: tr.qCheckins.Q2 === 'Completed' ? 100 : 0,
        Q3: tr.qCheckins.Q3 === 'Completed' ? 100 : 0,
        Q4: tr.qCheckins.Q4 === 'Completed' ? 100 : 0
      }
    }
    
    // Default Org-level averages
    if (allEmployeesList.length === 0) return { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
    const q1 = Math.round((trackerData.filter(t => t.qCheckins.Q1 === 'Completed').length / allEmployeesList.length) * 100) || 0
    const q2 = Math.round((trackerData.filter(t => t.qCheckins.Q2 === 'Completed').length / allEmployeesList.length) * 100) || 0
    const q3 = Math.round((trackerData.filter(t => t.qCheckins.Q3 === 'Completed').length / allEmployeesList.length) * 100) || 0
    const q4 = Math.round((trackerData.filter(t => t.qCheckins.Q4 === 'Completed').length / allEmployeesList.length) * 100) || 0
    return { Q1: q1, Q2: q2, Q3: q3, Q4: q4 }
  }

  const activeTrend = getLevelsStats()
  const scoreQ1 = activeTrend.Q1
  const scoreQ2 = activeTrend.Q2
  const scoreQ3 = activeTrend.Q3
  const scoreQ4 = activeTrend.Q4

  const y1 = 120 - (scoreQ1 * 0.9)
  const y2 = 120 - (scoreQ2 * 0.9)
  const y3 = 120 - (scoreQ3 * 0.9)
  const y4 = 120 - (scoreQ4 * 0.9)

  const smoothPath = `M 50 ${y1} C 100 ${y1}, 100 ${y2}, 150 ${y2} C 200 ${y2}, 200 ${y3}, 250 ${y3} C 300 ${y3}, 300 ${y4}, 350 ${y4}`
  const closedPath = `M 50 ${y1} C 100 ${y1}, 100 ${y2}, 150 ${y2} C 200 ${y2}, 200 ${y3}, 250 ${y3} C 300 ${y3}, 300 ${y4}, 350 ${y4} L 350 130 L 50 130 Z`

  return (
    <AdminLayout openEscalations={escalations.length}>
      <style>{`
        .analytics-grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 1.5rem;
          margin-top: 1.5rem;
        }
        @media (max-width: 1024px) {
          .analytics-grid {
            grid-template-columns: 1fr;
          }
        }
        .chart-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 1.5rem;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .heatmap-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.5rem;
          margin-top: 0.75rem;
        }
        .heatmap-cell {
          height: 35px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.72rem;
          font-weight: 700;
          color: white;
          transition: transform 0.2s ease;
          position: relative;
        }
        .heatmap-cell:hover {
          transform: scale(1.05);
          z-index: 10;
        }
        .progress-bar-bg {
          background: #f3f4f6;
          border-radius: 9999px;
          height: 8px;
          width: 100%;
          margin-top: 0.5rem;
          overflow: hidden;
        }
        .progress-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #6366f1, #4f46e5);
          border-radius: 9999px;
          transition: width 0.5s ease-out;
        }
        .realtime-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 0.75rem;
        }
        .realtime-table th {
          text-align: left;
          font-size: 0.78rem;
          text-transform: uppercase;
          color: #6b7280;
          padding: 0.75rem 1rem;
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
        }
        .realtime-table td {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid #f3f4f6;
          font-size: 0.85rem;
          color: #374151;
        }
        .realtime-table tr:hover {
          background: #fcfdfd;
        }
        .engine-card {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: white;
          padding: 1.5rem;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
          margin-bottom: 1.5rem;
        }
        .status-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          margin-right: 0.5rem;
          box-shadow: 0 0 8px #10b981;
        }
        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(17, 24, 39, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 1.5rem;
        }
        .modal-content {
          background: white;
          border-radius: 16px;
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
          width: 100%;
          max-width: 800px;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .modal-header {
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .modal-header h3 {
          margin: 0;
          font-size: 1.15rem;
          font-weight: 800;
          color: #111827;
        }
        .modal-close-btn {
          background: none;
          border: none;
          font-size: 1.5rem;
          color: #6b7280;
          cursor: pointer;
          transition: color 0.15s ease;
        }
        .modal-close-btn:hover {
          color: #111827;
        }
        .modal-filter-bar {
          padding: 1rem 1.5rem;
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          gap: 1rem;
          align-items: center;
        }
        .modal-search-input {
          flex: 1;
          padding: 0.55rem 0.85rem;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 0.85rem;
          outline: none;
        }
        .modal-search-input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        .modal-select-filter {
          padding: 0.55rem 1.5rem 0.55rem 0.85rem;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 0.85rem;
          background: #fff;
          color: #374151;
        }
        .modal-body {
          padding: 1.5rem;
          overflow-y: auto;
          flex: 1;
        }
        .interactive-section-card {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: white;
          padding: 1.5rem;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }
        .interactive-section-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 20px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          border-color: #6366f1;
        }
      `}</style>

      {/* ── Top Tabs Navigation ── */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid #e5e7eb', marginBottom: '1.5rem' }}>
        <button
          onClick={() => setMainTab('analytics')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '1.1rem', fontWeight: 700, padding: '0.75rem 1rem',
            color: mainTab === 'analytics' ? '#4f46e5' : '#6b7280',
            borderBottom: mainTab === 'analytics' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s ease'
          }}
        >
          📊 Overview & Analytics
        </button>
        <button
          onClick={() => setMainTab('cron')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '1.1rem', fontWeight: 700, padding: '0.75rem 1rem',
            color: mainTab === 'cron' ? '#4f46e5' : '#6b7280',
            borderBottom: mainTab === 'cron' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s ease'
          }}
        >
          ⚙️ Cron Jobs
        </button>
      </div>

      {mainTab === 'analytics' ? (
        <>
          {/* ── Summary cards ── */}
          <div className="admin-summary-grid">
            {[
              { label: 'Total users',       value: summary?.totalUsers      ?? '—', sub: 'in the portal' },
              { label: 'Goal sheets',       value: summary?.totalSheets     ?? '—', sub: 'this cycle' },
              { label: 'Open escalations',  value: summary?.openEscalations ?? '—', sub: 'need attention', alert: true },
              { label: 'Active cycle',      value: summary?.activeCycle?.name ?? 'None', sub: 'current FY', wide: true },
            ].map(c => (
              <div className="admin-stat-card" key={c.label}
                style={c.alert && summary?.openEscalations > 0 ? { borderColor: '#fca5a5' } : {}}>
                <div className="stat-label">{c.label}</div>
                <div className="stat-value" style={c.alert && summary?.openEscalations > 0 ? { color: '#ef4444' } : {}}>
                  {c.value}
                </div>
                <div className="stat-sub">{c.sub}</div>
              </div>
            ))}
          </div>

          {/* ── QoQ Analytics Selector and Area Graph ── */}
          <div className="analytics-grid">
            <div className="chart-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#111827' }}>
                  📈 QoQ Goal Achievement Trends
                </h3>
                {/* Granular Level Selector */}
                <select
                  value={analyticsLevel}
                  onChange={(e) => setAnalyticsLevel(e.target.value)}
                  style={{
                    padding: '0.4rem 0.8rem', borderRadius: 8, border: '1px solid #d1d5db',
                    fontSize: '0.8rem', background: '#fff', color: '#374151', fontWeight: 600
                  }}
                >
                  <option value="org">🏢 Organisation Level</option>
                  {allManagersList.map(m => (
                    <option key={m.id} value={`team_${m.id}`}>👥 Team: {m.name}</option>
                  ))}
                  {allEmployeesList.map(emp => (
                    <option key={emp.id} value={`user_${emp.id}`}>👤 Employee: {emp.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ position: 'relative', width: '100%', height: '180px' }}>
                <svg viewBox="0 0 400 150" width="100%" height="100%" style={{ overflow: 'visible' }}>
                  <defs>
                    <linearGradient id="qoqGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#818cf8" stopOpacity="0.4"/>
                      <stop offset="100%" stopColor="#c7d2fe" stopOpacity="0.05"/>
                    </linearGradient>
                  </defs>
                  
                  <line x1="50" y1="30" x2="350" y2="30" stroke="#f3f4f6" strokeWidth="1" />
                  <line x1="50" y1="75" x2="350" y2="75" stroke="#f3f4f6" strokeWidth="1" />
                  <line x1="50" y1="120" x2="350" y2="120" stroke="#e5e7eb" strokeWidth="1.5" />
                  
                  <path d={closedPath} fill="url(#qoqGradient)" />
                  <path d={smoothPath} fill="none" stroke="#6366f1" strokeWidth="3" />
                  
                  <circle cx="50" cy={y1} r="5" fill="#4f46e5" stroke="white" strokeWidth="2" />
                  <circle cx="150" cy={y2} r="5" fill="#4f46e5" stroke="white" strokeWidth="2" />
                  <circle cx="250" cy={y3} r="5" fill="#4f46e5" stroke="white" strokeWidth="2" />
                  <circle cx="350" cy={y4} r="5" fill="#4f46e5" stroke="white" strokeWidth="2" />

                  <text x="50" y={y1 - 10} textAnchor="middle" fontSize="9" fill="#1f2937" fontWeight="bold">{scoreQ1.toFixed(0)}%</text>
                  <text x="150" y={y2 - 10} textAnchor="middle" fontSize="9" fill="#1f2937" fontWeight="bold">{scoreQ2.toFixed(0)}%</text>
                  <text x="250" y={y3 - 10} textAnchor="middle" fontSize="9" fill="#1f2937" fontWeight="bold">{scoreQ3.toFixed(0)}%</text>
                  <text x="350" y={y4 - 10} textAnchor="middle" fontSize="9" fill="#1f2937" fontWeight="bold">{scoreQ4.toFixed(0)}%</text>
                  
                  <text x="50" y="142" textAnchor="middle" fontSize="10" fill="#6b7280" fontWeight="bold">Q1</text>
                  <text x="150" y="142" textAnchor="middle" fontSize="10" fill="#6b7280" fontWeight="bold">Q2</text>
                  <text x="250" y="142" textAnchor="middle" fontSize="10" fill="#6b7280" fontWeight="bold">Q3</text>
                  <text x="350" y="142" textAnchor="middle" fontSize="10" fill="#6b7280" fontWeight="bold">Q4 / Annual</text>
                </svg>
              </div>
            </div>

            {/* Goal distributions Breakdown */}
            <div className="chart-card">
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 700, color: '#111827' }}>
                🎯 Goal KPI Breakdown
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {/* Thrust Areas */}
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.82rem', color: '#374151', fontWeight: 700 }}>Thrust Area</h4>
                  {thrustStats.slice(0, 3).map((stat, idx) => (
                    <div key={stat.name} style={{ marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem' }}>
                        <span>{stat.name}</span>
                        <strong>{stat.percentage.toFixed(0)}%</strong>
                      </div>
                      <div className="progress-bar-bg" style={{ height: 4, marginTop: 2 }}>
                        <div className="progress-bar-fill" style={{ width: `${stat.percentage}%`, background: '#6366f1' }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* UoM type */}
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.82rem', color: '#374151', fontWeight: 700 }}>UoM Type</h4>
                  {uomStats.slice(0, 2).map((stat) => (
                    <div key={stat.name} style={{ marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem' }}>
                        <span>{stat.name}</span>
                        <strong>{stat.percentage.toFixed(0)}%</strong>
                      </div>
                      <div className="progress-bar-bg" style={{ height: 4, marginTop: 2 }}>
                        <div className="progress-bar-fill" style={{ width: `${stat.percentage}%`, background: '#10b981' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Organizational Completion Heatmap & Non-Competitive Health Grid Combined Card ── */}
          <div 
            className="interactive-section-card" 
            style={{ marginTop: '1.5rem' }} 
            onClick={() => setIsManagerModalOpen(true)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>🟩</span> L1 Manager Teams Completion Matrix & Health
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem', color: '#6b7280' }}>
                  Real-time completion heatmaps tracking check-in consistency & verification rates across L1 Manager Teams.
                </p>
              </div>
              <button 
                className="btn-sm btn-ghost-sm" 
                style={{ fontWeight: 700, fontSize: '0.75rem', pointerEvents: 'none' }}
              >
                🔍 Search & Filter Teams ⬇
              </button>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
              {/* Left Side: Completion Matrix (Heatmap) Preview */}
              <div>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.82rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  📍 Completion Heatmap Matrix (Top 3)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {matrixData.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: '#9ca3af', textAlign: 'center', padding: '1rem' }}>No manager teams logged check-in matrices.</div>
                  ) : matrixData.slice(0, 3).map(row => (
                    <div key={row.unit} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.unit}</span>
                      <div className="heatmap-grid" style={{ marginTop: 0 }}>
                        {[row.q1, row.q2, row.q3, row.q4].map((v, idx) => (
                          <div key={idx} className="heatmap-cell" style={{ background: v >= 90 ? '#10b981' : v >= 50 ? '#3b82f6' : '#d1d5db', height: '24px', fontSize: '0.68rem' }}>
                            {v}%
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Side: Manager Effectiveness Preview */}
              <div>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.82rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  📋 Manager Effectiveness rates (Top 3)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  {managersStats.length === 0 ? (
                    <div style={{ fontSize: '0.8rem', color: '#9ca3af', textAlign: 'center', padding: '1rem' }}>No manager effectiveness stats.</div>
                  ) : managersStats.slice(0, 3).map(m => (
                    <div key={m.name} style={{ background: '#f9fafb', padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #f3f4f6' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 700, color: '#374151' }}>
                        <span>{m.name}</span>
                        <span>{m.verification}% Verified</span>
                      </div>
                      <div className="progress-bar-bg" style={{ height: 4, marginTop: 4 }}>
                        <div className="progress-bar-fill" style={{ width: `${m.verification}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            <div style={{ textAlign: 'center', marginTop: '1.25rem', color: '#6366f1', fontWeight: 700, fontSize: '0.8rem' }}>
              💡 Click anywhere on this card to search, filter, and inspect the complete L1 Manager Teams and Effectiveness ratings!
            </div>
          </div>

          {/* ── Real-Time Completion & Phase Tracker Dashboard ── */}
          <div 
            className="interactive-section-card" 
            style={{ marginTop: '1.5rem' }} 
            onClick={() => setIsTrackerModalOpen(true)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#111827' }}>⚡ Real-Time Completion Tracker</div>
                <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 2 }}>Monitor goal settings and check-in statuses across direct reports and managers.</div>
              </div>
              
              {/* Selector Tabs */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[
                  { id: 'phase1', label: 'Goal Setting (Phase 1)' },
                  { id: 'Q1', label: 'Q1' },
                  { id: 'Q2', label: 'Q2' },
                  { id: 'Q3', label: 'Q3' },
                  { id: 'Q4', label: 'Q4 / Annual' }
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={(e) => { e.stopPropagation(); setTrackerTab(t.id); }}
                    style={{
                      padding: '0.35rem 0.75rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600,
                      cursor: 'pointer', border: '1px solid',
                      background: trackerTab === t.id ? '#6366f1' : '#fff',
                      color: trackerTab === t.id ? '#fff' : '#4b5563',
                      borderColor: trackerTab === t.id ? '#6366f1' : '#d1d5db',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="user-table-wrap" style={{ marginTop: 0 }}>
              <table className="realtime-table">
                <thead>
                  <tr>
                    <th>Employee Name</th>
                    <th>Direct Manager</th>
                    <th>Goal Sheet Status</th>
                    <th>Quarter Check-in</th>
                  </tr>
                </thead>
                <tbody>
                  {trackerData.length === 0 ? (
                    <tr><td colSpan="4" style={{ textAlign: 'center', color: '#9ca3af' }}>No employee check-in trackers logged yet.</td></tr>
                  ) : trackerData.slice(0, 5).map(row => {
                    const checkinStatus = row.qCheckins[trackerTab] || 'Pending'
                    
                    return (
                      <tr key={row.id}>
                        <td style={{ fontWeight: 600 }}>{row.name}</td>
                        <td style={{ color: '#4b5563' }}>{row.manager}</td>
                        <td>
                          <span className={`badge badge-${row.goalSheetStatus}`}>
                            {row.goalSheetStatus.replace('_', ' ')}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${checkinStatus === 'Completed' ? 'badge-approved' : 'badge-draft'}`}>
                            {checkinStatus}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {trackerData.length > 5 && (
                <div style={{ textAlign: 'center', marginTop: '1rem', paddingBottom: '0.5rem' }}>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setIsTrackerModalOpen(true); }}
                    className="btn-sm btn-ghost-sm"
                    style={{ fontWeight: 700 }}
                  >
                    🔍 Search & Filter All Trackers ⬇
                  </button>
                </div>
              )}
            </div>
            
            <div style={{ textAlign: 'center', marginTop: '0.75rem', color: '#6366f1', fontWeight: 700, fontSize: '0.8rem' }}>
              💡 Click anywhere on this card to search, filter, and inspect the complete employee trackers directory!
            </div>
          </div>

          {/* ── Quarterly Stats Tabs ── */}
          <div className="admin-card" style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
              {QUARTERS.map(q => (
                <button
                  key={q}
                  onClick={() => setActiveTab(q)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '1rem', fontWeight: activeTab === q ? 700 : 500,
                    color: activeTab === q ? '#4f46e5' : '#6b7280',
                    borderBottom: activeTab === q ? '2px solid #4f46e5' : 'none',
                    paddingBottom: '0.25rem'
                  }}
                >
                  {q} Stats
                </button>
              ))}
            </div>
            
            {quarterStats ? (
              <div className="admin-summary-grid">
                <div className="admin-stat-card">
                  <div className="stat-label">Total Check-ins</div>
                  <div className="stat-value">{quarterStats.total}</div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-label">Goals Achieved</div>
                  <div className="stat-value">{quarterStats.completed}</div>
                </div>
                <div className="admin-stat-card">
                  <div className="stat-label">Avg. Progress Score</div>
                  <div className="stat-value">{quarterStats.avgScore}%</div>
                </div>
              </div>
            ) : (
              <div className="admin-empty" style={{ padding: '1rem' }}>No data for this quarter.</div>
            )}
          </div>

          {/* ── Escalation inbox ── */}
          <div className="admin-card">
            <div className="admin-card-title">🚨 Open Escalations ({escalations.length})</div>

            {escalations.length === 0 && (
              <div className="admin-empty">✅ No open escalations. All caught up!</div>
            )}

            {escalations.map(e => (
              <div key={e.id} style={{
                border: '1px solid #fecaca', borderRadius: 10, padding: '1rem',
                marginBottom: '0.75rem', background: '#fff9f9',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827', marginBottom: 2 }}>
                      {RULE_LABELS[e.rule_id] ?? e.rule_id}
                      <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.8rem', color: '#6b7280' }}>
                        Rule {e.rule_id} · Level {e.escalation_level} — {LEVEL_LABELS[e.escalation_level]}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#374151' }}>
                      Employee: <strong>{e.employee?.name}</strong> ({e.employee?.email})
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 2 }}>
                      Sent: {new Date(e.sent_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                    <input
                      className="admin-input"
                      placeholder="Resolution note…"
                      value={resolving === e.id ? note : ''}
                      onChange={ev => { setResolving(e.id); setNote(ev.target.value) }}
                      style={{ width: 200 }}
                    />
                    <button
                      className="btn-sm btn-success-sm"
                      disabled={resolving === e.id && !note.trim()}
                      onClick={() => handleResolve(e.id)}
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* ── Cron Jobs Tab ── */
        <div style={{ marginTop: '1.5rem' }}>
          <div className="engine-card">
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>
              ⚡ Background Queue & Engine Workers
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#6b7280', margin: '0 0 1.5rem 0' }}>
              GoalFlow triggers automated cron scans and BullMQ background workers to execute deadline logic, check-in window closures, and rule validations.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fcfdfd' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span className="status-dot" />
                  <strong style={{ fontSize: '0.85rem', color: '#1f2937' }}>node-cron Scheduler</strong>
                </div>
                <span className="badge badge-approved" style={{ fontSize: '0.68rem' }}>RUNNING</span>
                <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.5rem' }}>Frequency: 24h Checks</div>
              </div>

              <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fcfdfd' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span className="status-dot" />
                  <strong style={{ fontSize: '0.85rem', color: '#1f2937' }}>Escalation Engine (E1-E4)</strong>
                </div>
                <span className="badge badge-approved" style={{ fontSize: '0.68rem' }}>ACTIVE</span>
                <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.5rem' }}>Thresholds: Rule-Based</div>
              </div>

              <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fcfdfd' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span className="status-dot" />
                  <strong style={{ fontSize: '0.85rem', color: '#1f2937' }}>BullMQ queue workers</strong>
                </div>
                <span className="badge badge-approved" style={{ fontSize: '0.68rem' }}>ONLINE</span>
                <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.5rem' }}>Queues: Notifications & Emails</div>
              </div>
            </div>
          </div>

          {/* Trigger Override Panel */}
          <div className="engine-card">
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>
              🔧 Manual Engine Override Triggers
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#6b7280', margin: '0 0 1.25rem 0' }}>
              Trigger automated evaluations immediately to verify cron behaviors, escalations, or deadline reminders during auditing.
            </p>

            <button
              onClick={handleTriggerCron}
              disabled={triggering}
              style={{
                padding: '0.65rem 1.25rem', borderRadius: 8, fontSize: '0.88rem', fontWeight: 700,
                cursor: 'pointer', border: 'none', background: triggering ? '#a5b4fc' : '#4f46e5',
                color: '#fff', boxShadow: '0 2px 4px rgba(79,70,229,0.25)', transition: 'all 0.15s ease'
              }}
            >
              {triggering ? '🔄 Compiling Cron Routines...' : '🚀 Force Execute Cron Engine Now'}
            </button>

            {triggerMessage && (
              <div style={{
                marginTop: '1.25rem', padding: '0.85rem', borderRadius: 8,
                background: triggerMessage.startsWith('✅') ? '#f0fdf4' : '#fdf2f2',
                border: `1px solid ${triggerMessage.startsWith('✅') ? '#bbf7d0' : '#fecaca'}`,
                color: triggerMessage.startsWith('✅') ? '#15803d' : '#b91c1c',
                fontSize: '0.82rem', fontWeight: 600
              }}>
                {triggerMessage}
              </div>
            )}
          </div>

          {/* Active app settings */}
          <div className="engine-card">
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>
              ⚙️ Active Scheduler Parameters
            </h3>
            
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#4b5563', borderBottom: '1px solid #e5e7eb' }}>Setting Key</th>
                    <th style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#4b5563', borderBottom: '1px solid #e5e7eb' }}>Active Value</th>
                    <th style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#4b5563', borderBottom: '1px solid #e5e7eb' }}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {settingsList.length === 0 ? (
                    <tr><td colSpan="3" style={{ padding: '1rem', color: '#9ca3af', textAlign: 'center' }}>No system configuration parameters fetched.</td></tr>
                  ) : settingsList.filter(s => s.key !== 'auto_active_quarter' && s.key !== 'email_notifications_level').map(s => (
                    <tr key={s.key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', fontWeight: 700, color: '#4f46e5' }}>{s.key}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>{s.value}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#6b7280' }}>{s.description || 'System setting'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal overlay for Manager effectiveness & health (Combined Suite) ── */}
      {isManagerModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '900px' }}>
            <div className="modal-header">
              <h3>👥 Unified Manager Teams Completion & Effectiveness Matrix</h3>
              <button className="modal-close-btn" onClick={() => { setIsManagerModalOpen(false); setManagerSearch(''); setManagerFilter('all'); }}>✕</button>
            </div>
            <div className="modal-filter-bar">
              <input
                type="text"
                placeholder="🔍 Search managers by name..."
                className="modal-search-input"
                value={managerSearch}
                onChange={e => setManagerSearch(e.target.value)}
              />
              <select
                className="modal-select-filter"
                value={managerFilter}
                onChange={e => setManagerFilter(e.target.value)}
                style={{ minWidth: '200px' }}
              >
                <option value="all">📁 All Effectiveness Tiers</option>
                <option value="high">{"Highly Effective (>=90%)"}</option>
                <option value="moderate">{"Moderate (50-89%)"}</option>
                <option value="needs_support">{"Requires Review (<50%)"}</option>
              </select>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {managersStats
                  .filter(m => {
                    const nameMatch = m.name.toLowerCase().includes(managerSearch.toLowerCase())
                    let tierMatch = true
                    if (managerFilter === 'high') tierMatch = m.verification >= 90
                    else if (managerFilter === 'moderate') tierMatch = m.verification >= 50 && m.verification < 90
                    else if (managerFilter === 'needs_support') tierMatch = m.verification < 50
                    return nameMatch && tierMatch
                  })
                  .map(m => {
                    const rowMatrix = matrixData.find(md => md.unit.toLowerCase().includes(m.name.toLowerCase()))
                    
                    return (
                      <div key={m.name} style={{ background: '#f9fafb', padding: '1.25rem', borderRadius: 12, border: '1px solid #e5e7eb', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'center' }}>
                        {/* Left Column: Manager Verification details */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 800, color: '#1f2937', marginBottom: '0.25rem' }}>
                            <span>{m.name}</span>
                            <span style={{ color: '#6366f1' }}>{m.verification}% Verified</span>
                          </div>
                          <div style={{ fontSize: '0.74rem', color: '#6b7280', marginBottom: '0.5rem' }}>👥 Subordinates: {m.subCount} direct reports</div>
                          <div className="progress-bar-bg" style={{ height: 6 }}>
                            <div className="progress-bar-fill" style={{ width: `${m.verification}%` }} />
                          </div>
                        </div>
                        
                        {/* Right Column: Dynamic Q1-Q4 Heatmap Matrix */}
                        <div>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#4b5563', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            📍 Check-in Completion Matrix
                          </div>
                          {rowMatrix ? (
                            <div className="heatmap-grid" style={{ marginTop: 0 }}>
                              {[
                                { val: rowMatrix.q1, label: 'Q1' },
                                { val: rowMatrix.q2, label: 'Q2' },
                                { val: rowMatrix.q3, label: 'Q3' },
                                { val: rowMatrix.q4, label: 'Q4' }
                              ].map((item, idx) => (
                                <div key={idx} className="heatmap-cell" style={{ background: item.val >= 90 ? '#10b981' : item.val >= 50 ? '#3b82f6' : '#d1d5db', height: '32px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                                  <span style={{ fontSize: '0.7rem', fontWeight: 800 }}>{item.val}%</span>
                                  <span style={{ fontSize: '0.52rem', opacity: 0.85, fontWeight: 700 }}>{item.label}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.74rem', color: '#9ca3af', fontStyle: 'italic' }}>No logged check-in matrices.</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal overlay for Real-Time Tracker ── */}
      {isTrackerModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '900px' }}>
            <div className="modal-header">
              <h3>⚡ Full Real-Time Completion Tracker</h3>
              <button className="modal-close-btn" onClick={() => { setIsTrackerModalOpen(false); setTrackerSearch(''); setTrackerStatusFilter('all'); }}>✕</button>
            </div>
            <div className="modal-filter-bar">
              <input
                type="text"
                placeholder="🔍 Search by employee or manager name..."
                className="modal-search-input"
                value={trackerSearch}
                onChange={e => setTrackerSearch(e.target.value)}
              />
              <select
                className="modal-select-filter"
                value={trackerStatusFilter}
                onChange={e => setTrackerStatusFilter(e.target.value)}
              >
                <option value="all">📁 All Sheet Statuses</option>
                <option value="approved">Approved Sheets</option>
                <option value="submitted">Submitted Sheets</option>
                <option value="draft">Draft / Not Started</option>
              </select>
            </div>
            <div className="modal-body" style={{ padding: 0 }}>
              <table className="realtime-table" style={{ margin: 0 }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 10 }}>
                    <th>Employee Name</th>
                    <th>Direct Manager</th>
                    <th>Goal Sheet Status</th>
                    <th>Quarter Check-in ({trackerTab})</th>
                  </tr>
                </thead>
                <tbody>
                  {trackerData
                    .filter(row => {
                      const nameMatch = row.name.toLowerCase().includes(trackerSearch.toLowerCase()) || 
                                       row.manager.toLowerCase().includes(trackerSearch.toLowerCase())
                      const statusMatch = trackerStatusFilter === 'all' || row.goalSheetStatus === trackerStatusFilter
                      return nameMatch && statusMatch
                    })
                    .map(row => {
                      const checkinStatus = row.qCheckins[trackerTab] || 'Pending'
                      return (
                        <tr key={row.id}>
                          <td style={{ fontWeight: 600 }}>{row.name}</td>
                          <td style={{ color: '#4b5563' }}>{row.manager}</td>
                          <td>
                            <span className={`badge badge-${row.goalSheetStatus}`}>
                              {row.goalSheetStatus.replace('_', ' ')}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${checkinStatus === 'Completed' ? 'badge-approved' : 'badge-draft'}`}>
                              {checkinStatus}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
