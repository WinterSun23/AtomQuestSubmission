import { useState, useEffect } from 'react'
import { getActiveCycle, getThrustAreas, logEvent } from '../../lib/userApi'
import { getTeamGoalSheets, getEmployeeGoalSheet, approveGoalSheet, returnGoalSheet, updateGoalByManager, pushSharedGoal, getQuarterlyTeamStats } from '../../lib/managerApi'

const UOM_OPTIONS = [
  { value: 'numeric_min', label: 'Numeric (Min)' },
  { value: 'numeric_max', label: 'Numeric (Max)' },
  { value: 'percent_min', label: 'Percentage (Min)' },
  { value: 'percent_max', label: 'Percentage (Max)' },
  { value: 'timeline',    label: 'Timeline' },
  { value: 'zero_based',  label: 'Zero-based' }
]

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']

export default function TeamGoals() {
  const [cycle, setCycle] = useState(null)
  const [team, setTeam] = useState([])
  const [thrustAreas, setThrustAreas] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Views: 'list', 'review', 'shared'
  const [view, setView] = useState('list')
  const [selectedSheet, setSelectedSheet] = useState(null)
  const [reworkNote, setReworkNote] = useState('')

  // Quarter Stats State
  const [activeTab, setActiveTab] = useState('Q1')
  const [quarterStats, setQuarterStats] = useState(null)

  // Shared Goal State
  const [sharedGoal, setSharedGoal] = useState({
    thrust_area_id: '',
    title: '',
    description: '',
    uom_type: 'numeric_min',
    target: '',
    target_date: '',
    weightage: 10
  })
  const [selectedEmployees, setSelectedEmployees] = useState([])

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    getQuarterlyTeamStats(activeTab).then(res => setQuarterStats(res)).catch(console.error)
  }, [activeTab])

  async function loadData() {
    setLoading(true)
    try {
      const activeCycle = await getActiveCycle()
      setCycle(activeCycle)
      const areas = await getThrustAreas()
      setThrustAreas(areas)
      
      if (activeCycle) {
        const teamSheets = await getTeamGoalSheets(activeCycle.id)
        setTeam(teamSheets)
      }
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  async function handleReview(sheetId) {
    if (!sheetId) return
    try {
      const detail = await getEmployeeGoalSheet(sheetId)
      setSelectedSheet(detail)
      setReworkNote('')
      setView('review')
    } catch (err) {
      alert('Error fetching sheet: ' + err.message)
    }
  }

  async function handleApprove() {
    if (!selectedSheet) return
    if (!confirm('Are you sure you want to approve this sheet? Goals will be locked.')) return
    try {
      await approveGoalSheet(selectedSheet.id)
      await logEvent({
        action: 'APPROVE_GOAL_SHEET',
        goalSheetId: selectedSheet.id,
        description: `Manager approved and locked your goal sheet`
      })
      alert('Goal sheet approved and locked.')
      setView('list')
      loadData()
    } catch (err) {
      alert('Error approving sheet: ' + err.message)
    }
  }

  async function handleReturn() {
    if (!selectedSheet) return
    if (!reworkNote.trim()) return alert('Please enter a rework note')
    try {
      await returnGoalSheet(selectedSheet.id, reworkNote)
      await logEvent({
        action: 'RETURN_GOAL_SHEET',
        goalSheetId: selectedSheet.id,
        reason: reworkNote,
        description: `Manager returned your goal sheet for rework: "${reworkNote}"`
      })
      alert('Goal sheet returned to employee.')
      setView('list')
      loadData()
    } catch (err) {
      alert('Error returning sheet: ' + err.message)
    }
  }

  async function handleInlineEdit(goalId, currentTarget, currentTargetDate, currentWeightage) {
    const newTarget = prompt('New Target Value (leave blank if timeline):', currentTarget || '')
    const newTargetDate = prompt('New Target Date (YYYY-MM-DD) (leave blank if numeric):', currentTargetDate || '')
    const newWeightage = prompt('New Weightage (%):', currentWeightage || '')
    
    if (newWeightage === null) return // cancelled
    
    try {
      await updateGoalByManager(goalId, {
        target: newTarget || null,
        target_date: newTargetDate || null,
        weightage: newWeightage
      })
      alert('Goal updated successfully')
      handleReview(selectedSheet.id)
    } catch (err) {
      alert('Error updating goal: ' + err.message)
    }
  }

  async function handlePushSharedGoal() {
    if (selectedEmployees.length === 0) return alert('Select at least one employee')
    if (!sharedGoal.title || !sharedGoal.target) return alert('Title and Target are required')
    
    try {
      await pushSharedGoal({
        ...sharedGoal,
        thrust_area_id: sharedGoal.thrust_area_id || thrustAreas[0]?.id
      }, selectedEmployees, cycle.id)
      
      alert('Shared goal pushed successfully!')
      setView('list')
      setSharedGoal({
        thrust_area_id: '', title: '', description: '', uom_type: 'numeric_min', target: '', target_date: '', weightage: 10
      })
      setSelectedEmployees([])
      loadData()
    } catch (err) {
      alert('Error pushing shared goal: ' + err.message)
    }
  }

  if (loading) return <div className="user-empty">Loading...</div>
  if (!cycle) return <div className="user-empty">No active performance cycle found.</div>

  return (
    <div>
      <div className="user-page-header">
        <h1 className="user-page-title">Team Goals</h1>
        <p className="user-page-subtitle">Review goal sheets or push shared goals.</p>
      </div>

      {/* ── Quarterly Stats Tabs ── */}
      {view === 'list' && (
        <div className="user-card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
            {QUARTERS.map(q => (
              <button
                key={q}
                onClick={() => setActiveTab(q)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '1rem', fontWeight: activeTab === q ? 700 : 500,
                  color: activeTab === q ? '#4f46e5' : '#6b7280',
                  borderBottom: activeTab === q ? '2px solid #4f46e5' : 'none',
                  paddingBottom: '0.25rem'
                }}
              >
                {q} Stats
              </button>
            ))}
          </div>
          
          {quarterStats ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
               <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Total Check-ins</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>{quarterStats.total}</div>
              </div>
              <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Goals Achieved</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>{quarterStats.completed}</div>
              </div>
              <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.25rem' }}>Avg. Score</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>{quarterStats.avgScore}%</div>
              </div>
            </div>
          ) : (
            <div className="user-empty" style={{ padding: '1rem' }}>No data for this quarter.</div>
          )}
        </div>
      )}

      {view === 'review' && selectedSheet && (
        <div className="user-card">
          <button className="btn-sm btn-ghost-sm" onClick={() => setView('list')} style={{ marginBottom: '1rem' }}>
            ← Back to Team List
          </button>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 className="user-card-title" style={{ margin: 0 }}>Reviewing: {selectedSheet.employee.name}</h2>
            <span className={`badge badge-${selectedSheet.status}`}>{selectedSheet.status.replace('_', ' ')}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
            {selectedSheet.goals.map((goal, i) => (
              <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <h4 style={{ margin: 0 }}>{goal.title} {goal.is_shared && <span className="badge badge-draft">Shared</span>}</h4>
                  {selectedSheet.status === 'submitted' && (
                    <button className="btn-sm btn-ghost-sm" onClick={() => handleInlineEdit(goal.id, goal.target, goal.target_date, goal.weightage)}>
                      Inline Edit
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.5rem' }}>
                  {goal.thrust_areas?.name} | {goal.uom_type.replace('_', ' ')}
                </div>
                <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  {goal.description}
                </div>
                <div style={{ display: 'flex', gap: '2rem', fontSize: '0.9rem', fontWeight: 600 }}>
                  <div>Target: {goal.target_date || goal.target || '-'}</div>
                  <div>Weightage: {goal.weightage}%</div>
                </div>
              </div>
            ))}
          </div>

          {selectedSheet.status === 'submitted' && (
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1.5rem', display: 'flex', gap: '2rem' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.25rem', color: '#6b7280' }}>Rework Note (required if returning)</label>
                <input 
                  type="text" 
                  className="user-input" 
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  value={reworkNote} 
                  onChange={e => setReworkNote(e.target.value)} 
                  placeholder="What needs to change?"
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                <button className="btn-sm btn-danger-sm" onClick={handleReturn}>Return for Rework</button>
                <button className="btn-sm btn-success-sm" onClick={handleApprove}>Approve & Lock</button>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'shared' && (
        <div className="user-card">
          <button className="btn-sm btn-ghost-sm" onClick={() => setView('list')} style={{ marginBottom: '1rem' }}>
            ← Back to Team List
          </button>
          <h2 className="user-card-title">Push Shared Goal</h2>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1.5rem' }}>
            This goal will be added to the selected employees' goal sheets. The title and target will be locked, but they can adjust the weightage.
          </p>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
             <div>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Title</label>
                <input type="text" className="user-input" style={{ width: '100%', boxSizing: 'border-box' }}
                  value={sharedGoal.title} onChange={e => setSharedGoal({...sharedGoal, title: e.target.value})} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Thrust Area</label>
                <select className="user-select" style={{ width: '100%', boxSizing: 'border-box' }}
                  value={sharedGoal.thrust_area_id} onChange={e => setSharedGoal({...sharedGoal, thrust_area_id: e.target.value})}>
                  {thrustAreas.map(ta => <option key={ta.id} value={ta.id}>{ta.name}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Description (Optional)</label>
                <textarea className="user-input" style={{ width: '100%', boxSizing: 'border-box', height: '60px' }}
                  value={sharedGoal.description} onChange={e => setSharedGoal({...sharedGoal, description: e.target.value})} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>UoM Type</label>
                <select className="user-select" style={{ width: '100%', boxSizing: 'border-box' }}
                  value={sharedGoal.uom_type} onChange={e => setSharedGoal({...sharedGoal, uom_type: e.target.value})}>
                  {UOM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              
              {sharedGoal.uom_type === 'timeline' ? (
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Target Date</label>
                  <input type="date" className="user-input" style={{ width: '100%', boxSizing: 'border-box' }}
                    value={sharedGoal.target_date} onChange={e => setSharedGoal({...sharedGoal, target_date: e.target.value})} />
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Target Value</label>
                  <input type="number" className="user-input" style={{ width: '100%', boxSizing: 'border-box' }}
                    value={sharedGoal.target} onChange={e => setSharedGoal({...sharedGoal, target: e.target.value})} />
                </div>
              )}
              
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: '#6b7280' }}>Default Weightage (%)</label>
                <input type="number" className="user-input" style={{ width: '100%', boxSizing: 'border-box' }}
                  value={sharedGoal.weightage} onChange={e => setSharedGoal({...sharedGoal, weightage: e.target.value})} />
              </div>
          </div>
          
          <h4 style={{ marginBottom: '0.5rem' }}>Select Employees</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem' }}>
            {team.map(member => (
              <label key={member.employeeId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input 
                  type="checkbox" 
                  checked={selectedEmployees.includes(member.employeeId)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedEmployees([...selectedEmployees, member.employeeId])
                    else setSelectedEmployees(selectedEmployees.filter(id => id !== member.employeeId))
                  }}
                />
                {member.employeeName} ({member.department || 'No Dept'})
              </label>
            ))}
          </div>
          
          <button className="btn-sm btn-primary-sm" onClick={handlePushSharedGoal}>Push Goal</button>
        </div>
      )}

      {view === 'list' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button className="btn-sm btn-primary-sm" onClick={() => setView('shared')}>+ Push Shared Goal</button>
          </div>
          <div className="user-table-wrap">
            <table className="user-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Submitted On</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {team.length === 0 ? (
                  <tr><td colSpan="5" className="user-empty">No direct reports found.</td></tr>
                ) : team.map(member => (
                  <tr key={member.employeeId}>
                    <td style={{ fontWeight: 600 }}>{member.employeeName}</td>
                    <td>{member.department || '-'}</td>
                    <td>
                      <span className={`badge badge-${member.status}`}>
                        {member.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td>{member.submittedAt ? new Date(member.submittedAt).toLocaleDateString() : '-'}</td>
                    <td>
                      <button 
                        className="btn-sm btn-ghost-sm" 
                        onClick={() => handleReview(member.sheetId)}
                        disabled={!member.sheetId}
                      >
                        {member.status === 'submitted' ? 'Review' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

