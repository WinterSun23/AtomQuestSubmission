import { useState, useEffect } from 'react'
import { getMyGoalSheet, createGoalSheet, saveGoals, submitGoalSheet, getThrustAreas, logEvent } from '../../lib/userApi'
import { useApp } from '../../lib/AppContext'

const UOM_OPTIONS = [
  { value: 'numeric_min', label: 'Numeric (Min)' },
  { value: 'numeric_max', label: 'Numeric (Max)' },
  { value: 'percent_min', label: 'Percentage (Min)' },
  { value: 'percent_max', label: 'Percentage (Max)' },
  { value: 'timeline',    label: 'Timeline' },
  { value: 'zero_based',  label: 'Zero-based' }
]

export default function MyGoals() {
  const { activeCycle: cycle, isGoalSubmissionWindowOpen, maxGoalsPerSheet, minGoalWeightage, settings, loading: contextLoading } = useApp()
  const sharedGoalsMode = settings?.shared_goals_mode || 'unified'
  const [sheet, setSheet] = useState(null)
  const [thrustAreas, setThrustAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [goals, setGoals] = useState([])

  const windowOpen = isGoalSubmissionWindowOpen ? isGoalSubmissionWindowOpen() : false

  async function loadData() {
    if (contextLoading || !cycle) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const areas = await getThrustAreas()
      setThrustAreas(areas)

      const mySheet = await getMyGoalSheet(cycle.id)
      if (mySheet) {
        setSheet(mySheet)
        setGoals(mySheet.goals || [])
      }
    } catch (err) {
      console.error(err)
      setError(err.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [contextLoading, cycle])

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
    const personalGoalsCount = goals.filter(g => !g.is_shared).length
    if (personalGoalsCount >= maxGoalsPerSheet) {
      return alert(`Maximum ${maxGoalsPerSheet} personal goals allowed`)
    }
    setGoals([...goals, {
      id: null,
      thrust_area_id: thrustAreas[0]?.id || null,
      title: '',
      description: '',
      uom_type: 'numeric_min',
      target: '',
      target_date: '',
      weightage: minGoalWeightage,
      is_shared: false
    }])
  }

  function removeGoalByObject(goalObj) {
    if (goalObj.is_shared) return alert('Cannot remove shared goals')
    setGoals(goals.filter(g => g !== goalObj))
  }

  function updateGoalByObject(goalObj, field, value) {
    const absoluteIndex = goals.indexOf(goalObj)
    if (absoluteIndex === -1) return
    const newGoals = [...goals]
    newGoals[absoluteIndex] = { ...newGoals[absoluteIndex], [field]: value }
    setGoals(newGoals)
  }

  function adjustWeightages(changedGoal, newWeightVal) {
    let newWeight = Math.max(0, Math.min(100, Number(newWeightVal) || 0))
    
    const absoluteIndex = goals.indexOf(changedGoal)
    if (absoluteIndex === -1) return

    const newGoals = goals.map(g => ({ ...g }))
    newGoals[absoluteIndex].weightage = newWeight

    // Determine if the changed goal is part of the 100% validation pool
    const isValidationGoal = sharedGoalsMode === 'special' ? !changedGoal.is_shared : true

    // If not in the validation pool (e.g. editing a shared goal in special mode), just set and exit
    if (!isValidationGoal) {
      setGoals(newGoals)
      return
    }

    // Find other goals that are in the validation pool to borrow/lend from
    const otherValidationGoals = newGoals.filter((g, idx) => {
      if (idx === absoluteIndex) return false
      return sharedGoalsMode === 'special' ? !g.is_shared : true
    })

    if (otherValidationGoals.length === 0) {
      newGoals[absoluteIndex].weightage = 100
      setGoals(newGoals)
      return
    }

    // Solve and enforce min weight constraint!
    const N = otherValidationGoals.length + 1 // Total validation goals
    const maxAllowed = 100 - (N - 1) * minGoalWeightage
    newWeight = Math.max(minGoalWeightage, Math.min(newWeight, maxAllowed))

    newGoals[absoluteIndex].weightage = newWeight

    const targetOtherSum = 100 - newWeight
    const currentOtherSum = otherValidationGoals.reduce((sum, g) => sum + (Number(g.weightage) || 0), 0)

    let delta = targetOtherSum - currentOtherSum
    let loops = 0

    while (delta !== 0 && loops < 1000) {
      loops++
      if (delta > 0) {
        // Need to add weightage: increment any other goal
        const targetGoal = otherValidationGoals[0]
        if (targetGoal) {
          targetGoal.weightage = (Number(targetGoal.weightage) || 0) + 1
          delta -= 1
        } else {
          break
        }
      } else {
        // Need to subtract weightage: decrement any goal that is currently above minGoalWeightage
        const targetGoal = otherValidationGoals.find(g => (Number(g.weightage) || 0) > minGoalWeightage) || otherValidationGoals[0]
        if (targetGoal) {
          targetGoal.weightage = (Number(targetGoal.weightage) || 0) - 1
          delta += 1
        } else {
          break
        }
      }
    }

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
    
    if (!isSheetValid) {
      return alert('Please satisfy all validation criteria before submitting.')
    }

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

  const isEditable = sheet && (sheet.status === 'draft' || sheet.status === 'returned')
  const hasUnlockedGoals = goals.some(g => g.is_locked === false)
  const canEmployeeEdit = isEditable || hasUnlockedGoals
  
  const personalGoals = goals.filter(g => !g.is_shared)
  const sharedGoals = goals.filter(g => g.is_shared)

  // Calculate total weight and perform validation based on sharedGoalsMode
  const goalsToValidate = sharedGoalsMode === 'special' ? goals.filter(g => !g.is_shared) : goals
  const totalWeight = goalsToValidate.reduce((sum, g) => sum + Number(g.weightage || 0), 0)

  // Validation evaluations
  const anyUnderMin = goalsToValidate.some(g => Number(g.weightage || 0) < minGoalWeightage)
  const exceedsCount = goalsToValidate.length > maxGoalsPerSheet
  const zeroGoals = goalsToValidate.length === 0
  const hasEmptyFields = goals.some(g => !g.title || (g.uom_type === 'timeline' ? !g.target_date : !g.target))
  const isSheetValid = totalWeight === 100 && !anyUnderMin && !exceedsCount && !zeroGoals && !hasEmptyFields

  function ValidationBanner() {
    if (!canEmployeeEdit) return null

    return (
      <div style={{
        padding: '1.25rem',
        borderRadius: '10px',
        marginBottom: '1.5rem',
        background: isSheetValid ? '#f0fdf4' : '#fffbeb',
        border: `1.5px solid ${isSheetValid ? '#bbf7d0' : '#fef08a'}`,
        color: isSheetValid ? '#166534' : '#854d0e',
        fontSize: '0.88rem'
      }}>
        <h4 style={{ margin: '0 0 0.5rem 0', fontWeight: 700, fontSize: '0.95rem' }}>
          {isSheetValid ? '✅ Validation Criteria Met' : '⚠️ Validation Rules Checklist'}
          {sharedGoalsMode === 'special' && <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#4f46e5', marginLeft: '0.5rem' }}>(Special Directive Mode Active)</span>}
        </h4>
        <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <li style={{ color: totalWeight === 100 ? '#15803d' : '#b91c1c', fontWeight: totalWeight === 100 ? 600 : 400 }}>
            Total Weightage must be exactly 100%. (Current: {totalWeight}%) {sharedGoalsMode === 'special' && <strong style={{ color: '#4f46e5' }}>(Excludes Shared Goals)</strong>}
          </li>
          <li style={{ color: !anyUnderMin ? '#15803d' : '#b91c1c', fontWeight: !anyUnderMin ? 600 : 400 }}>
            Each goal must occupy at least {minGoalWeightage}% weightage. {sharedGoalsMode === 'special' && <strong style={{ color: '#4f46e5' }}>(Excludes Shared Goals)</strong>}
          </li>
          <li style={{ color: !exceedsCount ? '#15803d' : '#b91c1c', fontWeight: !exceedsCount ? 600 : 400 }}>
            Maximum allowed goals is {maxGoalsPerSheet}. (Current count: {goalsToValidate.length}) {sharedGoalsMode === 'special' && <strong style={{ color: '#4f46e5' }}>(Excludes Shared Goals)</strong>}
          </li>
          <li style={{ color: !hasEmptyFields ? '#15803d' : '#b91c1c', fontWeight: !hasEmptyFields ? 600 : 400 }}>
            All goals must have a Title and a Target.
          </li>
        </ul>
      </div>
    )
  }

  const isLoading = contextLoading || loading

  if (isLoading) return <div className="user-empty">Loading...</div>
  if (!cycle) return <div className="user-empty">No active performance cycle found.</div>

  return (
    <div>
      <style>{`
        .checkin-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
          margin-top: 1rem;
        }
        .checkin-card {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 12px;
          padding: 1.5rem;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: none;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 200px;
        }
        .checkin-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
          border-color: #58a6ff;
        }
        .checkin-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 4px;
          height: 100%;
          background: #30363d;
          transition: background 0.3s ease;
        }
        .checkin-card.active-completed::before { background: #3fb950; }
        .checkin-card.active-on_track::before { background: #58a6ff; }
        .checkin-card.active-draft::before { background: #8b949e; }
        .checkin-card.active-rework::before { background: #d29922; }
      `}</style>
      <div className="user-page-header">
        <h1 className="user-page-title">My Goals</h1>
        <p className="user-page-subtitle">Cycle: {cycle.name}</p>
      </div>

      {error && <div style={{ color: '#f85149', marginBottom: '1rem' }}>{error}</div>}

      {!windowOpen && (
        <div style={{ background: 'rgba(248,81,73,0.15)', borderLeft: '4px solid #f85149', color: '#f85149', padding: '1rem', borderRadius: '6px', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          <strong>Notice:</strong> The Goal Setting submission window is currently closed. You can create new goal sheets, add goals, and save drafts, but you will not be able to submit them for manager approval.
        </div>
      )}

      {!sheet ? (
        <div className="user-card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h3 style={{ color: '#f0f6fc', marginBottom: '0.5rem' }}>No Goal Sheet yet</h3>
          <p style={{ color: '#8b949e', marginBottom: '1.5rem' }}>You haven't created a goal sheet for {cycle.name}</p>
          <button className="btn-sm btn-primary-sm" onClick={handleCreateSheet}>
            Create Goal Sheet
          </button>
        </div>
      ) : (
        <div className="user-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 className="user-card-title" style={{ margin: 0, color: '#f0f6fc' }}>Goal Sheet Status: <span className={`badge badge-${sheet.status}`}>{sheet.status.replace('_', ' ')}</span></h2>
            {canEmployeeEdit && (
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: totalWeight === 100 ? '#3fb950' : '#f85149' }}>
                Total Weightage: {totalWeight}% / 100%
              </div>
            )}
          </div>

          {sheet.status === 'returned' && sheet.rework_note && (
            <div style={{ background: 'rgba(210,153,34,0.15)', color: '#d29922', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid rgba(210,153,34,0.3)' }}>
              <strong>Manager Rework Note:</strong> {sheet.rework_note}
            </div>
          )}

          <ValidationBanner />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* ── Personal Goals Section ── */}
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: '#f0f6fc', marginBottom: '1rem', marginTop: 0 }}>Personal Goals</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
                {personalGoals.map((goal, i) => {
                  const isLocked = !canEmployeeEdit || goal.is_locked || !isEditable;

                  if (isLocked) {
                    return (
                      <div 
                        key={`personal-${i}`} 
                        className="checkin-card active-on_track" 
                        style={{ cursor: 'default', minHeight: 'auto' }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                            <span style={{ fontSize: '0.72rem', color: '#58a6ff', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              👤 Personal Goal #{i + 1} {goal.is_locked && '(Locked)'}
                            </span>
                          </div>
                          
                          <h4 style={{ fontSize: '0.98rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#f0f6fc' }}>
                            {goal.title}
                          </h4>
                          <p style={{ fontSize: '0.78rem', color: '#8b949e', margin: '0 0 0.75rem 0', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>
                            {goal.description || 'No description provided.'}
                          </p>
                        </div>
                        
                        <div style={{ borderTop: '1px solid #30363d', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#c9d1d9', marginBottom: '0.5rem' }}>
                            <span>Target: <strong>{goal.target_date || goal.target || '-'}</strong></span>
                            <span>Weightage: <strong>{goal.weightage}%</strong></span>
                          </div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', color: '#8b949e', background: '#0d1117', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #30363d' }}>
                            <div>📌 <strong>Thrust Area:</strong> {thrustAreas.find(ta => ta.id === goal.thrust_area_id)?.name || 'Thrust Area'}</div>
                            <div>📊 <strong>UoM Type:</strong> {goal.uom_type.replace('_', ' ')}</div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={`personal-${i}`} className="checkin-card active-on_track" style={{ cursor: 'default', minHeight: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                          <h4 style={{ margin: 0, color: '#f0f6fc', fontSize: '0.98rem', fontWeight: 700 }}>Goal #{i + 1}</h4>
                          <button className="btn-sm btn-danger-sm" onClick={() => removeGoalByObject(goal)}>Remove</button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Title</label>
                            <input 
                              type="text" 
                              className="user-input" 
                              style={{ width: '100%', boxSizing: 'border-box' }}
                              value={goal.title} 
                              onChange={e => updateGoalByObject(goal, 'title', e.target.value)}
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Thrust Area</label>
                            <select 
                              className="user-select" 
                              style={{ width: '100%', boxSizing: 'border-box' }}
                              value={goal.thrust_area_id || ''}
                              onChange={e => updateGoalByObject(goal, 'thrust_area_id', e.target.value)}
                            >
                              {thrustAreas.map(ta => <option key={ta.id} value={ta.id}>{ta.name}</option>)}
                            </select>
                          </div>
                          <div style={{ gridColumn: '1 / -1' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Description (Optional)</label>
                            <textarea 
                              className="user-input" 
                              style={{ width: '100%', boxSizing: 'border-box', height: '60px' }}
                              value={goal.description || ''} 
                              onChange={e => updateGoalByObject(goal, 'description', e.target.value)}
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>UoM Type</label>
                            <select 
                              className="user-select" 
                              style={{ width: '100%', boxSizing: 'border-box' }}
                              value={goal.uom_type}
                              onChange={e => updateGoalByObject(goal, 'uom_type', e.target.value)}
                            >
                              {UOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          
                          {goal.uom_type === 'timeline' ? (
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Target Date</label>
                              <input 
                                type="date" 
                                className="user-input" 
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                value={goal.target_date || ''} 
                                onChange={e => updateGoalByObject(goal, 'target_date', e.target.value)}
                              />
                            </div>
                          ) : (
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Target Value</label>
                              <input 
                                type="number" 
                                className="user-input" 
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                value={goal.target || ''} 
                                onChange={e => updateGoalByObject(goal, 'target', e.target.value)}
                              />
                            </div>
                          )}
                          
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Weightage (%)</label>
                            <input 
                              type="number" 
                              className="user-input" 
                              style={{ width: '100%', boxSizing: 'border-box' }}
                              defaultValue={goal.weightage}
                              key={`personal-weight-${goal.id || i}-${goal.weightage}`}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  adjustWeightages(goal, e.target.value)
                                  e.target.blur()
                                }
                              }}
                              onBlur={e => {
                                adjustWeightages(goal, e.target.value)
                              }}
                              min={minGoalWeightage} max="100"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {canEmployeeEdit && isEditable && goals.length < maxGoalsPerSheet && (
                  <div 
                    onClick={addGoal}
                    style={{
                      border: '2px dashed #30363d',
                      borderRadius: '8px',
                      padding: '1.5rem',
                      background: '#161b22',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      minHeight: '280px',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = '#58a6ff'
                      e.currentTarget.style.background = '#21262d'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = '#30363d'
                      e.currentTarget.style.background = '#161b22'
                    }}
                  >
                    <span style={{ fontSize: '2.5rem', color: '#8b949e', marginBottom: '0.5rem' }}>+</span>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#c9d1d9' }}>Add Personal Goal</span>
                    <span style={{ fontSize: '0.75rem', color: '#8b949e', marginTop: '0.25rem' }}>
                      ({goals.length} of {maxGoalsPerSheet} goals)
                    </span>
                  </div>
                )}

                {(!canEmployeeEdit || !isEditable || goals.length >= maxGoalsPerSheet) && personalGoals.length === 0 && (
                  <div className="user-empty" style={{ padding: '2rem', gridColumn: '1 / -1' }}>No personal goals added yet.</div>
                )}
              </div>
            </div>

            {/* ── Shared Goals Section ── */}
            {sharedGoals.length > 0 && (
              <div style={{ marginTop: '2rem', borderTop: '2px dashed #30363d', paddingTop: '2rem' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: '#58a6ff', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}>
                  <span>🎯</span> Shared Goals from Manager
                </h3>
                <p style={{ fontSize: '0.82rem', color: '#8b949e', marginBottom: '1.25rem' }}>
                  These organization or team-level shared goals are configured by your manager. They do not count toward your personal goal limits.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
                  {sharedGoals.map((goal, i) => {
                    const isLocked = !canEmployeeEdit || goal.is_locked;

                    if (isLocked) {
                      return (
                        <div 
                          key={`shared-${i}`} 
                          className="checkin-card active-completed" 
                          style={{ cursor: 'default', minHeight: 'auto' }}
                        >
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                              <span style={{ fontSize: '0.72rem', color: '#3fb950', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                👥 Shared Goal #{i + 1}
                              </span>
                            </div>
                            
                            <h4 style={{ fontSize: '0.98rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#f0f6fc' }}>
                              {goal.title}
                            </h4>
                            <p style={{ fontSize: '0.78rem', color: '#8b949e', margin: '0 0 0.75rem 0', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>
                              {goal.description || 'No description provided.'}
                            </p>
                          </div>
                          
                          <div style={{ borderTop: '1px solid #30363d', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#c9d1d9', marginBottom: '0.5rem' }}>
                              <span>Target: <strong>{goal.target_date || goal.target || '-'}</strong></span>
                              <span>Weightage: <strong>{goal.weightage}%</strong></span>
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', color: '#8b949e', background: '#0d1117', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #30363d' }}>
                              <div>📌 <strong>Thrust Area:</strong> {thrustAreas.find(ta => ta.id === goal.thrust_area_id)?.name || 'Thrust Area'}</div>
                              <div>📊 <strong>UoM Type:</strong> {goal.uom_type.replace('_', ' ')}</div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={`shared-${i}`} className="checkin-card active-completed" style={{ cursor: 'default', minHeight: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <h4 style={{ margin: 0, color: '#f0f6fc', fontSize: '0.98rem', fontWeight: 700 }}>Shared Goal Details</h4>
                            <span className="badge badge-draft">Shared</span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Title</label>
                              <input 
                                type="text" 
                                className="user-input" 
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                value={goal.title} 
                                disabled
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Thrust Area</label>
                              <select 
                                className="user-select" 
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                value={goal.thrust_area_id || ''}
                                disabled
                              >
                                {thrustAreas.map(ta => <option key={ta.id} value={ta.id}>{ta.name}</option>)}
                              </select>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Description (Optional)</label>
                              <textarea 
                                className="user-input" 
                                style={{ width: '100%', boxSizing: 'border-box', height: '60px' }}
                                value={goal.description || ''} 
                                disabled
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>UoM Type</label>
                              <select 
                                className="user-select" 
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                value={goal.uom_type}
                                disabled
                              >
                                {UOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                            
                            {goal.uom_type === 'timeline' ? (
                              <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Target Date</label>
                                <input 
                                  type="date" 
                                  className="user-input" 
                                  style={{ width: '100%', boxSizing: 'border-box' }}
                                  value={goal.target_date || ''} 
                                  disabled
                                />
                              </div>
                            ) : (
                              <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Target Value</label>
                                <input 
                                  type="number" 
                                  className="user-input" 
                                  style={{ width: '100%', boxSizing: 'border-box' }}
                                  value={goal.target || ''} 
                                  disabled
                                />
                              </div>
                            )}
                             <div>
                              <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#8b949e' }}>Weightage (%)</label>
                              <input 
                                type="number" 
                                className="user-input" 
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                defaultValue={goal.weightage}
                                key={`shared-weight-${goal.id || i}-${goal.weightage}`}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    adjustWeightages(goal, e.target.value)
                                    e.target.blur()
                                  }
                                }}
                                onBlur={e => {
                                  adjustWeightages(goal, e.target.value)
                                }}
                                min={minGoalWeightage} max="100"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {canEmployeeEdit && (
            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'space-between' }}>
              {isEditable ? (
                <button className="btn-sm btn-ghost-sm" onClick={addGoal} disabled={goals.length >= maxGoalsPerSheet}>+ Add Goal</button>
              ) : (
                <div />
              )}
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="btn-sm btn-ghost-sm" onClick={handleSaveDraft}>Save Draft</button>
                {windowOpen ? (
                  <button 
                    className="btn-sm btn-primary-sm" 
                    onClick={handleSubmit} 
                    disabled={!isSheetValid}
                    style={{
                      opacity: isSheetValid ? 1 : 0.5,
                      cursor: isSheetValid ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Submit for Approval
                  </button>
                ) : (
                  <span style={{ fontSize: '0.85rem', color: '#f85149', alignSelf: 'center', fontWeight: 500 }}>Submission Closed</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
