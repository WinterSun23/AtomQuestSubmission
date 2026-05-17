import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { updatePassword } from '../lib/auth'
import './Login.css'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState('')
  const [ready,     setReady]     = useState(false)

  // Supabase appends the recovery token to the URL hash.
  // onAuthStateChange fires with event='PASSWORD_RECOVERY' when it detects it.
  // The session is then set automatically so updateUser() works.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
      } else if (!session) {
        // No valid recovery session — redirect to login
        navigate('/login', { replace: true })
      }
    })
    return () => subscription.unsubscribe()
  }, [navigate])

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await updatePassword(password)
      setSuccess('Password updated! Redirecting to login…')
      setTimeout(() => navigate('/login', { replace: true }), 2000)
    } catch (err) {
      setError(err.message ?? 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  // Still waiting for the PASSWORD_RECOVERY event
  if (!ready) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Inter, sans-serif', gap: '1rem', color: '#6b7280',
      }}>
        <div style={{
          width: 36, height: 36,
          border: '3px solid #e5e7eb', borderTopColor: '#6366f1',
          borderRadius: '50%', animation: 'spin 0.7s linear infinite',
        }} />
        <p style={{ margin: 0 }}>Verifying reset link…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="brand-logo">
          <div className="brand-logo-icon">🎯</div>
          <span className="brand-logo-name">GoalFlow</span>
        </div>
        <div className="brand-tagline">
          <h1>Set a new <span>password</span></h1>
          <p>Choose a strong password for your GoalFlow account.</p>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <h2 className="auth-card-title">Reset your password</h2>
          <p className="auth-card-subtitle">Enter and confirm your new password below.</p>

          {error   && <div className="auth-error"   role="alert">{error}</div>}
          {success && <div className="auth-success" role="status">{success}</div>}

          <form onSubmit={handleReset} noValidate>
            <div className="auth-field">
              <label className="auth-label" htmlFor="reset-password">New password</label>
              <input
                id="reset-password"
                className="auth-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                autoFocus
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="reset-confirm">Confirm password</label>
              <input
                id="reset-confirm"
                className="auth-input"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat your new password"
                required
              />
            </div>

            <button
              id="btn-reset-submit"
              type="submit"
              className="btn-primary"
              disabled={loading || !password || !confirm}
            >
              {loading ? <span className="spinner" /> : 'Update password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
