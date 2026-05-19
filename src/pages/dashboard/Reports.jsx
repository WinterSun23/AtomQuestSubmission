import { useState, useEffect } from 'react'
import { getReportsList, generateAchievementReport, downloadReport as fetchDownloadUrl } from '../../lib/backendApi'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../lib/AppContext'

export default function Reports() {
  const { me } = useApp()
  const [loading, setLoading] = useState(false)
  const [reports, setReports] = useState([])
  const [quarter, setQuarter] = useState('')
  const [cycleId, setCycleId] = useState('')
  const [cycles, setCycles] = useState([])

  // Live Preview Telemetry variables
  const [liveData, setLiveData] = useState([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedThrust, setSelectedThrust] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(() => {
    loadReports()
    loadCycles()
  }, [])

  useEffect(() => {
    if (cycleId) {
      loadPreviewData(cycleId, quarter)
    } else {
      setLiveData([])
    }
  }, [cycleId, quarter])

  async function loadCycles() {
    try {
      const { data: cycList } = await supabase.from('cycles').select('*')
      const sorted = cycList || []
      setCycles(sorted)
      const active = sorted.find(c => c.is_active)
      if (active) {
        setCycleId(active.id)
      } else if (sorted.length > 0) {
        setCycleId(sorted[0].id)
      }
    } catch (err) {
      console.error('Error loading cycles:', err)
    }
  }

  async function loadReports() {
    try {
      const reportsList = await getReportsList()
      // Filter out empty placeholder files and sort
      setReports(
        reportsList
          .filter(f => f.name !== '.emptyFolderPlaceholder')
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      )
    } catch (err) {
      console.error('Error loading reports:', err)
    }
  }

  async function loadPreviewData(cid, q) {
    setLoadingPreview(true)
    try {
      // 1. Fetch users under manager/admin scope
      let uQuery = supabase.from('users').select('id, name, email, role, manager_id, departments(name)')
      if (me?.role === 'manager') {
        uQuery = uQuery.eq('manager_id', me.id)
      }
      const { data: scopedUsers, error: uErr } = await uQuery
      if (uErr) throw uErr
      if (!scopedUsers || scopedUsers.length === 0) {
        setLiveData([])
        return
      }

      const uids = scopedUsers.map(u => u.id)

      // 2. Fetch corresponding window ID if quarter is selected
      let winId = null
      if (q) {
        const { data: win } = await supabase
          .from('check_in_windows')
          .select('id')
          .eq('cycle_id', cid)
          .eq('quarter', q)
          .limit(1)
        if (win && win[0]) winId = win[0].id
      }

      // 3. Fetch sheets, goals, check-ins
      const { data: sheets, error: sErr } = await supabase
        .from('goal_sheets')
        .select(`
          id, employee_id, status,
          goals (
            id, title, thrust_area_id, thrust_areas(name), uom_type, target, target_date, weightage,
            check_ins (actual_achievement, actual_date, status, computed_score, window_id, manager_comment, check_in_windows(window_open))
          )
        `)
        .in('employee_id', uids)
        .eq('cycle_id', cid)

      if (sErr) throw sErr

      // Compile rows
      const compiled = []
      sheets.forEach(s => {
        const user = scopedUsers.find(u => u.id === s.employee_id)
        if (!user) return
        
        const goalsList = s.goals || []
        goalsList.forEach(g => {
          let targetCheckins = g.check_ins || []
          if (winId) {
            targetCheckins = targetCheckins.filter(c => c.window_id === winId)
          } else {
            // Sort by latest check-in window open date to align exactly with DB entries
            targetCheckins.sort((a, b) => new Date(b.check_in_windows?.window_open || 0) - new Date(a.check_in_windows?.window_open || 0))
          }
          const checkin = targetCheckins[0] || {}
          const score = checkin.computed_score || 0
          const weightedScore = score * (g.weightage / 100)

          compiled.push({
            employeeId: user.id,
            employeeName: user.name,
            employeeEmail: user.email,
            department: user.departments?.name || '-',
            sheetStatus: s.status,
            goalId: g.id,
            goalTitle: g.title,
            thrustArea: g.thrust_areas?.name || '-',
            uom: g.uom_type,
            target: g.target_date || g.target || '-',
            actual: checkin.actual_achievement || checkin.actual_date || '-',
            checkinStatus: (checkin.status || 'not started').replace('_', ' ').toUpperCase(),
            weightage: g.weightage,
            score: score,
            weightedScore: weightedScore
          })
        })
      })

      setLiveData(compiled)
    } catch (err) {
      console.error('Error loading preview data:', err)
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleGenerateReport() {
    setLoading(true)
    try {
      const data = await generateAchievementReport(cycleId || null, quarter || null)
      if (data.url) {
        window.location.href = data.url // trigger download
      }
      
      // Reload list
      loadReports()
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  async function downloadReport(fileName) {
    try {
      const downloadUrl = await fetchDownloadUrl(fileName)
      window.location.href = downloadUrl
    } catch (err) {
      alert('Error downloading: ' + err.message)
    }
  }

  // Filter rows locally
  const filteredPreview = liveData.filter(row => {
    const matchSearch = !searchTerm || 
      row.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.employeeEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      row.goalTitle.toLowerCase().includes(searchTerm.toLowerCase())

    const matchThrust = !selectedThrust || row.thrustArea === selectedThrust
    const matchStatus = !selectedStatus || row.sheetStatus === selectedStatus

    return matchSearch && matchThrust && matchStatus
  })

  // Extract unique thrust areas dynamically from current liveData
  const uniqueThrustAreas = Array.from(new Set(liveData.map(r => r.thrustArea).filter(t => t !== '-')))

  // Calculate metrics based on the full unfiltered DB scope to ensure they remain static and accurate to DB entries
  const uniqueEmployees = Array.from(new Set(liveData.map(r => r.employeeId))).length
  const totalGoals = liveData.length
  const avgScore = totalGoals > 0 ? (liveData.reduce((sum, r) => sum + r.score, 0) / totalGoals) : 0
  const avgWeightedScore = totalGoals > 0 ? (liveData.reduce((sum, r) => sum + r.weightedScore, 0) / totalGoals) : 0

  return (
    <div>
      <div className="user-page-header">
        <h1 className="user-page-title">Reports & Telemetry</h1>
        <p className="user-page-subtitle">Configure, preview, and download achievement report spreadsheets with robust organizational metrics.</p>
      </div>

      {/* ── Summary Statistics Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div className="user-card" style={{ marginBottom: 0, padding: '1.25rem', borderLeft: '4px solid #6366f1' }}>
          <div style={{ fontSize: '0.78rem', color: '#6b7280', fontWeight: 600 }}>Total Scoped Employees</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1f2937', marginTop: '0.25rem' }}>{uniqueEmployees}</div>
          <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.25rem' }}>in current preview selection</div>
        </div>

        <div className="user-card" style={{ marginBottom: 0, padding: '1.25rem', borderLeft: '4px solid #10b981' }}>
          <div style={{ fontSize: '0.78rem', color: '#6b7280', fontWeight: 600 }}>Goals Monitored</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1f2937', marginTop: '0.25rem' }}>{totalGoals}</div>
          <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.25rem' }}>active strategic milestones</div>
        </div>

        <div className="user-card" style={{ marginBottom: 0, padding: '1.25rem', borderLeft: '4px solid #f59e0b' }}>
          <div style={{ fontSize: '0.78rem', color: '#6b7280', fontWeight: 600 }}>Avg Goal Score</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1f2937', marginTop: '0.25rem' }}>{avgScore.toFixed(1)}%</div>
          <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.25rem' }}>achievement score average</div>
        </div>

        <div className="user-card" style={{ marginBottom: 0, padding: '1.25rem', borderLeft: '4px solid #ec4899' }}>
          <div style={{ fontSize: '0.78rem', color: '#6b7280', fontWeight: 600 }}>Avg Weighted Score</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1f2937', marginTop: '0.25rem' }}>{avgWeightedScore.toFixed(1)}%</div>
          <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.25rem' }}>weighted performance index</div>
        </div>
      </div>

      {/* ── Live Report Builder & Filter Console ── */}
      <div className="user-card" style={{ marginBottom: '2rem' }}>
        <h2 className="user-card-title">🔍 Live Report Builder & Filter Console</h2>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1.25rem' }}>
          Select standard performance periods and search parameters to compile real-time telemetry metrics below.
        </p>
        
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4b5563' }}>Performance Cycle</span>
            <select className="user-select" value={cycleId} onChange={e => setCycleId(e.target.value)} style={{ width: '180px' }}>
              {cycles.map(c => (
                <option key={c.id} value={c.id}>{c.name} {c.is_active ? '(Active)' : ''}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4b5563' }}>Quarter Period</span>
            <select className="user-select" value={quarter} onChange={e => setQuarter(e.target.value)} style={{ width: '150px' }}>
              <option value="">All Check-ins</option>
              <option value="Q1">Q1</option>
              <option value="Q2">Q2</option>
              <option value="Q3">Q3</option>
              <option value="Q4">Q4</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4b5563' }}>Thrust Area</span>
            <select className="user-select" value={selectedThrust} onChange={e => setSelectedThrust(e.target.value)} style={{ width: '160px' }}>
              <option value="">All Areas</option>
              {uniqueThrustAreas.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4b5563' }}>Sheet Status</span>
            <select className="user-select" value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)} style={{ width: '140px' }}>
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, minWidth: '180px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4b5563' }}>Filter by Keyword</span>
            <input
              type="text"
              placeholder="🔍 Search name, email, goal..."
              className="admin-input"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', height: '36px', border: '1px solid #d1d5db', borderRadius: '8px', padding: '0 0.75rem', fontSize: '0.85rem' }}
            />
          </div>

          <button
            className="btn-sm btn-primary-sm"
            onClick={handleGenerateReport}
            disabled={loading || !cycleId}
            style={{ alignSelf: 'flex-end', height: '36px', padding: '0 1.25rem', fontWeight: 700 }}
          >
            {loading ? 'Generating...' : 'Export Stylized Excel Report'}
          </button>
        </div>
      </div>

      {/* ── Compiled Telemetry Live Preview ── */}
      <div className="user-card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 className="user-card-title" style={{ margin: 0 }}>📊 Compiled Telemetry Live Preview (Mini-View)</h2>
          <span style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>Showing up to 5 of {filteredPreview.length} goal items</span>
        </div>

        {loadingPreview ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af' }}>
            <div style={{ width: 24, height: 24, border: '2px solid #e5e7eb', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.6s linear infinite', margin: '0 auto 0.75rem' }} />
            <span>Compiling live preview metrics...</span>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : filteredPreview.length === 0 ? (
          <div className="user-empty">No performance data matching the selected scopes.</div>
        ) : (
          <div>
            <div className="user-table-wrap">
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Goal Title</th>
                    <th>Thrust Area</th>
                    <th>Actual Progress</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPreview.slice(0, 5).map((row, idx) => (
                    <tr key={`${row.goalId}-${idx}`}>
                      <td>
                        <div style={{ fontWeight: 600, color: '#111827' }}>{row.employeeName}</div>
                        <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>{row.employeeEmail}</div>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: '#374151', maxWidth: '280px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{row.goalTitle}</td>
                      <td style={{ fontSize: '0.8rem', color: '#4b5563' }}>{row.thrustArea}</td>
                      <td style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 600 }}>{row.actual}</td>
                      <td>
                        <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '12px', background: '#f3f4f6', color: '#4b5563', fontWeight: 600 }}>
                          {row.checkinStatus}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#111827' }}>{row.score.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredPreview.length > 0 && (
              <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
                <button
                  className="btn-sm btn-primary-sm"
                  onClick={() => setIsModalOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1.25rem', fontWeight: 700 }}
                >
                  🔍 View Full Telemetry Grid & Details ({filteredPreview.length} goals)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Glassmorphic Telemetry Full Preview Modal ── */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: '1.5rem',
          boxSizing: 'border-box'
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '1200px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(226, 232, 240, 0.8)',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid #f1f5f9',
              background: '#f8fafc',
              borderTopLeftRadius: '16px',
              borderTopRightRadius: '16px'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>📊 Performance Telemetry Grid</h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                  Complete list of {filteredPreview.length} goal milestones scoped under current filters.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.85rem',
                  fontWeight: 'bold',
                  color: '#64748b',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.target.style.background = '#e2e8f0'}
                onMouseOut={(e) => e.target.style.background = '#f1f5f9'}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
              <div className="user-table-wrap" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                <table className="user-table">
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, zIndex: 10, background: '#ffffff' }}>
                      <th>Employee</th>
                      <th>Goal Title</th>
                      <th>Thrust Area</th>
                      <th>UoM</th>
                      <th>Target</th>
                      <th>Actual Progress</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Weight</th>
                      <th style={{ textAlign: 'right' }}>Score</th>
                      <th style={{ textAlign: 'right' }}>Weighted Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreview.map((row, idx) => (
                      <tr key={`${row.goalId}-${idx}`}>
                        <td>
                          <div style={{ fontWeight: 600, color: '#111827' }}>{row.employeeName}</div>
                          <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>{row.employeeEmail}</div>
                          <div style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: '2px' }}>{row.department}</div>
                        </td>
                        <td style={{ fontSize: '0.85rem', color: '#374151', maxWidth: '280px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{row.goalTitle}</td>
                        <td style={{ fontSize: '0.8rem', color: '#4b5563' }}>{row.thrustArea}</td>
                        <td style={{ fontSize: '0.8rem', color: '#6b7280' }}>{row.uom}</td>
                        <td style={{ fontSize: '0.8rem', color: '#4b5563' }}>{row.target}</td>
                        <td style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 600 }}>{row.actual}</td>
                        <td>
                          <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '12px', background: '#f3f4f6', color: '#4b5563', fontWeight: 600 }}>
                            {row.checkinStatus}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#4f46e5' }}>{row.weightage}%</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#111827' }}>{row.score.toFixed(1)}%</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#10b981' }}>{row.weightedScore.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              padding: '1rem 1.5rem',
              borderTop: '1px solid #f1f5f9',
              background: '#f8fafc',
              borderBottomLeftRadius: '16px',
              borderBottomRightRadius: '16px'
            }}>
              <button
                className="btn-sm btn-ghost-sm"
                onClick={() => setIsModalOpen(false)}
                style={{ padding: '0.5rem 1.5rem', fontWeight: 700 }}
              >
                Close View
              </button>
            </div>
          </div>
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; transform: scale(0.95); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>
        </div>
      )}

      {/* ── Past Reports Logs ── */}
      <div className="user-card">
        <h2 className="user-card-title">📁 Past Reports Download Logs</h2>
        {reports.length === 0 ? (
          <div className="user-empty">No reports have been generated yet.</div>
        ) : (
          <div className="user-table-wrap">
            <table className="user-table">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Generated At</th>
                  <th>Size</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(r => (
                  <tr key={r.name}>
                    <td style={{ fontWeight: 600, color: '#4f46e5' }}>{r.name}</td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td>{(r.metadata?.size / 1024).toFixed(2)} KB</td>
                    <td>
                      <button className="btn-sm btn-ghost-sm" onClick={() => downloadReport(r.name)}>
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
