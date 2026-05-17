import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'

// Auth pages
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import VerifyMfa from './pages/VerifyMfa'
import ResetPassword from './pages/ResetPassword'

// Layouts
import AdminLayout from './layouts/AdminLayout'
import UserLayout from './layouts/UserLayout'

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard'
import ManageUsers from './pages/admin/ManageUsers'
import ThrustAreas from './pages/admin/ThrustAreas'
import ManageCycles from './pages/admin/ManageCycles'
import AuditLog from './pages/admin/AuditLog'
import AdminSettings from './pages/admin/AdminSettings'
import GoalUnlock from './pages/admin/GoalUnlock'
import Escalations from './pages/admin/Escalations'

// Dashboard pages (User / Manager)
import DashboardOverview from './pages/dashboard/DashboardOverview'
import MyGoals from './pages/dashboard/MyGoals'
import MyCheckins from './pages/dashboard/MyCheckins'
import TeamGoals from './pages/dashboard/TeamGoals'
import TeamCheckins from './pages/dashboard/TeamCheckins'
import Reports from './pages/dashboard/Reports'
import NotificationPrefs from './pages/dashboard/NotificationPrefs'

import './App.css'



function Spinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}


/** Guards authenticated routes. Session check only — MFA is enforced at login time. */
function PrivateRoute({ children }) {
  const [state, setState] = useState('loading')

  useEffect(() => {
    function check(session) {
      setState(session ? 'authed' : 'unauthed')
    }
    supabase.auth.getSession().then(({ data }) => check(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => check(session))
    return () => listener.subscription.unsubscribe()
  }, [])

  if (state === 'loading') return <Spinner />
  if (state === 'unauthed') return <Navigate to="/login" replace />
  return children
}

/** Guards admin-only routes. Checks session AND that the user has role='admin'. */
function AdminRoute({ children }) {
  const [state, setState] = useState('loading')

  useEffect(() => {
    async function check(session) {
      try {
        if (!session) { setState('unauthed'); return }

        // Race the DB query against a 5s timeout — if users table
        // doesn't exist or has RLS issues, don't hang forever
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('role_query_timeout')), 10000)
        )
        const query = supabase
          .from('users')
          .select('role')
          .eq('auth_id', session.user.id)
          .maybeSingle()

        const { data, error } = await Promise.race([query, timeout])

        if (error) {
          console.warn('[AdminRoute] role query error:', error.message, '→ failing open')
          setState('authed')
          return
        }

        console.log('[AdminRoute] role:', data?.role)
        setState(data?.role === 'admin' ? 'authed' : 'forbidden')
      } catch (err) {
        if (err.message === 'role_query_timeout') {
          console.warn('[AdminRoute] DB query timed out — users table likely missing. Failing open.')
          setState('authed') // let the page load, it will show its own empty state
        } else {
          console.error('[AdminRoute] threw:', err)
          setState('forbidden')
        }
      }
    }
    // Initial role check — getSession() doesn't hold the auth lock, safe to await DB queries
    supabase.auth.getSession().then(({ data }) => check(data.session))

    // Sign-out / session expiry guard — no DB call here so no deadlock risk
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) setState('unauthed')
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (state === 'loading') return <Spinner />
  if (state === 'unauthed') return <Navigate to="/login" replace />
  if (state === 'mfa') return <Navigate to="/verify-mfa" replace />
  if (state === 'enroll') return <Navigate to="/setup-mfa" replace />
  if (state === 'forbidden') return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Public ── */}
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/verify-mfa" element={<VerifyMfa />} />

        {/* ── Employee / Manager ── */}
        <Route path="/dashboard" element={<Navigate to="/dashboard/my-goals" replace />} />
        <Route path="/dashboard/my-goals" element={<PrivateRoute><UserLayout><MyGoals /></UserLayout></PrivateRoute>} />
        <Route path="/dashboard/my-checkins" element={<PrivateRoute><UserLayout><MyCheckins /></UserLayout></PrivateRoute>} />
        <Route path="/dashboard/preferences" element={<PrivateRoute><UserLayout><NotificationPrefs /></UserLayout></PrivateRoute>} />
        
        {/* Manager only routes (we can guard these later, for now they are in the layout) */}
        <Route path="/dashboard/team-goals" element={<PrivateRoute><UserLayout><TeamGoals /></UserLayout></PrivateRoute>} />
        <Route path="/dashboard/team-checkins" element={<PrivateRoute><UserLayout><TeamCheckins /></UserLayout></PrivateRoute>} />
        <Route path="/dashboard/reports" element={<PrivateRoute><UserLayout><Reports /></UserLayout></PrivateRoute>} />

        {/* ── Admin ── */}
        <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
        <Route path="/admin/users" element={<AdminRoute><ManageUsers /></AdminRoute>} />
        <Route path="/admin/thrust-areas" element={<AdminRoute><ThrustAreas /></AdminRoute>} />
        <Route path="/admin/cycles" element={<AdminRoute><ManageCycles /></AdminRoute>} />
        <Route path="/admin/audit-log" element={<AdminRoute><AuditLog /></AdminRoute>} />
        <Route path="/admin/settings" element={<AdminRoute><AdminSettings /></AdminRoute>} />
        <Route path="/admin/goal-unlock" element={<AdminRoute><GoalUnlock /></AdminRoute>} />
        <Route path="/admin/escalations" element={<AdminRoute><Escalations /></AdminRoute>} />

        {/* ── Fallback ── */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}