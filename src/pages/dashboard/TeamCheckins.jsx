import { useState, useEffect } from 'react'
import { getActiveCycle, getActiveCheckInWindow } from '../../lib/userApi'
import { getTeamCheckInsSummary, saveManagerComment } from '../../lib/managerApi'
import { supabase } from '../../lib/supabase'

export default function TeamCheckins() {
  const [cycle, setCycle] = useState(null)
  const [window, setWindow] = useState(null)
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [goals, setGoals] = useState([])
  const [checkins, setCheckins] = useState({}) // mapped by goal_id
  const [goalComments, setGoalComments] = useState({}) // mapped by goal_id
  const [commentText, setCommentText] = useState('')
  const [savingAll, setSavingAll] = useState(false)
  const [historyCheckins, setHistoryCheckins] = useState([])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const activeCycle = await getActiveCycle()
      setCycle(activeCycle)
      if (activeCycle) {
        const activeWindow = await getActiveCheckInWindow(activeCycle.id)
        setWindow(activeWindow)
        if (activeWindow) {
          const summary = await getTeamCheckInsSummary(activeWindow.id)
          setTeam(summary)
        }
      }
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  async function handleReview(employeeId, employeeName) {
    setSelectedEmployee({ id: employeeId, name: employeeName })
    setGoals([])
    setCheckins({})
    setGoalComments({})
    setCommentText('')
    
    try {
      // 1. Fetch employee's approved goal sheet
      const { data: sheet } = await supabase
        .from('goal_sheets')
        .select(`
          id, status,
          goals (
            id, thrust_area_id, title, description, uom_type, target, target_date, weightage, is_locked, is_shared
          )
        `)
        .eq('employee_id', employeeId)
        .eq('cycle_id', cycle.id)
        .eq('status', 'approved')
        .maybeSingle()
        
      if (sheet && sheet.goals) {
        setGoals(sheet.goals)
        
        // 2. Fetch existing check-ins for the active window
        const { data: checkinsList } = await supabase
          .from('check_ins')
          .select('*')
          .eq('window_id', window.id)
          .in('goal_id', sheet.goals.map(g => g.id))
          
        const commentsMap = {}
        const checkinsMap = {}
        if (checkinsList) {
          checkinsList.forEach(c => {
            commentsMap[c.goal_id] = c.manager_comment || ''
            checkinsMap[c.goal_id] = c
          })
        }
        setGoalComments(commentsMap)
        setCheckins(checkinsMap)

        // 2b. Fetch all historical check-ins across the entire cycle for these goals
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
          setHistoryCheckins(allHistory.sort((a, b) => {
            const qA = a.check_in_windows?.quarter || ''
            const qB = b.check_in_windows?.quarter || ''
            return qA.localeCompare(qB)
          }))
        }
      }
      
      // 3. Fetch global comment
      const { data: globalComm } = await supabase
        .from('manager_comments')
        .select('comment')
        .eq('employee_id', employeeId)
        .eq('window_id', window.id)
        .order('created_at', { ascending: false })
        .limit(1)
        
      setCommentText(globalComm?.[0]?.comment || '')
    } catch (err) {
      console.error(err)
    }
  }

  function handleGoalCommentChange(goalId, comment) {
    setGoalComments(prev => ({
      ...prev,
      [goalId]: comment
    }))
  }

  async function handleSaveHistoricalComment(checkinId, comment) {
    try {
      const { error } = await supabase
        .from('check_ins')
        .update({ manager_comment: comment })
        .eq('id', checkinId)

      if (error) throw error
      
      // Update local history state
      setHistoryCheckins(prev => prev.map(h => h.id === checkinId ? { ...h, manager_comment: comment } : h))
      alert('Historical comment saved successfully!')
    } catch (err) {
      alert('Error saving historical comment: ' + err.message)
    }
  }

  async function handleSaveAllFeedback() {
    setSavingAll(true)
    try {
      // Save/upsert overall global review note
      const { data: existingList } = await supabase
        .from('manager_comments')
        .select('id')
        .eq('employee_id', selectedEmployee.id)
        .eq('window_id', window.id)
        .order('created_at', { ascending: false })
        .limit(1)
        
      const existing = existingList?.[0]
      if (existing) {
        await supabase.from('manager_comments').update({ comment: commentText }).eq('id', existing.id)
      } else {
        await saveManagerComment(selectedEmployee.id, window.id, commentText)
      }
      
      alert('Overall review notes saved successfully!')
      setSelectedEmployee(null)
      loadData()
    } catch (err) {
      alert('Error saving feedback: ' + err.message)
    } finally {
      setSavingAll(false)
    }
  }

  if (loading) return <div className="user-empty">Loading...</div>
  if (!cycle) return <div className="user-empty">No active performance cycle found.</div>
  if (!window) return <div className="user-empty">No active check-in window found.</div>

  return (
    <div>
      <div className="user-page-header">
        <h1 className="user-page-title">Team Check-ins</h1>
        <p className="user-page-subtitle">{window.quarter} Window (Closes {window.window_close})</p>
      </div>

      {selectedEmployee ? (
        <div className="user-card" style={{ maxWidth: '1000px', width: '100%' }}>
          <button className="btn-sm btn-ghost-sm" onClick={() => setSelectedEmployee(null)} style={{ marginBottom: '1.5rem' }}>
            ← Back to Team
          </button>
          
          <h2 className="user-card-title" style={{ marginBottom: '1.5rem' }}>Review Progress Update: {selectedEmployee.name}</h2>

          {goals.length === 0 ? (
            <div className="user-empty" style={{ marginBottom: '1.5rem' }}>This employee has no approved goals.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '2rem' }}>
              {goals.map(goal => {
                const goalHistory = historyCheckins.filter(h => h.goal_id === goal.id)
                return (
                  <div key={goal.id} className="user-card" style={{ border: '1px solid #e5e7eb', background: '#fbfbfd', padding: '1.5rem', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', borderBottom: '1px solid #f3f4f6', paddingBottom: '0.75rem' }}>
                      <div>
                        <h3 style={{ margin: 0, color: '#111827', fontSize: '1.05rem', fontWeight: 700 }}>{goal.title}</h3>
                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#6b7280' }}>
                          {goal.description || 'No description provided.'}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className="badge badge-submitted" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>
                          Weight: {goal.weightage}%
                        </span>
                        <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>
                          Target: {goal.uom_type === 'timeline' ? goal.target_date : goal.target}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: '1rem' }}>
                      <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.88rem', color: '#4b5563', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        📊 Progress Check-in Submissions ({goalHistory.length})
                      </h4>

                      {goalHistory.length === 0 ? (
                        <div className="user-empty" style={{ padding: '1.5rem', background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
                          No check-ins submitted yet for this goal.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {goalHistory.map((h, idx) => (
                            <div key={h.id} style={{
                              padding: '1rem',
                              background: 'white',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.75rem',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <strong style={{ fontSize: '0.82rem', color: '#1f2937' }}>
                                    Submission #{goalHistory.length - idx} ({h.check_in_windows?.quarter || 'Q'})
                                  </strong>
                                  <span className={`badge badge-${h.status === 'completed' ? 'approved' : h.status === 'on_track' ? 'rework' : 'draft'}`} style={{ fontSize: '0.7rem' }}>
                                    {h.status.replace('_', ' ')}
                                  </span>
                                </div>
                                <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
                                  Submitted at {new Date(h.updated_at).toLocaleString()}
                                </span>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', padding: '0.5rem 0', borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}>
                                <div>
                                  <div style={{ fontSize: '0.7rem', color: '#9ca3af', fontWeight: 600 }}>ACTUAL ACHIEVEMENT</div>
                                  <div style={{ fontWeight: 700, color: '#111827', marginTop: '0.15rem', fontSize: '0.9rem' }}>
                                    {h.actual_achievement !== null ? `${h.actual_achievement}` : (h.actual_date || '—')}
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: '0.7rem', color: '#9ca3af', fontWeight: 600 }}>COMPUTED SCORE</div>
                                  <div style={{ fontWeight: 700, color: '#4f46e5', marginTop: '0.15rem', fontSize: '0.9rem' }}>
                                    {h.computed_score !== null ? `${Number(h.computed_score).toFixed(0)}%` : '—'}
                                  </div>
                                </div>
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.35rem' }}>
                                  💬 Manager Feedback Comment
                                </label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  <input
                                    type="text"
                                    className="user-input"
                                    placeholder="Type feedback for this specific check-in..."
                                    style={{ flex: 1, fontSize: '0.82rem', padding: '0.35rem 0.5rem' }}
                                    defaultValue={h.manager_comment || ''}
                                    id={`hist-comm-${h.id}`}
                                  />
                                  <button
                                    className="btn-sm btn-primary-sm"
                                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                                    onClick={() => {
                                      const val = document.getElementById(`hist-comm-${h.id}`).value
                                      handleSaveHistoricalComment(h.id, val)
                                    }}
                                  >
                                    Save Comment
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>
              Overall Manager Review & Feedback Notes
            </label>
            <textarea 
              className="user-input" 
              style={{ width: '100%', boxSizing: 'border-box', height: '100px', fontSize: '0.9rem' }}
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder="Provide general quarterly performance notes or summary remarks..."
            />
          </div>
          
          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button className="btn-sm btn-ghost-sm" onClick={() => setSelectedEmployee(null)}>Cancel</button>
            <button className="btn-sm btn-success-sm" onClick={handleSaveAllFeedback} disabled={savingAll}>
              {savingAll ? 'Saving...' : 'Save All Feedback'}
            </button>
          </div>
        </div>
      ) : (
        <div className="user-table-wrap">
          <table className="user-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Feedback Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {team.length === 0 ? (
                <tr><td colSpan="4" className="user-empty">No direct reports found.</td></tr>
              ) : team.map(member => (
                <tr key={member.employeeId}>
                  <td style={{ fontWeight: 600 }}>{member.employeeName}</td>
                  <td>{member.department || '-'}</td>
                  <td>
                    {member.hasComment ? (
                      <span className="badge badge-approved">Completed</span>
                    ) : (
                      <span className="badge badge-draft">Pending</span>
                    )}
                  </td>
                  <td>
                    <button 
                      className="btn-sm btn-ghost-sm" 
                      onClick={() => handleReview(member.employeeId, member.employeeName)}
                    >
                      {member.hasComment ? 'Edit Feedback' : 'Add Feedback'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
