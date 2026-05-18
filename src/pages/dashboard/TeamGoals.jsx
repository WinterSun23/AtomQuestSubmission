import { useState, useEffect } from 'react'
import { useApp } from '../../lib/AppContext'
import { getActiveCycle, getThrustAreas, logEvent, getActiveCheckInWindow } from '../../lib/userApi'
import { getTeamGoalSheets, getEmployeeGoalSheet, approveGoalSheet, returnGoalSheet, updateGoalByManager, pushSharedGoal, getQuarterlyTeamStats, saveManagerComment } from '../../lib/managerApi'
import { supabase } from '../../lib/supabase'

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
  const { settings } = useApp()
  const override = settings?.['active_quarter_override']
  const auto = settings?.['auto_active_quarter']
  const currentQuarter = override && override !== 'auto' && override !== '' ? override : (auto || 'Q1')

  const [cycle, setCycle] = useState(null)
  const [team, setTeam] = useState([])
  const [thrustAreas, setThrustAreas] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Search query
  const [rosterSearch, setRosterSearch] = useState('')

  // Views: 'list' (main direct reports workspace) or 'shared' (push shared goal form)
  const [view, setView] = useState('list')

  // Main Sub-Tab: 'sheets' (Goal Sheets Review) or 'checkins' (Progress Check-ins)
  const [activeMainTab, setActiveMainTab] = useState('sheets')

  // Review Modal Workspace States
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false)
  const [selectedSheet, setSelectedSheet] = useState(null)
  const [reworkNote, setReworkNote] = useState('')
  const [historyCheckins, setHistoryCheckins] = useState([])
  const [commentText, setCommentText] = useState('')
  const [window, setWindow] = useState(null)

  // Progress Check-ins Workspace States
  const [selectedCheckInEmployee, setSelectedCheckInEmployee] = useState(null)
  const [checkinGoals, setCheckinGoals] = useState([])
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [selectedGoal, setSelectedGoal] = useState(null)
  const [savingAll, setSavingAll] = useState(false)

  // Shared Goals Search filter
  const [sharedGoalsSearchText, setSharedGoalsSearchText] = useState('')

  // Inline manager editing states
  const [editingGoalId, setEditingGoalId] = useState(null)
  const [editFields, setEditFields] = useState({ target: '', target_date: '', weightage: '' })

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
        
        const activeWindow = await getActiveCheckInWindow(activeCycle.id)
        setWindow(activeWindow)
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
      setIsReviewModalOpen(true)
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
      setIsReviewModalOpen(false)
      setSelectedSheet(null)
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
      setIsReviewModalOpen(false)
      setSelectedSheet(null)
      loadData()
    } catch (err) {
      alert('Error returning sheet: ' + err.message)
    }
  }

  async function handleSelectCheckInEmployee(employeeId, employeeName) {
    setSelectedCheckInEmployee({ id: employeeId, name: employeeName })
    setCheckinGoals([])
    setHistoryCheckins([])
    setCommentText('')
    
    try {
      // 1. Fetch employee's approved goal sheet for this cycle
      const { data: sheet, error: sheetError } = await supabase
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
        
      if (sheetError) throw sheetError
      
      if (sheet && sheet.goals) {
        setCheckinGoals(sheet.goals)
        
        // 2. Fetch all historical check-ins across the entire cycle for these goals
        const { data: allHistory, error: histError } = await supabase
          .from('check_ins')
          .select(`
            *,
            check_in_windows (
              quarter, window_open, window_close
            )
          `)
          .in('goal_id', sheet.goals.map(g => g.id))
        
        if (histError) throw histError
        if (allHistory) {
          setHistoryCheckins(allHistory.sort((a, b) => {
            const qA = a.check_in_windows?.quarter || ''
            const qB = b.check_in_windows?.quarter || ''
            return qA.localeCompare(qB)
          }))
        }
      }
      
      // 3. Fetch global manager comment
      const { data: globalComm, error: commError } = await supabase
        .from('manager_comments')
        .select('comment')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false })
        .limit(1)
        
      if (commError) throw commError
      setCommentText(globalComm?.[0]?.comment || '')
    } catch (err) {
      alert('Error fetching check-ins details: ' + err.message)
    }
  }

  async function handleSaveCheckInComment(checkinId, comment) {
    try {
      const { error } = await supabase
        .from('check_ins')
        .update({ manager_comment: comment })
        .eq('id', checkinId)

      if (error) throw error
      
      setHistoryCheckins(prev => prev.map(h => h.id === checkinId ? { ...h, manager_comment: comment } : h))
      alert('Progress log feedback comment saved successfully!')
    } catch (err) {
      alert('Error saving feedback comment: ' + err.message)
    }
  }

  async function handleSaveCheckInGlobalFeedback() {
    if (!selectedCheckInEmployee) return
    setSavingAll(true)
    try {
      const { data: existingList, error: checkError } = await supabase
        .from('manager_comments')
        .select('id')
        .eq('employee_id', selectedCheckInEmployee.id)
        .order('created_at', { ascending: false })
        .limit(1)
        
      if (checkError) throw checkError
      const existing = existingList?.[0]
      if (existing) {
        const { error: updError } = await supabase
          .from('manager_comments')
          .update({ comment: commentText })
          .eq('id', existing.id)
        if (updError) throw updError
      } else {
        let activeWin = window
        if (!activeWin && cycle) {
          activeWin = await getActiveCheckInWindow(cycle.id)
        }
        if (activeWin) {
          await saveManagerComment(selectedCheckInEmployee.id, activeWin.id, commentText)
        } else {
          alert('Cannot save global comment: no active check-in window found for this cycle.')
          return
        }
      }
      alert('Overall check-in feedback saved successfully!')
    } catch (err) {
      alert('Error saving overall check-in feedback: ' + err.message)
    } finally {
      setSavingAll(false)
    }
  }

  function openGoalDrawer(goal) {
    setSelectedGoal(goal)
    setIsDrawerOpen(true)
  }

  function closeGoalDrawer() {
    setIsDrawerOpen(false)
    setSelectedGoal(null)
  }

  function startInlineEdit(goal) {
    setEditingGoalId(goal.id)
    setEditFields({
      target: goal.target || '',
      target_date: goal.target_date || '',
      weightage: goal.weightage || ''
    })
  }

  async function saveInlineEdit(goalId) {
    if (!editFields.weightage) return alert('Weightage is required')
    try {
      await updateGoalByManager(goalId, {
        target: editFields.target || null,
        target_date: editFields.target_date || null,
        weightage: Number(editFields.weightage)
      })
      alert('Goal updated successfully')
      
      // Reload current sheet data
      if (selectedSheet) {
        await handleReview(selectedSheet.id)
      }
      setEditingGoalId(null)
    } catch (err) {
      alert('Error updating goal: ' + err.message)
    }
  }

  async function handlePushSharedGoal() {
    if (selectedEmployees.length === 0) return alert('Select at least one employee')
    
    if (!sharedGoal.title) return alert('Title is required')
    if (sharedGoal.uom_type === 'timeline') {
      if (!sharedGoal.target_date) return alert('Target Date is required for timeline goals')
    } else {
      if (!sharedGoal.target) return alert('Target Value is required')
    }
    
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
      <style>{`
        .checkin-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
          margin-top: 1rem;
        }
        .checkin-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 1.5rem;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 200px;
        }
        .checkin-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.08);
          border-color: #4f46e5;
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
        .checkin-card.active-draft::before { background: #cbd5e1; }
        .checkin-card.active-rework::before { background: #f59e0b; }
        
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
          background: linear-gradient(90deg, #4f46e5, #6366f1);
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
          background: rgba(15, 23, 42, 0.35);
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
          width: 500px;
          max-width: 100vw;
          height: 100%;
          background: white;
          box-shadow: -10px 0 25px -5px rgba(0, 0, 0, 0.1), -4px 0 10px -5px rgba(0, 0, 0, 0.05);
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
          padding: 1.25rem 1.5rem;
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
          padding: 1.25rem 1.5rem;
          border-top: 1px solid #f3f4f6;
          background: #f9fafb;
        }
      `}</style>

      <div className="user-page-header">
        <h1 className="user-page-title">Team Goals & Check-ins</h1>
        <p className="user-page-subtitle">Track, search, and review performance goals and quarterly progress check-ins for your team.</p>
      </div>

      {/* ─── High-Level Phase Sub-tabs Toggle ─── */}
      {view === 'list' && currentQuarter !== 'phase1' && (
        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #e5e7eb', paddingBottom: '0.25rem' }}>
          <button
            onClick={() => { 
              setActiveMainTab('sheets'); 
              setSelectedCheckInEmployee(null); 
              setIsDrawerOpen(false);
              setSelectedGoal(null);
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '1rem', fontWeight: 700,
              color: activeMainTab === 'sheets' ? '#4f46e5' : '#6b7280',
              borderBottom: activeMainTab === 'sheets' ? '3px solid #4f46e5' : 'none',
              paddingBottom: '0.75rem',
              transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', gap: '0.5rem'
            }}
          >
            🎯 Goal Sheets Review
          </button>
          <button
            onClick={() => { 
              setActiveMainTab('checkins'); 
              setSelectedCheckInEmployee(null); 
              setIsReviewModalOpen(false);
              setSelectedSheet(null);
              setView('list');
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '1rem', fontWeight: 700,
              color: activeMainTab === 'checkins' ? '#4f46e5' : '#6b7280',
              borderBottom: activeMainTab === 'checkins' ? '3px solid #4f46e5' : 'none',
              paddingBottom: '0.75rem',
              transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', gap: '0.5rem'
            }}
          >
            📈 Progress Check-ins
          </button>
        </div>
      )}

      {/* ───────────────── SUB-TAB A: GOAL SHEETS REVIEW ───────────────── */}
      {activeMainTab === 'sheets' && (
        <>
          {/* ─── Unified View: Shared Goal Push View ─── */}
          {view === 'shared' && (
            <div className="user-card">
              <button className="btn-sm btn-ghost-sm" onClick={() => setView('list')} style={{ marginBottom: '1rem' }}>
                ← Back to Direct Reports Roster
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
              
              <h4 style={{ marginBottom: '0.5rem', fontWeight: 700, color: '#1f2937' }}>Select Employees</h4>
              
              {/* Search and Select All / Deselect All Controls */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <input 
                  type="text" 
                  className="user-input" 
                  style={{ flex: 1, minWidth: '200px', padding: '0.45rem 0.75rem', fontSize: '0.85rem', boxSizing: 'border-box' }} 
                  placeholder="🔍 Search direct reports..." 
                  value={sharedGoalsSearchText} 
                  onChange={e => setSharedGoalsSearchText(e.target.value)}
                />
                <button 
                  className="btn-sm btn-ghost-sm" 
                  onClick={() => {
                    const filteredIds = team
                      .filter(member => member.employeeName.toLowerCase().includes(sharedGoalsSearchText.toLowerCase()))
                      .map(member => member.employeeId)
                    const allSelected = filteredIds.every(id => selectedEmployees.includes(id))
                    if (allSelected) {
                      setSelectedEmployees(selectedEmployees.filter(id => !filteredIds.includes(id)))
                    } else {
                      const newSelected = [...selectedEmployees, ...filteredIds]
                      setSelectedEmployees([...new Set(newSelected)])
                    }
                  }}
                  style={{ whiteSpace: 'nowrap', fontWeight: 600 }}
                >
                  Toggle Filtered
                </button>
                <button 
                  className="btn-sm btn-primary-sm" 
                  onClick={() => setSelectedEmployees(team.map(member => member.employeeId))}
                  style={{ whiteSpace: 'nowrap', fontWeight: 600 }}
                >
                  Select All Under Manager
                </button>
                <button 
                  className="btn-sm btn-danger-sm" 
                  onClick={() => setSelectedEmployees([])}
                  style={{ whiteSpace: 'nowrap', fontWeight: 600 }}
                >
                  Deselect All
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem', maxHeight: '180px', overflowY: 'auto', border: '1px solid #e5e7eb', padding: '0.75rem', borderRadius: '8px', background: '#f9fafb' }}>
                {team
                  .filter(member => member.employeeName.toLowerCase().includes(sharedGoalsSearchText.toLowerCase()))
                  .map(member => (
                    <label key={member.employeeId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: '#374151' }}>
                      <input 
                        type="checkbox" 
                        checked={selectedEmployees.includes(member.employeeId)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedEmployees([...selectedEmployees, member.employeeId])
                          else setSelectedEmployees(selectedEmployees.filter(id => id !== member.employeeId))
                        }}
                      />
                      {member.employeeName}
                    </label>
                  ))}
                {team.filter(member => member.employeeName.toLowerCase().includes(sharedGoalsSearchText.toLowerCase())).length === 0 && (
                  <div style={{ fontSize: '0.8rem', color: '#9ca3af', textAlign: 'center', padding: '1rem' }}>No direct reports matching filter.</div>
                )}
              </div>
              
              <button className="btn-sm btn-primary-sm" onClick={handlePushSharedGoal}>Push Goal</button>
            </div>
          )}

          {/* ─── Unified View: Main Direct Reports List ─── */}
          {view === 'list' && (
            <>
              {/* ── Quarterly Stats Tabs ── */}
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

              {/* Roster & Search Table */}
              <div className="user-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <h2 className="user-card-title" style={{ margin: 0 }}>👥 Direct Reports Roster</h2>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
                      Search team reports, view active goal sheet statuses, and launch centered review workspaces.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', minWidth: '400px' }}>
                    <input
                      type="text"
                      className="user-input"
                      style={{ flex: 1, boxSizing: 'border-box' }}
                      placeholder="🔍 Search reports by name or email..."
                      value={rosterSearch}
                      onChange={e => setRosterSearch(e.target.value)}
                    />
                    <button className="btn-sm btn-primary-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setView('shared')}>
                      + Push Shared Goal
                    </button>
                  </div>
                </div>

                <div className="user-table-wrap">
                  <table className="user-table">
                    <thead>
                      <tr>
                        <th>Employee Name</th>
                        <th>Email Address</th>
                        <th>Goal Sheet Status</th>
                        <th>Last Submitted Date</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {team.filter(emp => 
                        emp.employeeName.toLowerCase().includes(rosterSearch.toLowerCase()) ||
                        (emp.employeeEmail || '').toLowerCase().includes(rosterSearch.toLowerCase())
                      ).length === 0 ? (
                        <tr>
                          <td colSpan="5" className="user-empty">No matching team members found.</td>
                        </tr>
                      ) : (
                        team
                          .filter(emp => 
                            emp.employeeName.toLowerCase().includes(rosterSearch.toLowerCase()) ||
                            (emp.employeeEmail || '').toLowerCase().includes(rosterSearch.toLowerCase())
                          )
                          .map(emp => (
                            <tr key={emp.employeeId} style={{ cursor: emp.sheetId ? 'pointer' : 'default' }} onClick={() => emp.sheetId && handleReview(emp.sheetId)}>
                              <td style={{ fontWeight: 600 }}>{emp.employeeName}</td>
                              <td style={{ color: '#4b5563' }}>{emp.employeeEmail || 'N/A'}</td>
                              <td>
                                <span className={`badge badge-${emp.status}`}>
                                  {emp.status.replace('_', ' ')}
                                </span>
                              </td>
                              <td>{emp.submittedAt ? new Date(emp.submittedAt).toLocaleDateString() : '-'}</td>
                              <td>
                                <div style={{ display: 'flex', gap: '0.5rem' }} onClick={e => e.stopPropagation()}>
                                  {emp.sheetId ? (
                                    <button
                                      className="btn-sm btn-ghost-sm"
                                      onClick={() => handleReview(emp.sheetId)}
                                    >
                                      {emp.status === 'submitted' ? 'Review Workspace' : 'View Goals'}
                                    </button>
                                  ) : (
                                    <span style={{ fontSize: '0.78rem', color: '#9ca3af', padding: '0.45rem 1rem' }}>No Goal Sheet</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ───────────────── SUB-TAB B: PROGRESS CHECK-INS ───────────────── */}
      {activeMainTab === 'checkins' && currentQuarter !== 'phase1' && (
        <>
          {/* Employee Directory View */}
          {selectedCheckInEmployee === null ? (
            <div className="user-card">
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 className="user-card-title" style={{ margin: 0 }}>📈 Progress Check-ins Command Center</h2>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
                  Select a team member to track active progress scores and write quarterly logs feedback.
                </p>
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <input
                  type="text"
                  className="user-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder="🔍 Search reports by name or email..."
                  value={rosterSearch}
                  onChange={e => setRosterSearch(e.target.value)}
                />
              </div>

              <div className="user-table-wrap">
                <table className="user-table">
                  <thead>
                    <tr>
                      <th>Employee Name</th>
                      <th>Email Address</th>
                      <th>Goal Sheet</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.filter(emp => 
                      emp.employeeName.toLowerCase().includes(rosterSearch.toLowerCase()) ||
                      (emp.employeeEmail || '').toLowerCase().includes(rosterSearch.toLowerCase())
                    ).length === 0 ? (
                      <tr>
                        <td colSpan="4" className="user-empty">No matching team members found.</td>
                      </tr>
                    ) : (
                      team
                        .filter(emp => 
                          emp.employeeName.toLowerCase().includes(rosterSearch.toLowerCase()) ||
                          (emp.employeeEmail || '').toLowerCase().includes(rosterSearch.toLowerCase())
                        )
                        .map(emp => (
                          <tr key={`checkin-emp-${emp.employeeId}`} style={{ cursor: emp.status === 'approved' ? 'pointer' : 'default' }} onClick={() => emp.status === 'approved' && handleSelectCheckInEmployee(emp.employeeId, emp.employeeName)}>
                            <td style={{ fontWeight: 600 }}>{emp.employeeName}</td>
                            <td style={{ color: '#4b5563' }}>{emp.employeeEmail || 'N/A'}</td>
                            <td>
                              <span className={`badge badge-${emp.status}`}>
                                {emp.status === 'approved' ? 'Active Approved' : 'No Approved Sheet'}
                              </span>
                            </td>
                            <td>
                              {emp.status === 'approved' ? (
                                <button
                                  className="btn-sm btn-ghost-sm"
                                  onClick={(e) => { e.stopPropagation(); handleSelectCheckInEmployee(emp.employeeId, emp.employeeName); }}
                                >
                                  Evaluate Progress & Check-ins
                                </button>
                              ) : (
                                <span style={{ fontSize: '0.78rem', color: '#9ca3af', padding: '0.45rem 1rem' }}>Locked (Planning Phase)</span>
                              )}
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Selected Subordinate Workspace: Grid of Approved Goals */
            <div className="user-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f3f4f6', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <button className="btn-sm btn-ghost-sm" onClick={() => setSelectedCheckInEmployee(null)} style={{ marginBottom: '0.5rem' }}>
                    ← Back to Check-ins Directory
                  </button>
                  <h2 className="user-card-title" style={{ margin: 0 }}>📊 Check-ins Center: {selectedCheckInEmployee.name}</h2>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
                    Click on any card to slide open its quarterly progress history logs and add evaluator comments.
                  </p>
                </div>
              </div>

              {checkinGoals.length === 0 ? (
                <div className="user-empty" style={{ padding: '3rem' }}>
                  No approved goals found for this employee in the active cycle.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                  
                  {/* Personal Goals Section */}
                  <div>
                    <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1f2937', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>👤 Personal Goals</span>
                      <span style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 400 }}>({checkinGoals.filter(g => !g.is_shared).length})</span>
                    </h4>
                    {checkinGoals.filter(g => !g.is_shared).length === 0 ? (
                      <div className="user-empty" style={{ padding: '2rem' }}>No personal goals have been approved for this employee.</div>
                    ) : (
                      <div className="checkin-grid" style={{ marginTop: 0 }}>
                        {checkinGoals.filter(g => !g.is_shared).map(goal => {
                          const goalHistory = historyCheckins.filter(h => h.goal_id === goal.id)
                          const latestCheckIn = goalHistory[goalHistory.length - 1]
                          const latestScore = latestCheckIn ? Number(latestCheckIn.computed_score) : 0
                          const latestStatus = latestCheckIn ? latestCheckIn.status : 'draft'
                          
                          return (
                            <div 
                              key={goal.id} 
                              className={`checkin-card active-${latestStatus}`}
                              onClick={() => openGoalDrawer(goal)}
                            >
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                  <span style={{ fontSize: '0.72rem', color: '#4f46e5', fontWeight: 700, textTransform: 'uppercase', tracking: '0.05em' }}>
                                    👤 Personal Goal
                                  </span>
                                  <span className={`badge badge-${latestCheckIn?.status === 'completed' ? 'approved' : latestCheckIn?.status === 'on_track' ? 'rework' : 'draft'}`} style={{ fontSize: '0.62rem', padding: '0.15rem 0.45rem' }}>
                                    {latestCheckIn ? latestCheckIn.status.replace('_', ' ') : 'no logs'}
                                  </span>
                                </div>
                                
                                <h4 style={{ fontSize: '0.98rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#111827' }}>
                                  {goal.title}
                                </h4>
                                <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 0.75rem 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>
                                  {goal.description || 'No description provided.'}
                                </p>
                              </div>
                              
                              <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#4b5563', marginBottom: '0.25rem' }}>
                                  <span>Target: <strong>{goal.target_date || goal.target || '-'}</strong></span>
                                  <span>Weightage: <strong>{goal.weightage}%</strong></span>
                                </div>
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                                  <span>LOGGED ACHIEVEMENT SCORE</span>
                                  <strong style={{ color: '#4f46e5' }}>{latestCheckIn ? `${latestScore.toFixed(0)}%` : '—'}</strong>
                                </div>
                                <div className="progress-bar-bg">
                                  <div className="progress-bar-fill" style={{ width: `${latestScore}%` }} />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Shared Goals Section */}
                  {checkinGoals.filter(g => g.is_shared).length > 0 && (
                    <div style={{ borderTop: '2px dashed #e2e8f0', paddingTop: '1.5rem' }}>
                      <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#4f46e5', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>👥 Pushed Shared Goals</span>
                        <span style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 400 }}>({checkinGoals.filter(g => g.is_shared).length})</span>
                      </h4>
                      <div className="checkin-grid" style={{ marginTop: 0 }}>
                        {checkinGoals.filter(g => g.is_shared).map(goal => {
                          const goalHistory = historyCheckins.filter(h => h.goal_id === goal.id)
                          const latestCheckIn = goalHistory[goalHistory.length - 1]
                          const latestScore = latestCheckIn ? Number(latestCheckIn.computed_score) : 0
                          const latestStatus = latestCheckIn ? latestCheckIn.status : 'draft'
                          
                          return (
                            <div 
                              key={goal.id} 
                              className={`checkin-card active-${latestStatus}`}
                              onClick={() => openGoalDrawer(goal)}
                            >
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                  <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase', tracking: '0.05em' }}>
                                    👥 Shared Goal
                                  </span>
                                  <span className={`badge badge-${latestCheckIn?.status === 'completed' ? 'approved' : latestCheckIn?.status === 'on_track' ? 'rework' : 'draft'}`} style={{ fontSize: '0.62rem', padding: '0.15rem 0.45rem' }}>
                                    {latestCheckIn ? latestCheckIn.status.replace('_', ' ') : 'no logs'}
                                  </span>
                                </div>
                                
                                <h4 style={{ fontSize: '0.98rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#111827' }}>
                                  {goal.title}
                                </h4>
                                <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 0.75rem 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>
                                  {goal.description || 'No description provided.'}
                                </p>
                              </div>
                              
                              <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#4b5563', marginBottom: '0.25rem' }}>
                                  <span>Target: <strong>{goal.target_date || goal.target || '-'}</strong></span>
                                  <span>Weightage: <strong>{goal.weightage}%</strong></span>
                                </div>
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.5rem' }}>
                                  <span>LOGGED ACHIEVEMENT SCORE</span>
                                  <strong style={{ color: '#4f46e5' }}>{latestCheckIn ? `${latestScore.toFixed(0)}%` : '—'}</strong>
                                </div>
                                <div className="progress-bar-bg">
                                  <div className="progress-bar-fill" style={{ width: `${latestScore}%` }} />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* Overall Cycle Performance Comments Box */}
              <div style={{ borderTop: '2px dashed #e2e8f0', paddingTop: '1.5rem', marginTop: '2rem' }}>
                <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#111827', margin: '0 0 0.5rem 0' }}>
                  ✍️ Overall Cycle Performance Review Notes
                </h4>
                <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8rem', color: '#6b7280' }}>
                  Add cycle-wide performance summary comments or global evaluation remarks for this employee.
                </p>
                <textarea 
                  className="user-input" 
                  style={{ width: '100%', boxSizing: 'border-box', height: '90px', fontSize: '0.85rem', padding: '0.75rem' }}
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Provide general quarterly performance feedback or final cycle evaluations..."
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                  <button className="btn-sm btn-success-sm" onClick={handleSaveCheckInGlobalFeedback} disabled={savingAll}>
                    {savingAll ? 'Saving...' : 'Save Overall Review Notes'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Spacious Centered Goal Sheet Review Modal Workspace (UNMIXED - PHASE 1 ONLY) ─── */}
      {isReviewModalOpen && selectedSheet && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '1050px', width: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            {/* Modal Header */}
            <div className="modal-header" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#111827' }}>
                  🎯 Goal Sheet Workspace: {selectedSheet.employee.name}
                </h3>
                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.2rem' }}>
                  {selectedSheet.employee.email} | Active Performance Cycle
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span className={`badge badge-${selectedSheet.status}`} style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}>
                  {selectedSheet.status.replace('_', ' ')}
                </span>
                <button 
                  className="modal-close-btn" 
                  onClick={() => { setIsReviewModalOpen(false); setSelectedSheet(null); }}
                  style={{ fontSize: '1.4rem' }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body (Clean Goal Settings) */}
            <div className="modal-body" style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                
                {/* Personal Goals Section */}
                <div>
                  <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1f2937', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>👤 Personal Goals</span>
                    <span style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 400 }}>({selectedSheet.goals.filter(g => !g.is_shared).length})</span>
                  </h4>
                  {selectedSheet.goals.filter(g => !g.is_shared).length === 0 ? (
                    <div className="user-empty" style={{ padding: '2rem' }}>No personal goals have been added to this sheet.</div>
                  ) : (
                    <div className="checkin-grid">
                      {selectedSheet.goals.filter(g => !g.is_shared).map((goal, i) => (
                        <div 
                          key={`personal-${i}`} 
                          className="checkin-card active-on_track" 
                          style={{ cursor: 'default', minHeight: 'auto' }}
                        >
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                              <span style={{ fontSize: '0.72rem', color: '#4f46e5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                👤 Personal Goal #{i + 1}
                              </span>
                              {selectedSheet.status === 'submitted' && (
                                editingGoalId === goal.id ? (
                                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                                    <button 
                                      className="btn-sm btn-success-sm" 
                                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', fontWeight: 700 }} 
                                      onClick={() => saveInlineEdit(goal.id)}
                                    >
                                      💾 Save
                                    </button>
                                    <button 
                                      className="btn-sm btn-ghost-sm" 
                                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }} 
                                      onClick={() => setEditingGoalId(null)}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ) : (
                                  <button 
                                    className="btn-sm btn-ghost-sm" 
                                    style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }} 
                                    onClick={() => startInlineEdit(goal)}
                                  >
                                    ✏️ Edit
                                  </button>
                                )
                              )}
                            </div>
                            
                            <h4 style={{ fontSize: '0.98rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#111827' }}>
                              {goal.title}
                            </h4>
                            <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 0.75rem 0', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>
                              {goal.description || 'No description provided.'}
                            </p>
                          </div>
                          
                          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                            {editingGoalId === goal.id ? (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                {goal.uom_type === 'timeline' ? (
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.68rem', color: '#6b7280', marginBottom: '0.2rem' }}>Target Date:</label>
                                    <input 
                                      type="date" 
                                      className="user-input" 
                                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }}
                                      value={editFields.target_date}
                                      onChange={e => setEditFields({ ...editFields, target_date: e.target.value })}
                                    />
                                  </div>
                                ) : (
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.68rem', color: '#6b7280', marginBottom: '0.2rem' }}>Target:</label>
                                    <input 
                                      type="text" 
                                      className="user-input" 
                                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }}
                                      value={editFields.target}
                                      onChange={e => setEditFields({ ...editFields, target: e.target.value })}
                                    />
                                  </div>
                                )}
                                <div>
                                  <label style={{ display: 'block', fontSize: '0.68rem', color: '#6b7280', marginBottom: '0.2rem' }}>Weightage (%):</label>
                                  <input 
                                    type="number" 
                                    className="user-input" 
                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }}
                                    value={editFields.weightage}
                                    onChange={e => setEditFields({ ...editFields, weightage: e.target.value })}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#4b5563', marginBottom: '0.5rem' }}>
                                <span>Target: <strong>{goal.target_date || goal.target || '-'}</strong></span>
                                <span>Weightage: <strong>{goal.weightage}%</strong></span>
                              </div>
                            )}
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', color: '#6b7280', background: '#f9fafb', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                              <div>📌 <strong>Thrust Area:</strong> {goal.thrust_areas?.name || 'Thrust Area'}</div>
                              <div>📊 <strong>UoM Type:</strong> {goal.uom_type.replace('_', ' ')}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Shared Goals Section */}
                {selectedSheet.goals.filter(g => g.is_shared).length > 0 && (
                  <div style={{ borderTop: '2px dashed #e2e8f0', paddingTop: '1.5rem' }}>
                    <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#4f46e5', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>👥 Pushed Shared Goals</span>
                      <span style={{ fontSize: '0.78rem', color: '#9ca3af', fontWeight: 400 }}>({selectedSheet.goals.filter(g => g.is_shared).length})</span>
                    </h4>
                    <div className="checkin-grid">
                      {selectedSheet.goals.filter(g => g.is_shared).map((goal, i) => (
                        <div 
                          key={`shared-${i}`} 
                          className="checkin-card active-completed" 
                          style={{ cursor: 'default', minHeight: 'auto' }}
                        >
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                              <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                👥 Shared Goal #{i + 1}
                              </span>
                              {selectedSheet.status === 'submitted' && (
                                editingGoalId === goal.id ? (
                                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                                    <button 
                                      className="btn-sm btn-success-sm" 
                                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', fontWeight: 700 }} 
                                      onClick={() => saveInlineEdit(goal.id)}
                                    >
                                      💾 Save
                                    </button>
                                    <button 
                                      className="btn-sm btn-ghost-sm" 
                                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }} 
                                      onClick={() => setEditingGoalId(null)}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ) : (
                                  <button 
                                    className="btn-sm btn-ghost-sm" 
                                    style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }} 
                                    onClick={() => startInlineEdit(goal)}
                                  >
                                    ✏️ Edit
                                  </button>
                                )
                              )}
                            </div>
                            
                            <h4 style={{ fontSize: '0.98rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: '#111827' }}>
                              {goal.title}
                            </h4>
                            <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: '0 0 0.75rem 0', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>
                              {goal.description || 'No description provided.'}
                            </p>
                          </div>
                          
                          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                            {editingGoalId === goal.id ? (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                {goal.uom_type === 'timeline' ? (
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.68rem', color: '#6b7280', marginBottom: '0.2rem' }}>Target Date:</label>
                                    <input 
                                      type="date" 
                                      className="user-input" 
                                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }}
                                      value={editFields.target_date}
                                      onChange={e => setEditFields({ ...editFields, target_date: e.target.value })}
                                    />
                                  </div>
                                ) : (
                                  <div>
                                    <label style={{ display: 'block', fontSize: '0.68rem', color: '#6b7280', marginBottom: '0.2rem' }}>Target:</label>
                                    <input 
                                      type="text" 
                                      className="user-input" 
                                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }}
                                      value={editFields.target}
                                      onChange={e => setEditFields({ ...editFields, target: e.target.value })}
                                    />
                                  </div>
                                )}
                                <div>
                                  <label style={{ display: 'block', fontSize: '0.68rem', color: '#6b7280', marginBottom: '0.2rem' }}>Weightage (%):</label>
                                  <input 
                                    type="number" 
                                    className="user-input" 
                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }}
                                    value={editFields.weightage}
                                    onChange={e => setEditFields({ ...editFields, weightage: e.target.value })}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#4b5563', marginBottom: '0.5rem' }}>
                                <span>Target: <strong>{goal.target_date || goal.target || '-'}</strong></span>
                                <span>Weightage: <strong>{goal.weightage}%</strong></span>
                              </div>
                            )}
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.72rem', color: '#6b7280', background: '#f9fafb', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                              <div>📌 <strong>Thrust Area:</strong> {goal.thrust_areas?.name || 'Thrust Area'}</div>
                              <div>📊 <strong>UoM Type:</strong> {goal.uom_type.replace('_', ' ')}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer Controls */}
            {selectedSheet.status === 'submitted' && (
              <div className="modal-footer" style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <input 
                    type="text" 
                    className="user-input" 
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    value={reworkNote} 
                    onChange={e => setReworkNote(e.target.value)} 
                    placeholder="✍️ Enter rework note (required if returning for changes)..."
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', shrink: 0 }}>
                  <button className="btn-sm btn-danger-sm" onClick={handleReturn}>Return for Rework</button>
                  <button className="btn-sm btn-success-sm" onClick={handleApprove}>Approve & Lock Sheet</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────────────── SLIDE-OVER DRAWER: GOAL PROGRESS LOGS CHRONOLOGY ───────────────── */}
      <div className={`drawer-overlay ${isDrawerOpen ? 'open' : ''}`} onClick={closeGoalDrawer} />
      <div className={`drawer-body ${isDrawerOpen ? 'open' : ''}`}>
        {selectedGoal && (
          <>
            <div className="drawer-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#111827' }}>
                  📈 Check-in Progress Logs
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                  {selectedGoal.title}
                </span>
              </div>
              <button 
                onClick={closeGoalDrawer} 
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#9ca3af' }}
              >
                ✕
              </button>
            </div>

            <div className="drawer-content">
              {historyCheckins.filter(h => h.goal_id === selectedGoal.id).length === 0 ? (
                <div className="user-empty" style={{ padding: '2rem' }}>
                  No progress logs submitted for this goal yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {historyCheckins.filter(h => h.goal_id === selectedGoal.id).map((h, idx) => {
                    const score = h.computed_score !== null ? Number(h.computed_score) : 0
                    return (
                      <div 
                        key={h.id} 
                        style={{
                          padding: '1rem',
                          background: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          borderRadius: '10px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#111827' }}>
                            {h.check_in_windows?.quarter || 'Check-in'} (Log #{historyCheckins.filter(x => x.goal_id === selectedGoal.id).length - idx})
                          </span>
                          <span className={`badge badge-${h.status === 'completed' ? 'approved' : h.status === 'on_track' ? 'rework' : 'draft'}`} style={{ fontSize: '0.62rem' }}>
                            {h.status.replace('_', ' ')}
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: 'white', padding: '0.5rem', borderRadius: '6px', border: '1px solid #e5e7eb', marginBottom: '0.75rem' }}>
                          <div>
                            <span style={{ fontSize: '0.58rem', color: '#9ca3af', fontWeight: 600 }}>ACTUAL ACHIEVEMENT</span>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#111827' }}>
                              {selectedGoal.uom_type === 'timeline' ? h.actual_date : h.actual_achievement}
                            </div>
                          </div>
                          <div>
                            <span style={{ fontSize: '0.58rem', color: '#9ca3af', fontWeight: 600 }}>CALCULATED SCORE</span>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#4f46e5' }}>
                              {h.computed_score !== null ? `${score.toFixed(0)}%` : '—'}
                            </div>
                          </div>
                        </div>

                        <div className="progress-bar-bg" style={{ height: '6px', marginBottom: '0.75rem' }}>
                          <div className="progress-bar-fill" style={{ width: `${score}%` }} />
                        </div>

                        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginTop: '0.5rem' }}>
                          <input
                            type="text"
                            className="user-input"
                            placeholder="Add progress log feedback comment..."
                            style={{ flex: 1, fontSize: '0.75rem', padding: '0.35rem 0.5rem' }}
                            defaultValue={h.manager_comment || ''}
                            id={`hist-comm-${h.id}`}
                          />
                          <button
                            className="btn-sm btn-primary-sm"
                            style={{ fontSize: '0.7rem', padding: '0.35rem 0.5rem', whiteSpace: 'nowrap' }}
                            onClick={() => {
                              const val = document.getElementById(`hist-comm-${h.id}`).value
                              handleSaveCheckInComment(h.id, val)
                            }}
                          >
                            Save Feedback
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="drawer-footer">
              <button className="btn-sm btn-ghost-sm" style={{ width: '100%' }} onClick={closeGoalDrawer}>
                Close Progress History
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

