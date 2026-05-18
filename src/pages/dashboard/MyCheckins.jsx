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
            // Fetch existing checkins for this window
            const { data } = await supabase
              .from('check_ins')
              .select('*')
              .eq('window_id', window.id)
              .in('goal_id', sheet.goals.map(g => g.id))
              
            const checkinsMap = {}
            if (data) {
              data.forEach(c => {
                checkinsMap[c.goal_id] = {
                  actual_achievement: c.actual_achievement ?? '',
                  actual_date: c.actual_date ?? '',
                  status: c.status,
                  computed_score: c.computed_score,
                  manager_comment: c.manager_comment ?? ''
                }
              })
            }
            setCheckins(checkinsMap)
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
      // Basic frontend score engine
      const goal = goals.find(g => g.id === goalId)
      const score = calculateProgressScore(
        goal.uom_type, 
        goal.target, 
        data.actual_achievement, 
        data.actual_date, 
        goal.target_date
      )

      await saveCheckIn({
        goalId,
        windowId: window.id,
        actualAchievement: goal.uom_type === 'timeline' ? null : data.actual_achievement,
        actualDate: goal.uom_type === 'timeline' ? data.actual_date : null,
        status: data.status || 'not_started'
      })
      
      // We also should update the computed score, let's update check_ins table manually here for the demo
      await supabase.from('check_ins').update({ computed_score: score }).eq('goal_id', goalId).eq('window_id', window.id)
      
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
        const score = calculateProgressScore(
          goal.uom_type, 
          goal.target, 
          data.actual_achievement, 
          data.actual_date, 
          goal.target_date
        )

        await saveCheckIn({
          goalId: goal.id,
          windowId: window.id,
          actualAchievement: goal.uom_type === 'timeline' ? null : data.actual_achievement,
          actualDate: goal.uom_type === 'timeline' ? data.actual_date : null,
          status: data.status || 'not_started'
        })
        
        await supabase
          .from('check_ins')
          .update({ computed_score: score })
          .eq('goal_id', goal.id)
          .eq('window_id', window.id)
      })

      await Promise.all(promises)
      
      await logEvent({
        action: 'UPDATE_PROGRESS',
        description: `Employee updated progress for all goals in ${window.quarter}`
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
              return (
                <tr key={goal.id}>
                  <td style={{ maxWidth: '250px' }}>
                    <div style={{ fontWeight: 600 }}>{goal.title}</div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Weight: {goal.weightage}%</div>
                    {current.manager_comment && (
                      <div style={{ fontSize: '0.78rem', color: '#4f46e5', marginTop: '0.25rem', background: '#f5f3ff', padding: '0.2rem 0.4rem', borderRadius: '4px', borderLeft: '2px solid #8b5cf6' }}>
                        💬 <em>Manager feedback:</em> "{current.manager_comment}"
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
