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

  const [selectedGoal, setSelectedGoal] = useState(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  function openGoalDrawer(goal) {
    setSelectedGoal(goal)
    setIsDrawerOpen(true)
  }

  function closeGoalDrawer() {
    setIsDrawerOpen(false)
    setSelectedGoal(null)
  }

  if (loading) return <div className="user-empty">Loading...</div>
  if (!cycle) return <div className="user-empty">No active performance cycle found.</div>
  if (!window) return <div className="user-empty">No active check-in window found.</div>

  return (
    <div>
      <style>{`
        .checkin-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
        }
        .checkin-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 1.5rem;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 200px;
        }
        .checkin-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
          border-color: #6366f1;
        }
        .checkin-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 4px;
          height: 100%;
          background: #e5e7eb;
          transition: background 0.3s ease;
        }
        .checkin-card.active-completed::before { background: #10b981; }
        .checkin-card.active-on_track::before { background: #3b82f6; }
        .checkin-card.active-not_started::before { background: #9ca3af; }
        
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

        /* Drawer Overlay */
        .drawer-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(15, 23, 42, 0.3);
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

        /* Drawer Body */
        .drawer-body {
          position: fixed;
          top: 0;
          right: 0;
          width: 480px;
          max-width: 100vw;
          height: 100%;
          background: white;
          box-shadow: -10px 0 25px -5px rgba(0, 0, 0, 0.1), -4px 0 10px -5px rgba(0, 0, 0, 0.06);
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
          border-bottom: 1px solid #f3f4f6;
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
          border-top: 1px solid #f3f4f6;
          background: #f9fafb;
        }

        .timeline-container {
          position: relative;
          padding-left: 1.5rem;
          margin-top: 1rem;
        }
        .timeline-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 4px;
          width: 2px;
          height: 100%;
          background: #e5e7eb;
        }
        .timeline-node {
          position: relative;
          margin-bottom: 1.5rem;
        }
        .timeline-node::before {
          content: '';
          position: absolute;
          top: 4px;
          left: -1.5rem;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #6366f1;
          border: 2px solid white;
          box-shadow: 0 0 0 2px #e5e7eb;
        }
      `}</style>

      <div className="user-page-header">
        <h1 className="user-page-title">Team Check-ins</h1>
        <p className="user-page-subtitle">{window.quarter} Window (Closes {window.window_close})</p>
      </div>

      {selectedEmployee ? (
        <div className="user-card" style={{ maxWidth: '1000px', width: '100%' }}>
          <button className="btn-sm btn-ghost-sm" onClick={() => setSelectedEmployee(null)} style={{ marginBottom: '1.5rem' }}>
            ← Back to Team Directory
          </button>
          
          <h2 className="user-card-title" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Review Progress: {selectedEmployee.name}</span>
            <span style={{ fontSize: '0.82rem', color: '#6b7280', fontWeight: 500 }}>Approved Goals Workspace</span>
          </h2>

          {goals.length === 0 ? (
            <div className="user-empty" style={{ marginBottom: '1.5rem' }}>This employee has no approved goals.</div>
          ) : (
            <div>
              {/* Employee Goal Cards Grid */}
              <div className="checkin-grid">
                {goals.map(goal => {
                  const goalHistory = historyCheckins.filter(h => h.goal_id === goal.id)
                  const latestCheckIn = goalHistory[goalHistory.length - 1]
                  const latestScore = latestCheckIn ? Number(latestCheckIn.computed_score) : 0
                  const latestStatus = latestCheckIn ? latestCheckIn.status : 'not_started'
                  
                  return (
                    <div 
                      key={goal.id} 
                      className={`checkin-card active-${latestStatus}`}
                      onClick={() => openGoalDrawer(goal)}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                          <span className={`badge badge-${latestStatus === 'completed' ? 'approved' : latestStatus === 'on_track' ? 'rework' : 'draft'}`} style={{ fontSize: '0.7rem' }}>
                            {latestStatus.replace('_', ' ')}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 600 }}>
                            Weight: {goal.weightage}%
                          </span>
                        </div>
                        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.98rem', fontWeight: 700, color: '#111827', lineHeight: 1.4 }}>
                          {goal.title}
                        </h3>
                        <p style={{ margin: 0, fontSize: '0.82rem', color: '#6b7280', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {goal.description || 'No description provided.'}
                        </p>
                      </div>

                      <div style={{ marginTop: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#4b5563', fontWeight: 600, marginBottom: '0.25rem' }}>
                          <span>Subordinate Achievement</span>
                          <span style={{ color: '#4f46e5' }}>{latestScore.toFixed(0)}%</span>
                        </div>
                        <div className="progress-bar-bg">
                          <div className="progress-bar-fill" style={{ width: `${latestScore}%` }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                          <span>Target: {goal.uom_type === 'timeline' ? goal.target_date : goal.target}</span>
                          <span>Submissions: {goalHistory.length} logs</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1.5rem', marginTop: '2rem' }}>
            <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>
              Overall Manager Review & Feedback Notes
            </label>
            <textarea 
              className="user-input" 
              style={{ width: '100%', boxSizing: 'border-box', height: '100px', fontSize: '0.9rem' }}
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder="Provide general quarterly performance notes or cycle summary remarks..."
            />
          </div>
          
          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button className="btn-sm btn-ghost-sm" onClick={() => setSelectedEmployee(null)}>Cancel</button>
            <button className="btn-sm btn-success-sm" onClick={handleSaveAllFeedback} disabled={savingAll}>
              {savingAll ? 'Saving...' : 'Save Overall Feedback'}
            </button>
          </div>
        </div>
      ) : (
        <div className="user-table-wrap">
          <table className="user-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Feedback Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {team.length === 0 ? (
                <tr><td colSpan="3" className="user-empty">No direct reports found.</td></tr>
              ) : team.map(member => (
                <tr key={member.employeeId}>
                  <td style={{ fontWeight: 600 }}>{member.employeeName}</td>
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

      {/* Slide-over Goal Details & Check-in Evaluation Drawer */}
      <div className={`drawer-overlay ${isDrawerOpen ? 'open' : ''}`} onClick={closeGoalDrawer} />
      
      <div className={`drawer-body ${isDrawerOpen && selectedGoal ? 'open' : ''}`}>
        {selectedGoal && (
          <>
            <div className="drawer-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>
                  Evaluate Progress Logs
                </h3>
                <span className="badge badge-submitted" style={{ fontSize: '0.72rem', marginTop: '0.25rem' }}>
                  Weightage: {selectedGoal.weightage}%
                </span>
              </div>
              <button 
                onClick={closeGoalDrawer}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: '#9ca3af', fontWeight: 'bold' }}
              >
                ✕
              </button>
            </div>

            <div className="drawer-content">
              <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid #f3f4f6', paddingBottom: '1rem' }}>
                <h4 style={{ margin: '0 0 0.35rem 0', color: '#1f2937', fontSize: '0.95rem' }}>{selectedGoal.title}</h4>
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.4 }}>
                  {selectedGoal.description || 'No description provided.'}
                </p>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.82rem', background: '#f9fafb', padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
                  <div><strong>UOM:</strong> {selectedGoal.uom_type.replace('_', ' ')}</div>
                  <div><strong>Target:</strong> {selectedGoal.uom_type === 'timeline' ? selectedGoal.target_date : selectedGoal.target}</div>
                </div>
              </div>

              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.88rem', color: '#374151' }}>
                📋 Employee Submission Records
              </h4>

              {historyCheckins.filter(h => h.goal_id === selectedGoal.id).length === 0 ? (
                <div className="user-empty" style={{ padding: '2.5rem 1rem', background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
                  No progress updates logged by employee yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {historyCheckins
                    .filter(h => h.goal_id === selectedGoal.id)
                    .map((h, idx) => (
                      <div key={h.id} style={{
                        padding: '1rem',
                        background: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: '0.82rem', color: '#1f2937' }}>
                            {h.check_in_windows?.quarter || 'Check-in'} (Log #{historyCheckins.filter(x => x.goal_id === selectedGoal.id).length - idx})
                          </strong>
                          <span className={`badge badge-${h.status === 'completed' ? 'approved' : h.status === 'on_track' ? 'rework' : 'draft'}`} style={{ fontSize: '0.65rem' }}>
                            {h.status.replace('_', ' ')}
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: 'white', padding: '0.5rem', borderRadius: '6px', border: '1px solid #f3f4f6' }}>
                          <div>
                            <span style={{ fontSize: '0.62rem', color: '#9ca3af', fontWeight: 600 }}>ACTUAL</span>
                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>
                              {selectedGoal.uom_type === 'timeline' ? h.actual_date : h.actual_achievement}
                            </div>
                          </div>
                          <div>
                            <span style={{ fontSize: '0.62rem', color: '#9ca3af', fontWeight: 600 }}>SCORE</span>
                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#4f46e5' }}>
                              {h.computed_score !== null ? `${Number(h.computed_score).toFixed(0)}%` : '—'}
                            </div>
                          </div>
                        </div>

                        <div style={{ marginTop: '0.25rem' }}>
                          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                            💬 Manager Feedback Comment
                          </label>
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <input
                              type="text"
                              className="user-input"
                              placeholder="Add feedback for this check-in..."
                              style={{ flex: 1, fontSize: '0.8rem', padding: '0.3rem 0.5rem' }}
                              defaultValue={h.manager_comment || ''}
                              id={`hist-comm-${h.id}`}
                            />
                            <button
                              className="btn-sm btn-primary-sm"
                              style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                              onClick={() => {
                                const val = document.getElementById(`hist-comm-${h.id}`).value
                                handleSaveHistoricalComment(h.id, val)
                              }}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
