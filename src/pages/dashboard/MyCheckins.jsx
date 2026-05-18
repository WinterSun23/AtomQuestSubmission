import { useState, useEffect } from 'react'
import { getMyGoalSheet, saveCheckIn, logEvent } from '../../lib/userApi'
import { useApp } from '../../lib/AppContext'
import { calculateProgressScore } from '../../lib/scoreUtils'
import { supabase } from '../../lib/supabase'

export default function MyCheckins() {
  const { activeCycle: cycle, activeWindow: window, loading: contextLoading } = useApp()
  const [goals, setGoals] = useState([])
  const [checkins, setCheckins] = useState({}) // mapped by goal_id
  const [loading, setLoading] = useState(true)
  const [sheetStatus, setSheetStatus] = useState(null)
  const [historyCheckins, setHistoryCheckins] = useState([])
  const [savingAll, setSavingAll] = useState(false)

  useEffect(() => {
    loadData()
  }, [contextLoading, cycle, window])

  async function loadData() {
    if (contextLoading || !cycle) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const sheet = await getMyGoalSheet(cycle.id)
      if (sheet) {
        setSheetStatus(sheet.status)
        if (sheet.status === 'approved' && sheet.goals) {
          setGoals(sheet.goals)
          
          if (window) {
            const checkinsMap = {}
            sheet.goals.forEach(g => {
              checkinsMap[g.id] = {
                actual_achievement: '',
                actual_date: '',
                status: 'not_started'
              }
            })
            setCheckins(checkinsMap)

            // Fetch all historical check-ins across the entire cycle for these goals
            const { data: allHistory } = await supabase
              .from('check_ins')
              .select(`
                *,
                check_in_windows (
                  quarter, window_open, window_close
                )
              `)
              .in('goal_id', sheet.goals.map(g => g.id))
            
            if (allHistory) {
              // Sort chronologically by quarter
              setHistoryCheckins(allHistory.sort((a, b) => {
                const qA = a.check_in_windows?.quarter || ''
                const qB = b.check_in_windows?.quarter || ''
                return qA.localeCompare(qB)
              }))
            }
          }
        }
      }
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  function handleChange(goalId, field, value) {
    setCheckins(prev => ({
      ...prev,
      [goalId]: {
        ...prev[goalId],
        [field]: value
      }
    }))
  }

  async function handleSave(goalId) {
    if (!window) return
    const data = checkins[goalId]
    if (!data) return
    
    try {
      const goal = goals.find(g => g.id === goalId)
      await saveCheckIn({
        goalId,
        windowId: window.id,
        actualAchievement: goal.uom_type === 'timeline' ? null : data.actual_achievement,
        actualDate: goal.uom_type === 'timeline' ? data.actual_date : null,
        status: data.status || 'not_started'
      })
      
      await logEvent({
        action: 'UPDATE_PROGRESS',
        goalId: goalId,
        description: `Employee updated progress for goal: "${goal.title}"`
      })

      alert('Progress saved!')
      loadData()
    } catch (err) {
      alert('Error saving progress: ' + err.message)
    }
  }

  async function handleSaveAll() {
    if (!window || goals.length === 0) return
    setSavingAll(true)
    try {
      const promises = goals.map(async goal => {
        const data = checkins[goal.id] || { actual_achievement: '', actual_date: '', status: 'not_started' }
        const hasAchievement = goal.uom_type === 'timeline' ? data.actual_date : data.actual_achievement
        if (!hasAchievement) return

        await saveCheckIn({
          goalId: goal.id,
          windowId: window.id,
          actualAchievement: goal.uom_type === 'timeline' ? null : data.actual_achievement,
          actualDate: goal.uom_type === 'timeline' ? data.actual_date : null,
          status: data.status || 'not_started'
        })
      })

      await Promise.all(promises)
      
      await logEvent({
        action: 'UPDATE_PROGRESS',
        description: `Employee updated progress for goals in ${window.quarter}`
      })

      alert('All progress updates saved successfully!')
      loadData()
    } catch (err) {
      alert('Error saving all progress: ' + err.message)
    } finally {
      setSavingAll(false)
    }
  }

  if (loading) return <div className="user-empty">Loading...</div>
  if (!cycle) return <div className="user-empty">No active performance cycle found.</div>
  if (!sheetStatus || sheetStatus !== 'approved') {
    return (
      <div className="user-card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <h3>No Approved Goal Sheet Found</h3>
        <p style={{ color: '#6b7280', marginBottom: 0 }}>
          Check-ins are only available once your Goal Sheet has been submitted and approved by your manager. (Current status: {sheetStatus || 'None'})
        </p>
      </div>
    )
  }
  if (!window) return <div className="user-empty">No active check-in window at this time. Check-ins open later in the quarter.</div>
  if (goals.length === 0) return <div className="user-empty">You have no goals to track.</div>

  return (
    <div>
      <div className="user-page-header">
        <h1 className="user-page-title">My Check-ins</h1>
        <p className="user-page-subtitle">{window.quarter} Window (Closes {window.window_close})</p>
      </div>

      <div className="user-table-wrap">
        <table className="user-table">
          <thead>
            <tr>
              <th>Goal</th>
              <th>Target</th>
              <th>Actual Achievement</th>
              <th>Status</th>
              <th>Score</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {goals.map(goal => {
              const current = checkins[goal.id] || {}
              const goalHistory = historyCheckins.filter(h => h.goal_id === goal.id)
              return (
                <tr key={goal.id}>
                  <td style={{ maxWidth: '300px', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 600 }}>{goal.title}</div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.35rem' }}>Weight: {goal.weightage}%</div>
                    
                    {/* Nested History Timeline */}
                    {goalHistory.length > 0 && (
                      <div style={{ marginTop: '0.75rem', borderTop: '1px dashed #e5e7eb', paddingTop: '0.5rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', marginBottom: '0.35rem' }}>📜 Check-in & Comment History:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {goalHistory.map(h => (
                            <div key={h.id} style={{ fontSize: '0.72rem', background: '#f9fafb', padding: '0.35rem', borderRadius: '4px', borderLeft: '3px solid #6b7280' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#4b5563' }}>
                                <span>{h.check_in_windows?.quarter || 'Check-in'}</span>
                                <span className={`badge badge-${h.status}`} style={{ fontSize: '0.62rem', padding: '0.1rem 0.25rem' }}>{h.status.replace('_', ' ')}</span>
                              </div>
                              <div style={{ marginTop: '0.15rem' }}>
                                <strong>Achievement:</strong> {h.actual_achievement !== null ? `${h.actual_achievement}` : (h.actual_date || 'N/A')}
                                {h.computed_score !== null && ` (Score: ${Number(h.computed_score).toFixed(0)}%)`}
                              </div>
                              {h.manager_comment && (
                                <div style={{ color: '#4f46e5', marginTop: '0.15rem', fontStyle: 'italic' }}>
                                  💬 Manager: "{h.manager_comment}"
                               </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </td>
                  <td>{goal.uom_type === 'timeline' ? goal.target_date : goal.target}</td>
                  <td>
                    {goal.uom_type === 'timeline' ? (
                      <input 
                        type="date" 
                        className="user-input"
                        value={current.actual_date || ''}
                        onChange={e => handleChange(goal.id, 'actual_date', e.target.value)}
                      />
                    ) : (
                      <input 
                        type="number" 
                        className="user-input"
                        style={{ width: '100px' }}
                        value={current.actual_achievement || ''}
                        onChange={e => handleChange(goal.id, 'actual_achievement', e.target.value)}
                      />
                    )}
                  </td>
                  <td>
                    <select 
                      className="user-select"
                      value={current.status || 'not_started'}
                      onChange={e => handleChange(goal.id, 'status', e.target.value)}
                    >
                      <option value="not_started">Not Started</option>
                      <option value="on_track">On Track</option>
                      <option value="completed">Completed</option>
                    </select>
                  </td>
                  <td>
                    {current.computed_score !== undefined ? `${Number(current.computed_score).toFixed(0)}%` : '-'}
                  </td>
                  <td>
                    <button className="btn-sm btn-primary-sm" onClick={() => handleSave(goal.id)}>Save</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button 
          className="btn-sm btn-success-sm" 
          onClick={handleSaveAll} 
          disabled={savingAll}
          style={{ fontSize: '0.9rem', padding: '0.6rem 1.2rem' }}
        >
          {savingAll ? 'Saving...' : 'Save All Progress'}
        </button>
      </div>
    </div>
  )
}
