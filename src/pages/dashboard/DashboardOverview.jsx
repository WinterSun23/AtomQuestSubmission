import { useState, useEffect } from 'react'
import { useApp } from '../../lib/AppContext'
import { supabase } from '../../lib/supabase'

export default function DashboardOverview() {
  const { me, activeCycle: cycle, activeWindow, loading: contextLoading } = useApp()
  const [loadingReports, setLoadingReports] = useState(true)
  const [directReports, setDirectReports] = useState([])
  const [pendingApprovals, setPendingApprovals] = useState([])
  const [completionStats, setCompletionStats] = useState({ completed: 0, total: 0 })

  // State-of-the-art dynamic team variables
  const [trackerTab, setTrackerTab] = useState('phase1') // 'phase1', 'Q1', 'Q2', 'Q3', 'Q4'
  const [analyticsLevel, setAnalyticsLevel] = useState('team')
  const [trackerData, setTrackerData] = useState([])
  const [thrustStats, setThrustStats] = useState([])
  const [uomStats, setUomStats] = useState([])
  const [escalationsList, setEscalationsList] = useState([])

  // Modal open states for Manager Portal
  const [isTeamTrackerModalOpen, setIsTeamTrackerModalOpen] = useState(false)
  const [selectedEscalation, setSelectedEscalation] = useState(null)
  const [isEscalationDrawerOpen, setIsEscalationDrawerOpen] = useState(false)

  // Modal search/filter states
  const [teamTrackerSearch, setTeamTrackerSearch] = useState('')
  const [teamTrackerFilter, setTeamTrackerFilter] = useState('all')

  useEffect(() => {
    if (contextLoading || !me) return

    async function loadManagerData() {
      try {
        if (me.role === 'manager' || me.role === 'admin') {
          // Fetch direct reports
          const { data: reports } = await supabase
            .from('users')
            .select('id, name, email')
            .eq('manager_id', me.id)

          const reportsList = reports || []
          setDirectReports(reportsList)

          if (reportsList.length > 0) {
            const reportIds = reportsList.map(r => r.id)

            // 1. Fetch pending approvals (submitted goal sheets)
            const { data: pending } = await supabase
              .from('goal_sheets')
              .select('id, status, submitted_at, employee_id')
              .in('employee_id', reportIds)
              .eq('status', 'submitted')

            setPendingApprovals(pending || [])

            // 2. Fetch all goal sheets for this cycle for our team
            const { data: sheets } = await supabase
              .from('goal_sheets')
              .select('id, status, employee_id')
              .in('employee_id', reportIds)
              .eq('cycle_id', cycle?.id)

            // 3. Fetch active windows for cycle
            const { data: windows } = await supabase
              .from('check_in_windows')
              .select('id, quarter')
              .eq('cycle_id', cycle?.id)

            // 4. Fetch manager comments for our team
            const { data: comments } = await supabase
              .from('manager_comments')
              .select('id, employee_id, window_id')
              .in('employee_id', reportIds)

            // 5. Fetch all goals for team to build distribution stats
            let goals = []
            if (sheets && sheets.length > 0) {
              const sheetIds = sheets.map(s => s.id)
              const { data } = await supabase
                .from('goals')
                .select('id, goal_sheet_id, thrust_area_id, uom_type, thrust_areas:thrust_area_id(name)')
                .in('goal_sheet_id', sheetIds)
              goals = data || []
            }

            // Fetch check-ins for the team's goals
            let checkins = []
            if (goals && goals.length > 0) {
              const goalIds = goals.map(g => g.id)
              const { data } = await supabase
                .from('check_ins')
                .select('id, goal_id, window_id')
                .in('goal_id', goalIds)
              checkins = data || []
            }

            // Compute UoM and Thrust Area statistics
            if (goals && goals.length > 0) {
              const thrustCounts = {}
              const uomCounts = {}

              goals.forEach(g => {
                const name = g.thrust_areas?.name || 'Unassigned'
                thrustCounts[name] = (thrustCounts[name] || 0) + 1

                const type = g.uom_type?.replace('_', ' ') || 'Unassigned'
                uomCounts[type] = (uomCounts[type] || 0) + 1
              })

              setThrustStats(Object.keys(thrustCounts).map(name => ({
                name,
                percentage: (thrustCounts[name] / goals.length) * 100
              })))

              setUomStats(Object.keys(uomCounts).map(name => ({
                name,
                percentage: (uomCounts[name] / goals.length) * 100
              })))
            }

            // 6. Fetch team compliance escalations from escalation_log
            const { data: escalations } = await supabase
              .from('escalation_log')
              .select(`
                id,
                level:escalation_level,
                trigger_reason:rule_id,
                created_at:sent_at,
                employee_id,
                employee:users!employee_id(name, email)
              `)
              .in('employee_id', reportIds)
              .is('resolved_at', null)

            setEscalationsList(escalations || [])

            // Map the team Real-Time Tracker data
            const compiledTracker = reportsList.map(emp => {
              const empSheet = (sheets || []).find(s => s.employee_id === emp.id)
              const sheetStatus = empSheet ? empSheet.status : 'not_started'

              const qCheckins = { Q1: 'Pending', Q2: 'Pending', Q3: 'Pending', Q4: 'Pending', phase1: 'Pending' }

              // Map sheets to Phase 1 flag
              if (empSheet) {
                qCheckins.phase1 = empSheet.status === 'approved' ? 'Completed' : 'Draft'
              }

              // Map check-ins to quarters
              windows?.forEach(w => {
                const qKey = w.quarter
                const employeeGoals = goals.filter(g => g.goal_sheet_id === empSheet?.id).map(g => g.id)
                
                let status = 'Pending'
                if (employeeGoals.length > 0) {
                  const checkedInCount = employeeGoals.filter(gid => checkins.some(c => c.window_id === w.id && c.goal_id === gid)).length
                  if (checkedInCount === employeeGoals.length) {
                    status = 'Completed'
                  } else if (checkedInCount > 0) {
                    status = `${Math.round((checkedInCount / employeeGoals.length) * 100)}%`
                  }
                }
                
                qCheckins[qKey] = status
              })

              return {
                id: emp.id,
                name: emp.name,
                email: emp.email,
                goalSheetStatus: sheetStatus,
                qCheckins
              }
            })
            setTrackerData(compiledTracker)

            // Compute overall team check-in rate (active window)
            if (activeWindow) {
              let completedCount = 0
              reportsList.forEach(emp => {
                const empSheet = (sheets || []).find(s => s.employee_id === emp.id)
                const employeeGoals = goals.filter(g => g.goal_sheet_id === empSheet?.id).map(g => g.id)
                const hasCheckin = checkins.some(c => c.window_id === activeWindow.id && employeeGoals.includes(c.goal_id))
                if (hasCheckin) completedCount++
              })
              setCompletionStats({
                completed: completedCount,
                total: reportsList.length
              })
            }
          }
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoadingReports(false)
      }
    }
    loadManagerData()
  }, [contextLoading, me, cycle, activeWindow])

  const isLoading = contextLoading || (me && (me.role === 'manager' || me.role === 'admin') && loadingReports)

  if (isLoading) return <div className="user-empty">Loading...</div>
  if (!me) return <div className="user-empty">Not authenticated.</div>

  const isManager = me.role === 'manager' || me.role === 'admin'

  if (isManager) {
    const completionPercentage = completionStats.total > 0
      ? Math.round((completionStats.completed / completionStats.total) * 100)
      : 0

    const getLevelsStats = () => {
      const parseScore = (status) => {
        if (status === 'Completed') return 100
        if (status && status.endsWith('%')) return parseInt(status.replace('%', ''), 10)
        return 0
      }

      if (analyticsLevel.startsWith('user_')) {
        const userId = analyticsLevel.replace('user_', '')
        const tr = trackerData.find(t => t.id === userId)
        if (!tr) return { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
        
        return {
          Q1: parseScore(tr.qCheckins?.Q1),
          Q2: parseScore(tr.qCheckins?.Q2),
          Q3: parseScore(tr.qCheckins?.Q3),
          Q4: parseScore(tr.qCheckins?.Q4)
        }
      }

      // Default Team Level averages
      if (trackerData.length === 0) return { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
      
      const getTeamAvg = (qKey) => {
        const sum = trackerData.reduce((acc, t) => acc + parseScore(t.qCheckins?.[qKey]), 0)
        return Math.round(sum / trackerData.length) || 0
      }

      return {
        Q1: getTeamAvg('Q1'),
        Q2: getTeamAvg('Q2'),
        Q3: getTeamAvg('Q3'),
        Q4: getTeamAvg('Q4')
      }
    }

    const activeTrend = getLevelsStats()
    const scoreQ1 = activeTrend.Q1
    const scoreQ2 = activeTrend.Q2
    const scoreQ3 = activeTrend.Q3
    const scoreQ4 = activeTrend.Q4

    // Coordinate math for SVG Team QoQ Area Chart
    const y1 = 120 - (scoreQ1 * 0.9)
    const y2 = 120 - (scoreQ2 * 0.9)
    const y3 = 120 - (scoreQ3 * 0.9)
    const y4 = 120 - (scoreQ4 * 0.9)

    const smoothPath = `M 50 ${y1} C 100 ${y1}, 100 ${y2}, 150 ${y2} C 200 ${y2}, 200 ${y3}, 250 ${y3} C 300 ${y3}, 300 ${y4}, 350 ${y4}`
    const closedPath = `M 50 ${y1} C 100 ${y1}, 100 ${y2}, 150 ${y2} C 200 ${y2}, 200 ${y3}, 250 ${y3} C 300 ${y3}, 300 ${y4}, 350 ${y4} L 350 130 L 50 130 Z`

    return (
      <div>
        <style>{`
          .admin-summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 1.25rem;
            margin-bottom: 1.5rem;
          }
          .admin-stat-card {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 1.25rem;
            box-shadow: none;
            transition: transform 0.2s ease, border-color 0.2s ease;
          }
          .admin-stat-card:hover {
            transform: translateY(-2px);
            border-color: #30363d;
          }
          .stat-label {
            font-size: 0.76rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #8b949e;
            font-weight: 700;
          }
          .stat-value {
            font-size: 1.75rem;
            font-weight: 800;
            color: #f0f6fc;
            margin: 0.35rem 0 0.15rem 0;
          }
          .stat-sub {
            font-size: 0.74rem;
            color: #8b949e;
          }
          .analytics-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 1.5rem;
            margin-top: 1.5rem;
          }
          @media (max-width: 1024px) {
            .analytics-grid {
              grid-template-columns: 1fr;
            }
          }
          .chart-card {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: none;
            color: #c9d1d9;
          }
          .progress-bar-bg {
            background: #30363d;
            border-radius: 9999px;
            height: 8px;
            width: 100%;
            margin-top: 0.5rem;
            overflow: hidden;
          }
          .progress-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #58a6ff, #1f6feb);
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
            color: #8b949e;
            padding: 0.75rem 1rem;
            background: #0d1117;
            border-bottom: 1px solid #30363d;
          }
          .realtime-table td {
            padding: 0.75rem 1rem;
            border-bottom: 1px solid #30363d;
            font-size: 0.85rem;
            color: #c9d1d9;
          }
          .realtime-table tr:hover {
            background: #21262d;
          }
          .team-card {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: none;
          }
          .interactive-section-card {
            background: #161b22;
            border: 1.5px solid #30363d;
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: none;
            cursor: pointer;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .interactive-section-card:hover {
            transform: translateY(-3px);
            border-color: #58a6ff;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
          }
          .heatmap-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 0.35rem;
            margin-top: 0.5rem;
          }
          .heatmap-cell {
            padding: 0.35rem 0.15rem;
            border-radius: 4px;
            text-align: center;
            font-size: 0.72rem;
            font-weight: 700;
            color: white;
          }
          .modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(1, 4, 9, 0.7);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            padding: 1.5rem;
          }
          .modal-content {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 16px;
            box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 800px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .modal-header {
            padding: 1.25rem 1.5rem;
            border-bottom: 1px solid #30363d;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .modal-header h3 {
            margin: 0;
            font-size: 1.15rem;
            font-weight: 800;
            color: #f0f6fc;
          }
          .modal-close-btn {
            background: none;
            border: none;
            font-size: 1.5rem;
            color: #8b949e;
            cursor: pointer;
            transition: color 0.15s ease;
          }
          .modal-close-btn:hover {
            color: #f0f6fc;
          }
          .modal-filter-bar {
            padding: 1rem 1.5rem;
            background: #0d1117;
            border-bottom: 1px solid #30363d;
            display: flex;
            gap: 1rem;
            align-items: center;
          }
          .modal-search-input {
            flex: 1;
            padding: 0.55rem 0.85rem;
            border: 1px solid #30363d;
            background: #0d1117;
            color: #c9d1d9;
            border-radius: 8px;
            font-size: 0.85rem;
            outline: none;
          }
          .modal-search-input:focus {
            border-color: #58a6ff;
            box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
          }
          .modal-select-filter {
            padding: 0.55rem 1.5rem 0.55rem 0.85rem;
            border: 1px solid #30363d;
            background: #0d1117;
            color: #c9d1d9;
            border-radius: 8px;
            font-size: 0.85rem;
          }
          .modal-body {
            padding: 1.5rem;
            overflow-y: auto;
            flex: 1;
          }

          /* Slide-over Drawer Overlay & Body Styles */
          .drawer-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(1, 4, 9, 0.6);
            backdrop-filter: blur(4px);
            z-index: 999;
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s ease;
          }
          .drawer-overlay.open {
            opacity: 1;
            visibility: visible;
          }
          .drawer-body {
            position: fixed;
            top: 0;
            right: 0;
            width: 450px;
            max-width: 100vw;
            height: 100%;
            background: #161b22;
            border-left: 1px solid #30363d;
            box-shadow: -10px 0 25px -5px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            transform: translateX(100%);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            flex-direction: column;
          }
          .drawer-body.open {
            transform: translateX(0);
          }
          .drawer-header {
            padding: 1.5rem;
            border-bottom: 1px solid #30363d;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .drawer-content {
            flex: 1;
            overflow-y: auto;
            padding: 1.5rem;
          }
          .drawer-footer {
            padding: 1.5rem;
            border-top: 1px solid #30363d;
            background: #0d1117;
          }
        `}</style>


        <div className="user-page-header">
          <h1 className="user-page-title">Welcome back, {me.name}!</h1>
          <p className="user-page-subtitle">Manager Portal Overview • Direct Reports: {directReports.length}</p>
        </div>

        {cycle ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* ─── Replicated Summary Cards Grid ─── */}
            <div className="admin-summary-grid">
              {[
                { label: 'Team members', value: directReports.length, sub: 'registered direct reports' },
                { label: 'Performance cycle', value: cycle.name, sub: 'active window goal setting', wide: true }
              ].map(c => (
                <div className="admin-stat-card" key={c.label}>
                  <div className="stat-label">{c.label}</div>
                  <div className="stat-value">
                    {c.value}
                  </div>
                  <div className="stat-sub">{c.sub}</div>
                </div>
              ))}
            </div>



            {/* ─── Team QoQ Trend Area Chart & KPI Breakdown ─── */}
            <div className="analytics-grid">
              {/* Card A: Team Trend SVG */}
              <div className="chart-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#111827' }}>
                    📈 Team QoQ Achievement Trends
                  </h3>
                  <select
                    value={analyticsLevel}
                    onChange={(e) => setAnalyticsLevel(e.target.value)}
                    style={{
                      padding: '0.4rem 0.8rem', borderRadius: 8, border: '1px solid #d1d5db',
                      fontSize: '0.8rem', background: '#fff', color: '#374151', fontWeight: 600
                    }}
                  >
                    <option value="team">👥 Team Level (All Reports)</option>
                    {directReports.map(emp => (
                      <option key={emp.id} value={`user_${emp.id}`}>👤 Employee: {emp.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ position: 'relative', width: '100%', height: '180px' }}>
                  <svg viewBox="0 0 400 150" width="100%" height="100%" style={{ overflow: 'visible' }}>
                    <defs>
                      <linearGradient id="teamQoqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#818cf8" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#c7d2fe" stopOpacity="0.05" />
                      </linearGradient>
                    </defs>

                    <line x1="50" y1="30" x2="350" y2="30" stroke="#21262d" strokeWidth="1" />
                    <line x1="50" y1="75" x2="350" y2="75" stroke="#21262d" strokeWidth="1" />
                    <line x1="50" y1="120" x2="350" y2="120" stroke="#30363d" strokeWidth="1.5" />

                    <path d={closedPath} fill="url(#teamQoqGrad)" />
                    <path d={smoothPath} fill="none" stroke="#58a6ff" strokeWidth="3" />

                    <circle cx="50" cy={y1} r="5" fill="#1f6feb" stroke="#161b22" strokeWidth="2" />
                    <circle cx="150" cy={y2} r="5" fill="#1f6feb" stroke="#161b22" strokeWidth="2" />
                    <circle cx="250" cy={y3} r="5" fill="#1f6feb" stroke="#161b22" strokeWidth="2" />
                    <circle cx="350" cy={y4} r="5" fill="#1f6feb" stroke="#161b22" strokeWidth="2" />

                    <text x="50" y={y1 - 10} textAnchor="middle" fontSize="9" fill="#f0f6fc" fontWeight="bold">{scoreQ1.toFixed(0)}%</text>
                    <text x="150" y={y2 - 10} textAnchor="middle" fontSize="9" fill="#f0f6fc" fontWeight="bold">{scoreQ2.toFixed(0)}%</text>
                    <text x="250" y={y3 - 10} textAnchor="middle" fontSize="9" fill="#f0f6fc" fontWeight="bold">{scoreQ3.toFixed(0)}%</text>
                    <text x="350" y={y4 - 10} textAnchor="middle" fontSize="9" fill="#f0f6fc" fontWeight="bold">{scoreQ4.toFixed(0)}%</text>

                    <text x="50" y="142" textAnchor="middle" fontSize="10" fill="#8b949e" fontWeight="bold">Q1</text>
                    <text x="150" y="142" textAnchor="middle" fontSize="10" fill="#8b949e" fontWeight="bold">Q2</text>
                    <text x="250" y="142" textAnchor="middle" fontSize="10" fill="#8b949e" fontWeight="bold">Q3</text>
                    <text x="350" y="142" textAnchor="middle" fontSize="10" fill="#8b949e" fontWeight="bold">Q4 / Annual</text>
                  </svg>
                </div>
              </div>
            </div>

            {/* ─── Team Real-Time Completion Tracker Grid ─── */}
            <div
              className="interactive-section-card"
              style={{ marginTop: '1.5rem' }}
              onClick={() => setIsTeamTrackerModalOpen(true)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#111827' }}>⚡ Team Real-Time Tracker</h3>
                  <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 2 }}>Track direct reports goal settings and quarterly check-ins.</div>
                </div>

                {/* Tabs */}
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
                      <th>Email Address</th>
                      <th>Goal Sheet Status</th>
                      <th>Quarter Check-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trackerData.length === 0 ? (
                      <tr><td colSpan="4" style={{ textAlign: 'center', color: '#9ca3af' }}>No employees registered in your roster.</td></tr>
                    ) : trackerData.slice(0, 5).map(row => {
                      const checkinStatus = row.qCheckins[trackerTab] || 'Pending'

                      return (
                        <tr key={row.id}>
                          <td style={{ fontWeight: 600 }}>{row.name}</td>
                          <td style={{ color: '#4b5563' }}>{row.email}</td>
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
                      onClick={(e) => { e.stopPropagation(); setIsTeamTrackerModalOpen(true); }}
                      className="btn-sm btn-ghost-sm"
                      style={{ fontWeight: 700 }}
                    >
                      🔍 Search & Filter Team Trackers ⬇
                    </button>
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'center', marginTop: '0.75rem', color: '#6366f1', fontWeight: 700, fontSize: '0.8rem' }}>
                💡 Click anywhere on this card to search, filter, and inspect the complete team check-in timelines!
              </div>
            </div>

            {/* ── Modal overlay for Team Tracker ── */}
            {isTeamTrackerModalOpen && (
              <div className="modal-overlay">
                <div className="modal-content" style={{ maxWidth: '900px' }}>
                  <div className="modal-header">
                    <h3>⚡ Full Team Real-Time Tracker</h3>
                    <button className="modal-close-btn" onClick={() => { setIsTeamTrackerModalOpen(false); setTeamTrackerSearch(''); setTeamTrackerFilter('all'); }}>✕</button>
                  </div>
                  <div className="modal-filter-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        placeholder="🔍 Search team employees by name or email..."
                        className="modal-search-input"
                        value={teamTrackerSearch}
                        onChange={e => setTeamTrackerSearch(e.target.value)}
                      />
                      <select
                        className="modal-select-filter"
                        value={teamTrackerFilter}
                        onChange={e => setTeamTrackerFilter(e.target.value)}
                      >
                        <option value="all">📁 All Check-in Statuses</option>
                        <option value="completed">Completed Check-ins</option>
                        <option value="pending">Pending Check-ins</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem', borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem', overflowX: 'auto', paddingBottom: '0.2rem' }}>
                      <span style={{ fontSize: '0.72rem', color: '#6b7280', alignSelf: 'center', marginRight: '0.5rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Selected Quarter:</span>
                      {[
                        { id: 'phase1', label: 'Goal Setting (Phase 1)' },
                        { id: 'Q1', label: 'Q1' },
                        { id: 'Q2', label: 'Q2' },
                        { id: 'Q3', label: 'Q3' },
                        { id: 'Q4', label: 'Q4 / Annual' }
                      ].map(t => (
                        <button
                          key={t.id}
                          onClick={() => setTrackerTab(t.id)}
                          style={{
                            padding: '0.3rem 0.65rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600,
                            cursor: 'pointer', border: '1px solid',
                            background: trackerTab === t.id ? '#6366f1' : '#fff',
                            color: trackerTab === t.id ? '#fff' : '#4b5563',
                            borderColor: trackerTab === t.id ? '#6366f1' : '#d1d5db',
                            transition: 'all 0.15s ease',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="modal-body" style={{ padding: 0 }}>
                    <table className="realtime-table" style={{ margin: 0 }}>
                      <thead>
                        <tr style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 10 }}>
                          <th>Employee Name</th>
                          <th>Email Address</th>
                          <th>Goal Sheet Status</th>
                          <th>Quarter Check-in ({trackerTab})</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trackerData
                          .filter(row => {
                            const nameMatch = row.name.toLowerCase().includes(teamTrackerSearch.toLowerCase()) ||
                              row.email.toLowerCase().includes(teamTrackerSearch.toLowerCase())
                            const checkinStatus = row.qCheckins[trackerTab] || 'Pending'
                            const statusMatch = teamTrackerFilter === 'all' ||
                              (teamTrackerFilter === 'completed' && checkinStatus === 'Completed') ||
                              (teamTrackerFilter === 'pending' && checkinStatus !== 'Completed')
                            return nameMatch && statusMatch
                          })
                          .map(row => {
                            const checkinStatus = row.qCheckins[trackerTab] || 'Pending'
                            return (
                              <tr key={row.id}>
                                <td style={{ fontWeight: 600 }}>{row.name}</td>
                                <td style={{ color: '#4b5563' }}>{row.email}</td>
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

            {/* ── Slide-over Escalation Details Drawer ── */}
            <div
              className={`drawer-overlay ${isEscalationDrawerOpen ? 'open' : ''}`}
              onClick={() => setIsEscalationDrawerOpen(false)}
            />
            <div className={`drawer-body ${isEscalationDrawerOpen && selectedEscalation ? 'open' : ''}`}>
              {selectedEscalation && (
                <>
                  <div className="drawer-header">
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>🚨</span> Escalation Details
                    </h3>
                    <button
                      onClick={() => setIsEscalationDrawerOpen(false)}
                      style={{
                        background: '#f3f4f6', border: 'none', borderRadius: '50%',
                        width: '28px', height: '28px', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', cursor: 'pointer', color: '#4b5563', fontWeight: 700
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="drawer-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* Badge/Level card */}
                    <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 12, padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '0.78rem', color: '#991b1b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Severity Level</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#991b1b', marginTop: '0.15rem' }}>Level {selectedEscalation.level} Overdue</div>
                      </div>
                      <span className="badge badge-error" style={{ background: '#ef4444', color: '#fff', fontSize: '0.8rem', padding: '0.4rem 0.8rem', borderRadius: 8, fontWeight: 700 }}>
                        Active
                      </span>
                    </div>

                    {/* Employee info */}
                    <div>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        👤 Escalated Employee
                      </h4>
                      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem 1rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1f2937' }}>{selectedEscalation.employee?.name || 'Team Member'}</div>
                        <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.15rem' }}>{selectedEscalation.employee?.email || 'N/A'}</div>
                      </div>
                    </div>

                    {/* Escalation description / reason */}
                    <div>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        📝 Reason for Escalation
                      </h4>
                      <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 8, padding: '1rem', fontSize: '0.85rem', color: '#991b1b', lineHeight: 1.5, fontWeight: 500 }}>
                        {selectedEscalation.trigger_reason}
                      </div>
                    </div>

                    {/* Additional Metadata info */}
                    <div>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        🗓 Escalation Timeline
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem', color: '#4b5563' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Triggered Date:</span>
                          <strong>{new Date(selectedEscalation.created_at).toLocaleString()}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Acknowledge Status:</span>
                          <strong style={{ color: '#ef4444' }}>Unresolved</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="drawer-footer" style={{ display: 'flex', gap: '0.75rem' }}>
                    <a
                      href={`mailto:${selectedEscalation.employee?.email || ''}?subject=Urgent: Goal setting / check-in cycle overdue escalation`}
                      className="btn-sm btn-primary-sm"
                      style={{ flex: 1, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', fontWeight: 700 }}
                    >
                      ✉️ Email Employee
                    </a>
                    <button
                      onClick={() => setIsEscalationDrawerOpen(false)}
                      className="btn-sm btn-ghost-sm"
                      style={{ flex: 1, fontWeight: 700 }}
                    >
                      Dismiss Details
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="user-empty">
            <p>No active performance cycle found.</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Administrators must configure a cycle before team tracking can begin.</p>
          </div>
        )}
      </div>
    )
  }

  // Default Employee View
  return (
    <div>
      <div className="user-page-header">
        <h1 className="user-page-title">Welcome back, {me.name}!</h1>
        <p className="user-page-subtitle">Here is an overview of your active performance cycle.</p>
      </div>

      {cycle ? (
        <div className="user-card" style={{ maxWidth: 500 }}>
          <h2 className="user-card-title">Active Cycle: {cycle.name}</h2>
          <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>GOAL SETTING OPENS</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{cycle.goal_window_start}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>GOAL SETTING CLOSES</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{cycle.goal_window_end}</div>
            </div>
          </div>
          <div style={{ marginTop: '2rem' }}>
            <a href="/dashboard/my-goals" className="btn-sm btn-primary-sm" style={{ textDecoration: 'none' }}>
              Go to My Goals
            </a>
          </div>
        </div>
      ) : (
        <div className="user-empty">
          <p>No active performance cycle found.</p>
          <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Administrators must configure a cycle before you can set goals.</p>
        </div>
      )}
    </div>
  )
}
