import { useState, useEffect } from 'react'
import { getMyGoalSheet, saveCheckIn, logEvent } from '../../lib/userApi'
import { useApp } from '../../lib/AppContext'
import { calculateProgressScore } from '../../lib/scoreUtils'
import { supabase } from '../../lib/supabase'

export default function MyCheckins() {
  const { activeCycle: cycle, activeWindow: window, settings, loading: contextLoading } = useApp()
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

  const [selectedGoal, setSelectedGoal] = useState(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Calculate cycle-wide average completion score
  const totalCompletedScore = goals.reduce((sum, g) => {
    const hist = historyCheckins.filter(h => h.goal_id === g.id)
    const latest = hist[hist.length - 1]
    return sum + (latest ? Number(latest.computed_score) : 0)
  }, 0)
  const avgCompletionScore = goals.length > 0 ? (totalCompletedScore / goals.length) : 0

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
  if (goals.length === 0) return <div className="user-empty">You have no goals to track.</div>

  const activeInput = selectedGoal ? (checkins[selectedGoal.id] || { actual_achievement: '', actual_date: '', status: 'not_started' }) : {}

  return (
    <div>
      <style>{`
        .checkin-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
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
          width: 450px;
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

      <div className="user-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="user-page-title">My Check-ins</h1>
          <p className="user-page-subtitle">{window ? `${window.quarter} Window (Closes ${window.window_close})` : 'No active check-in window at this time'}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
          <span className="badge badge-submitted" style={{ fontSize: '0.88rem', padding: '0.4rem 0.8rem', fontWeight: 700 }}>
            Overall Completion: {avgCompletionScore.toFixed(0)}%
          </span>
          <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Based on approved goals</span>
        </div>
      </div>

      {/* Goal Cards Grid View */}
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
                  <span>Progress Achievement</span>
                  <span style={{ color: '#4f46e5' }}>{latestScore.toFixed(0)}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width: `${latestScore}%` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                  <span>Target: {goal.uom_type === 'timeline' ? goal.target_date : goal.target}</span>
                  <span>Latest: {latestCheckIn ? (goal.uom_type === 'timeline' ? latestCheckIn.actual_date : latestCheckIn.actual_achievement) : '—'}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Slide-over Right Drawer Container */}
      <div className={`drawer-overlay ${isDrawerOpen ? 'open' : ''}`} onClick={closeGoalDrawer} />
      
      <div className={`drawer-body ${isDrawerOpen && selectedGoal ? 'open' : ''}`}>
        {selectedGoal && (
          <>
            <div className="drawer-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>
                  Goal Details & History
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

              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.88rem', color: '#374151', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                📜 Check-in Progression Logs
              </h4>

              {historyCheckins.filter(h => h.goal_id === selectedGoal.id).length === 0 ? (
                <div className="user-empty" style={{ padding: '2rem 1rem', background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
                  No progress updates submitted yet in this cycle.
                </div>
              ) : (
                <div className="timeline-container">
                  {historyCheckins
                    .filter(h => h.goal_id === selectedGoal.id)
                    .map((h, idx, arr) => (
                      <div key={h.id} className="timeline-node">
                        <div style={{
                          background: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          padding: '0.75rem',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <strong style={{ fontSize: '0.82rem', color: '#1f2937' }}>
                              {h.check_in_windows?.quarter || 'Milestone'} (Update #{arr.length - idx})
                            </strong>
                            <span className={`badge badge-${h.status === 'completed' ? 'approved' : h.status === 'on_track' ? 'rework' : 'draft'}`} style={{ fontSize: '0.62rem', padding: '0.1rem 0.35rem' }}>
                              {h.status.replace('_', ' ')}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#4b5563' }}>
                            Achievement: <strong>{selectedGoal.uom_type === 'timeline' ? h.actual_date : h.actual_achievement}</strong>
                            {h.computed_score !== null && ` (Score: ${Number(h.computed_score).toFixed(0)}%)`}
                          </div>
                          {h.manager_comment && (
                            <div style={{
                              marginTop: '0.5rem',
                              padding: '0.5rem',
                              background: 'white',
                              borderLeft: '2px solid #4f46e5',
                              fontSize: '0.78rem',
                              fontStyle: 'italic',
                              color: '#4f46e5',
                              borderRadius: '0 4px 4px 0'
                            }}>
                              💬 Manager: "{h.manager_comment}"
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {window ? (
              <div className="drawer-footer">
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.88rem', color: '#1f2937' }}>
                  ✏️ Log New Progress Update
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                      Actual Achievement Progress
                    </label>
                    {selectedGoal.uom_type === 'timeline' ? (
                      <input 
                        type="date" 
                        className="user-input"
                        style={{ width: '100%' }}
                        value={activeInput.actual_date || ''}
                        onChange={e => handleChange(selectedGoal.id, 'actual_date', e.target.value)}
                      />
                    ) : (
                      <input 
                        type="number" 
                        className="user-input"
                        style={{ width: '100%' }}
                        placeholder="Enter latest achievement..."
                        value={activeInput.actual_achievement || ''}
                        onChange={e => handleChange(selectedGoal.id, 'actual_achievement', e.target.value)}
                      />
                    )}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', marginBottom: '0.25rem' }}>
                      Status Category
                    </label>
                    <select 
                      className="user-select"
                      style={{ width: '100%' }}
                      value={activeInput.status || 'not_started'}
                      onChange={e => handleChange(selectedGoal.id, 'status', e.target.value)}
                    >
                      <option value="not_started">Not Started</option>
                      <option value="on_track">On Track</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>

                  <button 
                    className="btn btn-primary" 
                    style={{ width: '100%', marginTop: '0.25rem', padding: '0.6rem' }}
                    onClick={async () => {
                      await handleSave(selectedGoal.id)
                      // Reset input for fresh additions
                      setCheckins(prev => ({
                        ...prev,
                        [selectedGoal.id]: {
                          actual_achievement: '',
                          actual_date: '',
                          status: 'not_started'
                        }
                      }))
                      // Brief delay to reload and close
                      setTimeout(() => {
                        closeGoalDrawer()
                      }, 500)
                    }}
                  >
                    Save Progress Update
                  </button>
                </div>
              </div>
            ) : (
              <div className="drawer-footer" style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.82rem', padding: '1rem' }}>
                🔒 Progress updates are locked. No active check-in window is currently open.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
