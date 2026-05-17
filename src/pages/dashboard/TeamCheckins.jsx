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

  async function handleSaveAllFeedback() {
    setSavingAll(true)
    try {
      // 1. Save all individual goal comments
      const promises = goals.map(async goal => {
        const comment = goalComments[goal.id] || ''
        const checkin = checkins[goal.id]
        
        if (checkin) {
          await supabase
            .from('check_ins')
            .update({ manager_comment: comment })
            .eq('id', checkin.id)
        } else {
          await supabase
            .from('check_ins')
            .insert({
              goal_id: goal.id,
              window_id: window.id,
              status: 'not_started',
              manager_comment: comment
            })
        }
      })
      
      await Promise.all(promises)
      
      // 2. Save/upsert overall global review note
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
      
      alert('All goal feedback and overall review notes saved successfully!')
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
            <div className="user-table-wrap" style={{ marginBottom: '2rem' }}>
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Goal Details</th>
                    <th>Target</th>
                    <th>Actual Achievement</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th style={{ width: '250px' }}>Manager Feedback Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {goals.map(goal => {
                    const c = checkins[goal.id] || {}
                    return (
                      <tr key={goal.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{goal.title}</div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Weight: {goal.weightage}%</div>
                        </td>
                        <td>{goal.uom_type === 'timeline' ? goal.target_date : goal.target}</td>
                        <td style={{ fontWeight: 500, color: '#111827' }}>
                          {goal.uom_type === 'timeline' ? (c.actual_date || '-') : (c.actual_achievement ?? '-')}
                        </td>
                        <td>
                          <span className={`badge badge-${c.status === 'completed' ? 'approved' : c.status === 'on_track' ? 'rework' : 'draft'}`}>
                            {c.status || 'Not Started'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {c.computed_score !== undefined && c.computed_score !== null ? `${Number(c.computed_score).toFixed(0)}%` : '-'}
                        </td>
                        <td>
                          <textarea
                            className="user-input"
                            style={{ width: '100%', minHeight: '60px', fontSize: '0.82rem', padding: '0.4rem' }}
                            value={goalComments[goal.id] || ''}
                            onChange={e => handleGoalCommentChange(goal.id, e.target.value)}
                            placeholder="Add specific comments..."
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
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
