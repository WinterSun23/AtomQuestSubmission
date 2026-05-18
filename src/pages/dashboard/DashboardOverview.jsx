import { useState, useEffect } from 'react'
import { useApp } from '../../lib/AppContext'
import { supabase } from '../../lib/supabase'

export default function DashboardOverview() {
  const { me, activeCycle: cycle, activeWindow, loading: contextLoading } = useApp()
  const [loadingReports, setLoadingReports] = useState(true)
  const [directReports, setDirectReports] = useState([])
  const [pendingApprovals, setPendingApprovals] = useState([])
  const [completionStats, setCompletionStats] = useState({ completed: 0, total: 0 })

  useEffect(() => {
    if (contextLoading || !me) return

    async function loadManagerData() {
      try {
        if (me.role === 'manager' || me.role === 'admin') {
          // Fetch direct reports
          const { data: reports } = await supabase
            .from('users')
            .select('id, name, email')
            .eq('manager_id', me.id)
            
          const reportsList = reports || []
          setDirectReports(reportsList)

          if (cycle && reportsList.length > 0) {
            const reportIds = reportsList.map(r => r.id)

            // 1. Fetch pending approvals (submitted goal sheets)
            const { data: pending } = await supabase
              .from('goal_sheets')
              .select('id, status, submitted_at, employee_id, users!goal_sheets_employee_id_users_id_fk(name)')
              .in('employee_id', reportIds)
              .eq('status', 'submitted')
            
            setPendingApprovals(pending || [])

            // 2. Fetch check-in completion (manager comments for active window)
            if (activeWindow) {
              const { data: comments } = await supabase
                .from('manager_comments')
                .select('employee_id')
                .in('employee_id', reportIds)
                .eq('window_id', activeWindow.id)
                
              const completedCount = comments ? comments.length : 0
              setCompletionStats({
                completed: completedCount,
                total: reportsList.length
              })
            }
          }
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoadingReports(false)
      }
    }
    loadManagerData()
  }, [contextLoading, me, cycle, activeWindow])

  const isLoading = contextLoading || (me && (me.role === 'manager' || me.role === 'admin') && loadingReports)

  if (isLoading) return <div className="user-empty">Loading...</div>
  if (!me) return <div className="user-empty">Not authenticated.</div>

  const isManager = me.role === 'manager' || me.role === 'admin'

  if (isManager) {
    const completionPercentage = completionStats.total > 0 
      ? Math.round((completionStats.completed / completionStats.total) * 100) 
      : 0

    return (
      <div>
        <div className="user-page-header">
          <h1 className="user-page-title">Welcome back, {me.name}!</h1>
          <p className="user-page-subtitle">Manager Portal Overview • Direct Reports: {directReports.length}</p>
        </div>

        {cycle ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* ─── Stats Grid ─── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
              
              <div className="user-card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Active Performance Cycle
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827', marginTop: '0.5rem' }}>
                    {cycle.name}
                  </div>
                </div>
                <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#4f46e5', fontWeight: 600 }}>
                  Goal submission calendar is active
                </div>
              </div>

              <div className="user-card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Goal Sheet Approvals
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: pendingApprovals.length > 0 ? '#b91c1c' : '#15803d', marginTop: '0.25rem' }}>
                    {pendingApprovals.length}
                  </div>
                </div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#6b7280' }}>
                  {pendingApprovals.length > 0 ? 'Action required: sheets pending review' : 'All team goal sheets approved'}
                </div>
              </div>

              <div className="user-card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Team Check-in Rate
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <span style={{ fontSize: '2rem', fontWeight: 800, color: '#4f46e5' }}>{completionPercentage}%</span>
                    <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>({completionStats.completed}/{completionStats.total} reviewed)</span>
                  </div>
                </div>
                <div style={{ width: '100%', background: '#e5e7eb', height: 6, borderRadius: 3, marginTop: '1rem', overflow: 'hidden' }}>
                  <div style={{ width: `${completionPercentage}%`, background: '#4f46e5', height: '100%', borderRadius: 3 }} />
                </div>
              </div>
            </div>

            {/* ─── Main Details ─── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>
              
              {/* Pending Approvals */}
              <div className="user-card" style={{ marginBottom: 0 }}>
                <h2 className="user-card-title">Pending Goal Sheets</h2>
                {pendingApprovals.length === 0 ? (
                  <div className="user-empty" style={{ padding: '2rem 1rem' }}>No pending goal sheets to approve.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                    {pendingApprovals.map(sheet => (
                      <div key={sheet.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: '#f9fafb', borderRadius: '8px', border: '1px solid #f3f4f6' }}>
                        <div>
                          <div style={{ fontWeight: 600, color: '#111827' }}>{sheet.users?.name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Submitted on {new Date(sheet.submitted_at).toLocaleDateString()}</div>
                        </div>
                        <a href="/dashboard/team-goals" className="btn-sm btn-primary-sm" style={{ textDecoration: 'none' }}>
                          Review
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Direct Reports List */}
              <div className="user-card" style={{ marginBottom: 0 }}>
                <h2 className="user-card-title">Team Roster</h2>
                {directReports.length === 0 ? (
                  <div className="user-empty" style={{ padding: '2rem 1rem' }}>No direct reports registered.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem', maxHeight: '250px', overflowY: 'auto' }}>
                    {directReports.map(report => (
                      <div key={report.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: '#fff', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{report.name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{report.email}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <a href="/dashboard/team-checkins" className="btn-sm btn-ghost-sm" style={{ textDecoration: 'none', fontSize: '0.78rem' }}>
                            Feedback
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="user-empty">
            <p>No active performance cycle found.</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Administrators must configure a cycle before goal setting can start.</p>
          </div>
        )}
      </div>
    )
  }

  // Default Employee View
  return (
    <div>
      <div className="user-page-header">
        <h1 className="user-page-title">Welcome back, {me.name}!</h1>
        <p className="user-page-subtitle">Here is an overview of your active performance cycle.</p>
      </div>
      
      {cycle ? (
        <div className="user-card" style={{ maxWidth: 500 }}>
          <h2 className="user-card-title">Active Cycle: {cycle.name}</h2>
          <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>GOAL SETTING OPENS</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{cycle.goal_window_start}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>GOAL SETTING CLOSES</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{cycle.goal_window_end}</div>
            </div>
          </div>
          <div style={{ marginTop: '2rem' }}>
            <a href="/dashboard/my-goals" className="btn-sm btn-primary-sm" style={{ textDecoration: 'none' }}>
              Go to My Goals
            </a>
          </div>
        </div>
      ) : (
        <div className="user-empty">
          <p>No active performance cycle found.</p>
          <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Administrators must configure a cycle before you can set goals.</p>
        </div>
      )}
    </div>
  )
}
