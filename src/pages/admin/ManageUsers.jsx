import { useState, useEffect, useCallback } from 'react'
import AdminLayout from '../../layouts/AdminLayout'
import { getAllUsers, updateUserRole, updateUserManager } from '../../lib/adminApi'
import { logEvent } from '../../lib/userApi'
import { useApp } from '../../lib/AppContext'

const ROLES = ['employee', 'manager', 'admin']

export default function ManageUsers() {
  const { me } = useApp()
  const [users,   setUsers]   = useState([])
  const [search,  setSearch]  = useState('')
  const [filter,  setFilter]  = useState('all')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await getAllUsers()
    setUsers(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleRoleChange(userId, role) {
    await updateUserRole(userId, role)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u))
  }

  async function handleManagerChange(userId, managerId) {
    const targetUser = users.find(u => u.id === userId)
    const oldManagerId = targetUser?.manager_id

    await updateUserManager(userId, managerId || null)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, manager_id: managerId || null } : u))

    await logEvent({
      action: 'CHANGE_MANAGER',
      actorId: userId, // Subject employee
      fieldChanged: 'manager_id',
      oldValue: oldManagerId,
      newValue: managerId || null,
      description: `Admin updated reporting line: Manager changed for ${targetUser?.name || 'employee'}`
    })
  }

  const managers = users.filter(u => u.role === 'manager' || u.role === 'admin')

  const filtered = users.filter(u => {
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || u.role === filter
    return matchSearch && matchFilter
  })

  return (
    <AdminLayout>
      <div className="admin-page-header">
        <h1 className="admin-page-title">Users</h1>
        <p className="admin-page-subtitle">Manage roles and reporting lines</p>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <input
          id="user-search"
          className="admin-input"
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select id="user-role-filter" className="admin-select" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All roles</option>
          {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}s</option>)}
        </select>
        <div style={{ fontSize: '0.82rem', color: '#9ca3af', alignSelf: 'center' }}>
          {filtered.length} of {users.length} users
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Reports to</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem' }}>Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={5} className="admin-empty">No users match your search</td></tr>
            )}
            {!loading && filtered.map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600, color: '#111827' }}>{u.name}</td>
                <td style={{ color: '#6b7280', fontSize: '0.82rem' }}>{u.email}</td>
                <td>
                  {(u.role === 'admin' || u.id === me?.id) ? (
                    <span className="badge badge-approved" style={{ textTransform: 'capitalize', padding: '0.45rem 0.9rem', fontSize: '0.82rem', fontWeight: 700 }}>
                      🛡️ {u.role}
                    </span>
                  ) : (
                    <select
                      id={`role-${u.id}`}
                      className="admin-select"
                      value={u.role}
                      onChange={e => handleRoleChange(u.id, e.target.value)}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </td>
                <td>
                  <select
                    id={`manager-${u.id}`}
                    className="admin-select"
                    value={u.manager_id ?? ''}
                    onChange={e => handleManagerChange(u.id, e.target.value)}
                  >
                    <option value="">— No manager —</option>
                    {managers
                      .filter(m => m.id !== u.id)
                      .map(m => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)
                    }
                  </select>
                </td>
                <td style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                  {new Date(u.created_at).toLocaleDateString('en-IN')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  )
}
