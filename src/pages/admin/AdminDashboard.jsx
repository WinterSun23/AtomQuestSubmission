import { useState, useEffect } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { getAdminSummary } from '../../lib/adminApi'
import { triggerBackgroundCron } from '../../lib/backendApi'
import { supabase } from '../../lib/supabase'

export default function AdminDashboard() {
  const [summary, setSummary] = useState(null)
  const [mainTab, setMainTab] = useState('analytics')
  
  // Analytics Data
  const [analyticsLevel, setAnalyticsLevel] = useState('org')
  const [allEmployees, setAllEmployees] = useState([])
  const [allManagers, setAllManagers] = useState([])
  
  // Chart Data
  const [trackerData, setTrackerData] = useState([])
  const [thrustStats, setThrustStats] = useState([])
  const [uomStats, setUomStats] = useState([])
  const [statusStats, setStatusStats] = useState([])
  const [matrixData, setMatrixData] = useState([])
  const [managersStats, setManagersStats] = useState([])

  // Directory State
  const [directoryTab, setDirectoryTab] = useState('employees')
  const [directorySearch, setDirectorySearch] = useState('')

  // Cron Data
  const [triggering, setTriggering] = useState(false)
  const [triggerMessage, setTriggerMessage] = useState('')
  const [settingsList, setSettingsList] = useState([])

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [
          sRes, goalsRes, usersRes, sheetsRes, settingsRes, windowsRes
        ] = await Promise.all([
          getAdminSummary(),
          supabase.from('goals').select('id, thrust_areas:thrust_area_id(name), uom_type, check_ins(status)'),
          supabase.from('users').select('id, name, role, manager_id'),
          supabase.from('goal_sheets').select('id, employee_id, status, cycle_id, goals(id, check_ins(window_id, status, computed_score))'),
          supabase.from('app_settings').select('*'),
          supabase.from('check_in_windows').select('id, quarter')
        ])

        setSummary(sRes)
        if (settingsRes.data) setSettingsList(settingsRes.data)

        // 1. Goal Distribution Stats
        if (goalsRes.data) {
          const tCount = {}, uCount = {}, sCount = { not_started: 0, on_track: 0, completed: 0 }
          goalsRes.data.forEach(g => {
            const tName = g.thrust_areas?.name || 'Unassigned'
            tCount[tName] = (tCount[tName] || 0) + 1
            const uName = g.uom_type?.replace('_', ' ') || 'Unassigned'
            uCount[uName] = (uCount[uName] || 0) + 1
            const st = g.check_ins?.[0]?.status || 'not_started'
            sCount[st] = (sCount[st] || 0) + 1
          })
          
          const toPercent = (count) => (count / goalsRes.data.length) * 100
          setThrustStats(Object.keys(tCount).map(k => ({ name: k, percentage: toPercent(tCount[k]) })))
          setUomStats(Object.keys(uCount).map(k => ({ name: k, percentage: toPercent(uCount[k]) })))
          setStatusStats(Object.keys(sCount).map(k => ({ name: k.replace('_', ' '), percentage: toPercent(sCount[k]) })))
        }

        // 2. Tracker & Heatmap Data
        if (usersRes.data) {
          const sheetsData = sheetsRes.data || []
          // Only employees who have a goal sheet WITH goals
          const emps = usersRes.data.filter(u => u.role === 'employee' && sheetsData.some(s => s.employee_id === u.id && s.goals?.length > 0))
          
          // Only managers who have at least one active employee
          const mgrs = usersRes.data.filter(u => (u.role === 'manager' || u.role === 'admin') && emps.some(sub => sub.manager_id === u.id))
          
          setAllEmployees(emps)
          setAllManagers(mgrs)
          
          const windows = windowsRes.data || []
          
          const compiled = emps.map(emp => {
            const sheet = sheetsData.find(s => s.employee_id === emp.id)
            const qScoreSums = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
            const qScoreCounts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
            
            if (sheet?.goals) {
              sheet.goals.forEach(g => {
                if (g.check_ins) {
                  g.check_ins.forEach(c => {
                    const w = windows.find(win => win.id === c.window_id)
                    if (w && c.computed_score != null) {
                      qScoreSums[w.quarter] += Number(c.computed_score)
                      qScoreCounts[w.quarter] += 1
                    }
                  })
                }
              })
            }
            
            const qScores = {
              Q1: qScoreCounts.Q1 > 0 ? qScoreSums.Q1 / qScoreCounts.Q1 : null,
              Q2: qScoreCounts.Q2 > 0 ? qScoreSums.Q2 / qScoreCounts.Q2 : null,
              Q3: qScoreCounts.Q3 > 0 ? qScoreSums.Q3 / qScoreCounts.Q3 : null,
              Q4: qScoreCounts.Q4 > 0 ? qScoreSums.Q4 / qScoreCounts.Q4 : null
            }
            return { id: emp.id, manager_id: emp.manager_id, qScores }
          })
          setTrackerData(compiled)

          // Matrix Data (Completion Rates for Heatmap)
          const mgrMap = {}
          mgrs.forEach(m => {
            mgrMap[m.id] = { unit: `${m.name}'s Team`, totalSubs: 0, q1: 0, q2: 0, q3: 0, q4: 0, name: m.name }
          })
          
          emps.forEach(emp => {
            if (emp.manager_id && mgrMap[emp.manager_id]) {
              const team = mgrMap[emp.manager_id]
              team.totalSubs++
              const tr = compiled.find(t => t.id === emp.id)
              if (tr) {
                if (tr.qScores.Q1 !== null) team.q1++
                if (tr.qScores.Q2 !== null) team.q2++
                if (tr.qScores.Q3 !== null) team.q3++
                if (tr.qScores.Q4 !== null) team.q4++
              }
            }
          })
          
          const matrix = Object.values(mgrMap).filter(t => t.totalSubs > 0).map(t => ({
            unit: t.unit,
            name: t.name,
            q1: Math.round((t.q1 / t.totalSubs) * 100),
            q2: Math.round((t.q2 / t.totalSubs) * 100),
            q3: Math.round((t.q3 / t.totalSubs) * 100),
            q4: Math.round((t.q4 / t.totalSubs) * 100),
            verification: Math.round(((t.q1 + t.q2 + t.q3 + t.q4) / (t.totalSubs * 4)) * 100)
          }))
          setMatrixData(matrix)
          setManagersStats(matrix.sort((a,b) => b.verification - a.verification))
        }
      } catch (err) {
        console.error('Error loading dashboard:', err)
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleTriggerCron() {
    setTriggering(true)
    setTriggerMessage('')
    try {
      await triggerBackgroundCron()
      setTriggerMessage('✅ Background Escalations & Cron Engine executed successfully!')
    } catch (err) {
      setTriggerMessage(`❌ Failure: ${err.message}`)
    } finally {
      setTriggering(false)
    }
  }

  async function handleSaveSetting(key, newValue) {
    try {
      const { error } = await supabase
        .from('app_settings')
        .update({ value: String(newValue) })
        .eq('key', key)
      
      if (error) throw error
      
      setSettingsList(prev => prev.map(s => s.key === key ? { ...s, value: String(newValue) } : s))
      alert(`Successfully saved parameter: ${key} = ${newValue}`)
    } catch (err) {
      alert(`Error saving parameter: ${err.message}`)
    }
  }

  // Calculate QoQ Trend dynamically based on filter
  // This calculates the average actual *achievement score* across all goals
  const getTrendStats = () => {
    let targetData = trackerData
    if (analyticsLevel.startsWith('team_')) {
      const mId = analyticsLevel.replace('team_', '')
      targetData = trackerData.filter(t => t.manager_id === mId)
    } else if (analyticsLevel.startsWith('user_')) {
      const uId = analyticsLevel.replace('user_', '')
      targetData = trackerData.filter(t => t.id === uId)
    }
    
    if (!targetData.length) return { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
    
    const getAvgScore = (q) => {
      const validScores = targetData.map(t => t.qScores[q]).filter(s => s !== null)
      if (!validScores.length) return 0
      const sum = validScores.reduce((acc, score) => acc + score, 0)
      return Math.round(sum / validScores.length)
    }
    
    return { Q1: getAvgScore('Q1'), Q2: getAvgScore('Q2'), Q3: getAvgScore('Q3'), Q4: getAvgScore('Q4') }
  }

  const trend = getTrendStats()
  const [y1, y2, y3, y4] = [120 - trend.Q1 * 0.9, 120 - trend.Q2 * 0.9, 120 - trend.Q3 * 0.9, 120 - trend.Q4 * 0.9]
  const smoothPath = `M 50 ${y1} C 100 ${y1}, 100 ${y2}, 150 ${y2} C 200 ${y2}, 200 ${y3}, 250 ${y3} C 300 ${y3}, 300 ${y4}, 350 ${y4}`
  const closedPath = `${smoothPath} L 350 130 L 50 130 Z`

  if (loading) return <AdminLayout><div style={{ padding: '2rem', textAlign: 'center' }}>Loading Analytics...</div></AdminLayout>

  return (
    <AdminLayout openEscalations={summary?.openEscalations || 0}>
      <style>{`
        .analytics-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; margin-top: 1.5rem; }
        .chart-card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 1.5rem; box-shadow: none; color: #c9d1d9; }
        .heatmap-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }
        .heatmap-cell { height: 32px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; color: white; }
        .progress-bar-bg { background: #30363d; border-radius: 999px; height: 6px; width: 100%; margin-top: 0.5rem; }
        .progress-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #58a6ff, #1f6feb); transition: width 0.5s ease; }
        @media (max-width: 1024px) { .analytics-grid { grid-template-columns: 1fr; } }
      `}</style>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid #30363d', marginBottom: '1.5rem' }}>
        <button onClick={() => setMainTab('analytics')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', fontWeight: 700, padding: '0.75rem 1rem', color: mainTab === 'analytics' ? '#58a6ff' : '#8b949e', borderBottom: mainTab === 'analytics' ? '3px solid #58a6ff' : '3px solid transparent' }}>📊 Overview & Analytics</button>
        <button onClick={() => setMainTab('cron')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', fontWeight: 700, padding: '0.75rem 1rem', color: mainTab === 'cron' ? '#58a6ff' : '#8b949e', borderBottom: mainTab === 'cron' ? '3px solid #58a6ff' : '3px solid transparent' }}>⚙️ Cron Jobs</button>
      </div>

      {mainTab === 'analytics' ? (
        <>
          {/* Summary Cards */}
          <div className="admin-summary-grid">
            <div className="admin-stat-card"><div className="stat-label">Total users</div><div className="stat-value">{summary?.totalUsers ?? '—'}</div><div className="stat-sub">in the portal</div></div>
            <div className="admin-stat-card"><div className="stat-label">Goal sheets</div><div className="stat-value">{summary?.totalSheets ?? '—'}</div><div className="stat-sub">this cycle</div></div>
            <div className="admin-stat-card"><div className="stat-label">Open escalations</div><div className="stat-value" style={{ color: summary?.openEscalations > 0 ? '#f85149' : 'inherit'}}>{summary?.openEscalations ?? '—'}</div><div className="stat-sub">need attention</div></div>
            <div className="admin-stat-card"><div className="stat-label">Active cycle</div><div className="stat-value">{summary?.activeCycle?.name ?? 'None'}</div><div className="stat-sub">current FY</div></div>
          </div>

          <div className="analytics-grid">
            {/* QoQ Trends */}
            <div className="chart-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f0f6fc' }}>📈 QoQ Goal Achievement Trends</h3>
                <select value={analyticsLevel} onChange={e => setAnalyticsLevel(e.target.value)} className="admin-select" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 8 }}>
                  <option value="org">🏢 Organisation Level</option>
                  {allManagers.map(m => <option key={m.id} value={`team_${m.id}`}>👥 Team: {m.name}</option>)}
                </select>
              </div>
              <div style={{ position: 'relative', height: '180px' }}>
                <svg viewBox="0 0 400 150" width="100%" height="100%">
                  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1f6feb" stopOpacity="0.4"/><stop offset="100%" stopColor="#1f6feb" stopOpacity="0.05"/></linearGradient></defs>
                  <line x1="50" y1="30" x2="350" y2="30" stroke="#21262d" /><line x1="50" y1="75" x2="350" y2="75" stroke="#21262d" /><line x1="50" y1="120" x2="350" y2="120" stroke="#30363d" strokeWidth="1.5" />
                  <path d={closedPath} fill="url(#g)" /><path d={smoothPath} fill="none" stroke="#58a6ff" strokeWidth="3" />
                  {[ {x:50, y:y1, v:trend.Q1, l:'Q1'}, {x:150, y:y2, v:trend.Q2, l:'Q2'}, {x:250, y:y3, v:trend.Q3, l:'Q3'}, {x:350, y:y4, v:trend.Q4, l:'Q4'} ].map(p => (
                    <g key={p.l}>
                      <circle cx={p.x} cy={p.y} r="5" fill="#1f6feb" stroke="#161b22" strokeWidth="2" />
                      <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#f0f6fc">{p.v}%</text>
                      <text x={p.x} y="142" textAnchor="middle" fontSize="10" fill="#8b949e" fontWeight="bold">{p.l}</text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>

            {/* Manager Effectiveness */}
            <div className="chart-card">
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700, color: '#f0f6fc' }}>📋 Manager Effectiveness</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {managersStats.length === 0 ? <div className="admin-empty">No manager stats</div> : managersStats.slice(0,4).map(m => (
                  <div key={m.name} style={{ background: '#0d1117', padding: '0.85rem', borderRadius: 8, border: '1px solid #30363d' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                      <span style={{ color: '#f0f6fc' }}>{m.name}</span>
                      <span style={{ color: '#58a6ff' }}>{m.verification}% Verified</span>
                    </div>
                    <div className="progress-bar-bg" style={{ height: 4, margin: 0 }}><div className="progress-bar-fill" style={{ width: `${m.verification}%`, background: 'linear-gradient(90deg, #58a6ff, #1f6feb)' }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Employee & Manager Completion Compliance Directory ── */}
          <div className="chart-card" style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#f0f6fc' }}>👥 Completion Compliance Directory</h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#8b949e' }}>
                  Real-time quarter-on-quarter check-in compliance status for all employees and reporting managers.
                </p>
              </div>

              {/* Controls */}
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', background: '#0d1117', border: '1px solid #30363d', borderRadius: '8px', padding: '2px' }}>
                  <button
                    onClick={() => setDirectoryTab('employees')}
                    style={{
                      background: directoryTab === 'employees' ? '#1f6feb' : 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#ffffff',
                      padding: '0.4rem 1rem',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    Employees
                  </button>
                  <button
                    onClick={() => setDirectoryTab('managers')}
                    style={{
                      background: directoryTab === 'managers' ? '#1f6feb' : 'transparent',
                      border: 'none',
                      borderRadius: '6px',
                      color: '#ffffff',
                      padding: '0.4rem 1rem',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    Managers
                  </button>
                </div>

                <input
                  type="text"
                  placeholder="🔍 Search name..."
                  value={directorySearch}
                  onChange={e => setDirectorySearch(e.target.value)}
                  style={{
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    color: '#c9d1d9',
                    borderRadius: '8px',
                    padding: '0.4rem 0.75rem',
                    fontSize: '0.8rem',
                    width: '180px'
                  }}
                />
              </div>
            </div>

            {directoryTab === 'employees' ? (
              (() => {
                const filteredEmployees = allEmployees.filter(emp => {
                  const manager = allManagers.find(m => m.id === emp.manager_id)
                  return emp.name.toLowerCase().includes(directorySearch.toLowerCase()) || 
                    (manager?.name || '').toLowerCase().includes(directorySearch.toLowerCase())
                })

                return filteredEmployees.length === 0 ? (
                  <div className="admin-empty" style={{ background: '#0d1117', border: '1px dashed #30363d' }}>No employees found matching the search.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #30363d', color: '#8b949e' }}>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Employee</th>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Reporting Manager</th>
                          <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700, textAlign: 'center' }}>Q1</th>
                          <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700, textAlign: 'center' }}>Q2</th>
                          <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700, textAlign: 'center' }}>Q3</th>
                          <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700, textAlign: 'center' }}>Q4</th>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700, textAlign: 'right', width: '200px' }}>Completion Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEmployees.map(emp => {
                          const tracker = trackerData.find(t => t.id === emp.id)
                          const manager = allManagers.find(m => m.id === emp.manager_id)
                          
                          const q1 = tracker?.qScores?.Q1
                          const q2 = tracker?.qScores?.Q2
                          const q3 = tracker?.qScores?.Q3
                          const q4 = tracker?.qScores?.Q4
                          
                          const completedCount = [q1, q2, q3, q4].filter(q => q !== null).length
                          const pct = Math.round((completedCount / 4) * 100)
                          
                          const badgeStyle = (val) => ({
                            display: 'inline-block',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '12px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            textAlign: 'center',
                            width: '70px',
                            background: val !== null ? '#15803d' : '#21262d',
                            color: val !== null ? '#bbf7d0' : '#8b949e'
                          })

                          return (
                            <tr key={emp.id} style={{ borderBottom: '1px solid #21262d', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = '#1f242c'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                              <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#f0f6fc' }}>{emp.name}</td>
                              <td style={{ padding: '0.75rem 1rem', color: '#c9d1d9' }}>{manager?.name || 'Unassigned'}</td>
                              <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                                <span style={badgeStyle(q1)}>{q1 !== null ? 'DONE' : 'PENDING'}</span>
                              </td>
                              <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                                <span style={badgeStyle(q2)}>{q2 !== null ? 'DONE' : 'PENDING'}</span>
                              </td>
                              <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                                <span style={badgeStyle(q3)}>{q3 !== null ? 'DONE' : 'PENDING'}</span>
                              </td>
                              <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                                <span style={badgeStyle(q4)}>{q4 !== null ? 'DONE' : 'PENDING'}</span>
                              </td>
                              <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                  <span style={{ fontWeight: 700, color: '#58a6ff' }}>{pct}%</span>
                                  <div style={{ background: '#21262d', borderRadius: '4px', height: '6px', width: '80px', overflow: 'hidden' }}>
                                    <div style={{ background: 'linear-gradient(90deg, #58a6ff, #1f6feb)', height: '100%', width: `${pct}%` }} />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })()
            ) : (
              (() => {
                const filteredManagers = matrixData.filter(mgr => {
                  return mgr.name.toLowerCase().includes(directorySearch.toLowerCase())
                })

                return filteredManagers.length === 0 ? (
                  <div className="admin-empty" style={{ background: '#0d1117', border: '1px dashed #30363d' }}>No managers found matching the search.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #30363d', color: '#8b949e' }}>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Manager</th>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Direct Reports</th>
                          <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700, textAlign: 'center' }}>Q1 Compliance</th>
                          <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700, textAlign: 'center' }}>Q2 Compliance</th>
                          <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700, textAlign: 'center' }}>Q3 Compliance</th>
                          <th style={{ padding: '0.75rem 0.5rem', fontWeight: 700, textAlign: 'center' }}>Q4 Compliance</th>
                          <th style={{ padding: '0.75rem 1rem', fontWeight: 700, textAlign: 'right', width: '200px' }}>Effectiveness Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredManagers.map(mgr => (
                          <tr key={mgr.name} style={{ borderBottom: '1px solid #21262d', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = '#1f242c'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                            <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#f0f6fc' }}>{mgr.name}</td>
                            <td style={{ padding: '0.75rem 1rem', color: '#c9d1d9', fontWeight: 600 }}>{mgr.totalSubs} employees</td>
                            <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: '#58a6ff', fontWeight: 700 }}>{mgr.q1}%</td>
                            <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: '#58a6ff', fontWeight: 700 }}>{mgr.q2}%</td>
                            <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: '#58a6ff', fontWeight: 700 }}>{mgr.q3}%</td>
                            <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: '#58a6ff', fontWeight: 700 }}>{mgr.q4}%</td>
                            <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <span style={{ fontWeight: 700, color: '#a5b4fc' }}>{mgr.verification}%</span>
                                <div style={{ background: '#21262d', borderRadius: '4px', height: '6px', width: '80px', overflow: 'hidden' }}>
                                  <div style={{ background: 'linear-gradient(90deg, #a5b4fc, #6366f1)', height: '100%', width: `${mgr.verification}%` }} />
                                </div>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })()
            )}
          </div>
        </>
      ) : (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="chart-card">
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700 }}>⚡ Background Queue & Engine Workers</h3>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1.5rem' }}>GoalFlow triggers automated cron scans and BullMQ background workers to execute deadline logic, check-in window closures, and rule validations.</p>
            
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
              <button onClick={handleTriggerCron} disabled={triggering} style={{ padding: '0.75rem 1.5rem', borderRadius: 8, fontWeight: 700, cursor: 'pointer', border: 'none', background: triggering ? '#a5b4fc' : '#4f46e5', color: '#fff' }}>
                {triggering ? '🔄 Executing...' : '🚀 Force Execute Cron Engine Now'}
              </button>
            </div>
            
            {triggerMessage && (
              <div style={{ padding: '1rem', borderRadius: 8, background: triggerMessage.includes('✅') ? '#f0fdf4' : '#fdf2f2', color: triggerMessage.includes('✅') ? '#15803d' : '#b91c1c', fontSize: '0.85rem', fontWeight: 600, border: `1px solid ${triggerMessage.includes('✅') ? '#bbf7d0' : '#fecaca'}` }}>
                {triggerMessage}
              </div>
            )}
            
            <h4 style={{ margin: '1.5rem 0 1rem 0', fontSize: '1rem', fontWeight: 700, color: '#f0f6fc' }}>⚙️ Active Scheduler Parameters</h4>
            <div style={{ border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden', background: '#0d1117' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#161b22', borderBottom: '1px solid #30363d', color: '#8b949e' }}>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Setting Key</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Description</th>
                    <th style={{ padding: '0.75rem 1rem', fontWeight: 700, width: '320px' }}>Active Config Value</th>
                  </tr>
                </thead>
                <tbody>
                  {settingsList.map(s => {
                    const isBool = s.value === 'true' || s.value === 'false'
                    const isUnit = s.key === 'escalation_deadline_unit'
                    
                    return (
                      <tr key={s.key} style={{ borderBottom: '1px solid #21262d' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#58a6ff' }}>{s.key}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#8b949e' }}>{s.description || 'App configuration value'}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            {isUnit ? (
                              <select 
                                defaultValue={s.value} 
                                id={`input_${s.key}`}
                                className="admin-select"
                                style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', background: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 6, flexGrow: 1 }}
                              >
                                <option value="days">📅 Days</option>
                                <option value="hours">⏰ Hours</option>
                                <option value="minutes">⚡ Minutes</option>
                              </select>
                            ) : isBool ? (
                              <select 
                                defaultValue={s.value} 
                                id={`input_${s.key}`}
                                className="admin-select"
                                style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', background: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 6, flexGrow: 1 }}
                              >
                                <option value="true">✅ True / Enabled</option>
                                <option value="false">❌ False / Disabled</option>
                              </select>
                            ) : (
                              <input 
                                type="text"
                                defaultValue={s.value}
                                id={`input_${s.key}`}
                                style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', background: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 6, flexGrow: 1 }}
                              />
                            )}
                            <button 
                              onClick={() => {
                                const val = document.getElementById(`input_${s.key}`).value
                                handleSaveSetting(s.key, val)
                              }}
                              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 600, background: '#1f6feb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', transition: 'background 0.2s' }}
                              onMouseOver={e => e.currentTarget.style.background = '#388bfd'}
                              onMouseOut={e => e.currentTarget.style.background = '#1f6feb'}
                            >
                              Save
                            </button>
                          </div>
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
