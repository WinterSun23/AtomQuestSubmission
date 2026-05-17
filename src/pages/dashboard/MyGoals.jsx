import { useState, useEffect } from 'react'
import { getActiveCycle, getMyGoalSheet, createGoalSheet, saveGoals, submitGoalSheet, getThrustAreas, isGoalSubmissionWindowOpen, logEvent } from '../../lib/userApi'

const UOM_OPTIONS = [
  { value: 'numeric_min', label: 'Numeric (Min)' },
  { value: 'numeric_max', label: 'Numeric (Max)' },
  { value: 'percent_min', label: 'Percentage (Min)' },
  { value: 'percent_max', label: 'Percentage (Max)' },
  { value: 'timeline',    label: 'Timeline' },
  { value: 'zero_based',  label: 'Zero-based' }
]

export default function MyGoals() {
  const [cycle, setCycle] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [thrustAreas, setThrustAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [windowOpen, setWindowOpen] = useState(true)

  // Form state
  const [goals, setGoals] = useState([])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const activeCycle = await getActiveCycle()
      setCycle(activeCycle)
      const areas = await getThrustAreas()
      setThrustAreas(areas)
      
      const isOpen = await isGoalSubmissionWindowOpen()
      setWindowOpen(isOpen)

      if (activeCycle) {
        const mySheet = await getMyGoalSheet(activeCycle.id)
        if (mySheet) {
          setSheet(mySheet)
          setGoals(mySheet.goals || [])
        }
      }
    } catch (err) {
      console.error(err)
      setError(err.message)
    }
    setLoading(false)
  }

  async function handleCreateSheet() {
    if (!cycle) return
    try {
      const newSheet = await createGoalSheet(cycle.id)
      setSheet(newSheet)
      setGoals([])
    } catch (err) {
      alert('Error creating sheet: ' + err.message)
    }
  }

  function addGoal() {
    if (goals.length >= 8) return alert('Maximum 8 goals allowed')
    setGoals([...goals, {
      id: null,
      thrust_area_id: thrustAreas[0]?.id || null,
      title: '',
      description: '',
      uom_type: 'numeric_min',
      target: '',
      target_date: '',
      weightage: 10,
      is_shared: false
    }])
  }

  function removeGoal(index) {
    const goalToRemove = goals[index]
    if (goalToRemove.is_shared) return alert('Cannot remove shared goals')
    setGoals(goals.filter((_, i) => i !== index))
  }

  function updateGoal(index, field, value) {
    const newGoals = [...goals]
    newGoals[index][field] = value
    setGoals(newGoals)
  }

  async function handleSaveDraft() {
    try {
      await saveGoals(sheet.id, goals)
      alert('Draft saved successfully')
      loadData()
    } catch (err) {
      alert('Error saving draft: ' + err.message)
    }
  }

  async function handleSubmit() {
    if (!windowOpen) {
      return alert('Goal submission window is currently closed. You cannot submit this goal sheet.')
    }
    
    const totalWeight = goals.reduce((sum, g) => sum + Number(g.weightage), 0)
    if (totalWeight !== 100) return alert(`Total weightage must be exactly 100%. Current is ${totalWeight}%`)
    
    const invalidGoal = goals.find(g => Number(g.weightage) < 10)
    if (invalidGoal) return alert('Each goal must have at least 10% weightage')

    const incompleteGoal = goals.find(g => !g.title || !g.target)
    if (incompleteGoal) return alert('Please fill in title and target for all goals')

    try {
      await saveGoals(sheet.id, goals)
      await submitGoalSheet(sheet.id)
      await logEvent({
        action: 'SUBMIT_GOAL_SHEET',
        goalSheetId: sheet.id,
        description: `Employee has submitted their goal sheet for review`
      })
      alert('Goal sheet submitted for approval')
      loadData()
    } catch (err) {
      alert('Error submitting sheet: ' + err.message)
    }
  }

  if (loading) return <div className="user-empty">Loading...</div>
  if (!cycle) return <div className="user-empty">No active performance cycle found.</div>

  const isEditable = sheet && (sheet.status === 'draft' || sheet.status === 'returned')
  const totalWeight = goals.reduce((sum, g) => sum + Number(g.weightage || 0), 0)

  return (
    <div>
      <div className="user-page-header">
        <h1 className="user-page-title">My Goals</h1>
        <p className="user-page-subtitle">Cycle: {cycle.name}</p>
      </div>

      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}

      {!windowOpen && (
        <div style={{ background: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#991b1b', padding: '1rem', borderRadius: '6px', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          <strong>Notice:</strong> The Goal Setting submission window is currently closed. You can create new goal sheets, add goals, and save drafts, but you will not be able to submit them for manager approval.
        </div>
      )}

      {!sheet ? (
        <div className="user-card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h3>No Goal Sheet yet</h3>
          <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>You haven't created a goal sheet for {cycle.name}</p>
          <button className="btn-sm btn-primary-sm" onClick={handleCreateSheet}>
            Create Goal Sheet
          </button>
        </div>
      ) : (
        <div className="user-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 className="user-card-title" style={{ margin: 0 }}>Goal Sheet Status: <span className={`badge badge-${sheet.status}`}>{sheet.status.replace('_', ' ')}</span></h2>
            {isEditable && (
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: totalWeight === 100 ? '#15803d' : '#b91c1c' }}>
                Total Weightage: {totalWeight}% / 100%
              </div>
            )}
          </div>

          {sheet.status === 'returned' && sheet.rework_note && (
            <div style={{ background: '#fffbeb', color: '#b45309', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
              <strong>Manager Rework Note:</strong> {sheet.rework_note}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {goals.length === 0 && <div className="user-empty">No goals added yet.</div>}
            
            {goals.map((goal, i) => (
              <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem', background: goal.is_shared ? '#f8fafc' : '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0 }}>Goal {i + 1} {goal.is_shared && <span className="badge badge-draft" style={{ marginLeft: '10px' }}>Shared by Manager</span>}</h4>
                  {isEditable && !goal.is_shared && (
                    <button className="btn-sm btn-danger-sm" onClick={() => removeGoal(i)}>Remove</button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Title</label>
                    <input 
                      type="text" 
                      className="user-input" 
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      value={goal.title} 
                      onChange={e => updateGoal(i, 'title', e.target.value)}
                      disabled={!isEditable || goal.is_shared}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Thrust Area</label>
                    <select 
                      className="user-select" 
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      value={goal.thrust_area_id || ''}
                      onChange={e => updateGoal(i, 'thrust_area_id', e.target.value)}
                      disabled={!isEditable || goal.is_shared}
                    >
                      {thrustAreas.map(ta => <option key={ta.id} value={ta.id}>{ta.name}</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Description (Optional)</label>
                    <textarea 
                      className="user-input" 
                      style={{ width: '100%', boxSizing: 'border-box', height: '60px' }}
                      value={goal.description || ''} 
                      onChange={e => updateGoal(i, 'description', e.target.value)}
                      disabled={!isEditable || goal.is_shared}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>UoM Type</label>
                    <select 
                      className="user-select" 
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      value={goal.uom_type}
                      onChange={e => updateGoal(i, 'uom_type', e.target.value)}
                      disabled={!isEditable || goal.is_shared}
                    >
                      {UOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  
                  {goal.uom_type === 'timeline' ? (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Target Date</label>
                      <input 
                        type="date" 
                        className="user-input" 
                        style={{ width: '100%', boxSizing: 'border-box' }}
                        value={goal.target_date || ''} 
                        onChange={e => updateGoal(i, 'target_date', e.target.value)}
                        disabled={!isEditable || goal.is_shared}
                      />
                    </div>
                  ) : (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Target Value</label>
                      <input 
                        type="number" 
                        className="user-input" 
                        style={{ width: '100%', boxSizing: 'border-box' }}
                        value={goal.target || ''} 
                        onChange={e => updateGoal(i, 'target', e.target.value)}
                        disabled={!isEditable || goal.is_shared}
                      />
                    </div>
                  )}
                  
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Weightage (%)</label>
                    <input 
                      type="number" 
                      className="user-input" 
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      value={goal.weightage} 
                      onChange={e => updateGoal(i, 'weightage', e.target.value)}
                      disabled={!isEditable} // Editable even for shared goals
                      min="10" max="100"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {isEditable && (
            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'space-between' }}>
              <button className="btn-sm btn-ghost-sm" onClick={addGoal}>+ Add Goal</button>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="btn-sm btn-ghost-sm" onClick={handleSaveDraft}>Save Draft</button>
                {windowOpen ? (
                  <button className="btn-sm btn-primary-sm" onClick={handleSubmit}>Submit for Approval</button>
                ) : (
                  <span style={{ fontSize: '0.85rem', color: '#b91c1c', alignSelf: 'center', fontWeight: 500 }}>Submission Closed</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
