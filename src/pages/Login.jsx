import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  signInWithEmail,
  signUpWithEmail,
  sendPasswordReset,
  signInWithMicrosoft,
} from '../lib/auth'
import './Login.css'

// Microsoft logo SVG (official colours)
function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
      <rect x="1"  y="1"  width="9" height="9" fill="#f25022" />
      <rect x="11" y="1"  width="9" height="9" fill="#7fba00" />
      <rect x="1"  y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

// ── Views: login | signup | forgot ───────────────────────────────────────────
const VIEWS = { LOGIN: 'login', SIGNUP: 'signup', FORGOT: 'forgot' }

export default function Login() {
  const navigate = useNavigate()

  const [view,     setView]     = useState(VIEWS.LOGIN)
  const [loading,  setLoading]  = useState(false)
  const [msLoading, setMsLoading] = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')

  // Form fields
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [name,     setName]     = useState('')

  function clearMessages() { setError(''); setSuccess('') }

  function switchView(v) { clearMessages(); setView(v) }

  // ── Email sign-in ──────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const result = await signInWithEmail(email, password)
      if (result.requiresMfa) {
        navigate('/verify-mfa')
      } else {
        navigate('/dashboard')
      }
    } catch (err) {
      setError(err.message ?? 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  // ── Email sign-up ──────────────────────────────────────────────────────────
  async function handleSignup(e) {
    e.preventDefault()
    clearMessages()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      await signUpWithEmail(email, password, name)
      setSuccess('Account created! Check your email to confirm before logging in.')
      setView(VIEWS.LOGIN)
    } catch (err) {
      setError(err.message ?? 'Sign-up failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot password ────────────────────────────────────────────────────────
  async function handleForgot(e) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      await sendPasswordReset(email)
      setSuccess('Password reset email sent! Check your inbox.')
    } catch (err) {
      setError(err.message ?? 'Could not send reset email.')
    } finally {
      setLoading(false)
    }
  }

  // ── Microsoft SSO ──────────────────────────────────────────────────────────
  async function handleMicrosoft() {
    clearMessages()
    setMsLoading(true)
    try {
      await signInWithMicrosoft()
      // Supabase redirects to /auth/callback — loading stays true until redirect
    } catch (err) {
      setError(err.message ?? 'Microsoft sign-in failed.')
      setMsLoading(false)
    }
  }

  // ── Shared Microsoft button (shown in login + signup) ──────────────────────
  function MicrosoftButton() {
    return (
      <>
        <div className="auth-divider">or continue with</div>
        <button
          id="btn-microsoft-sso"
          type="button"
          className="btn-microsoft"
          onClick={handleMicrosoft}
          disabled={msLoading || loading}
        >
          {msLoading
            ? <span className="spinner spinner-dark" />
            : <MicrosoftLogo />}
          Sign in with Microsoft
        </button>
      </>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="auth-page">

      {/* ── Left brand panel ── */}
      <div className="auth-brand">
        <div className="brand-logo">
          <div className="brand-logo-icon">🎯</div>
          <span className="brand-logo-name">GoalFlow</span>
        </div>
        <div className="brand-tagline">
          <h1>Track goals that <span>actually matter</span></h1>
          <p>
            A structured goal-setting and performance portal that keeps every
            employee, manager, and team aligned — from creation to quarterly check-in.
          </p>
        </div>
        <div className="brand-features">
          {[
            'Set and approve goals with full audit trail',
            'Quarterly check-ins with computed progress scores',
            'Shared departmental KPIs across your team',
            'Microsoft Teams bot for instant updates',
          ].map(f => (
            <div className="brand-feature" key={f}>
              <div className="brand-feature-dot" />
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="auth-panel">
        <div className="auth-card">

          {/* ── Forgot password view ── */}
          {view === VIEWS.FORGOT && (
            <>
              <h2 className="auth-card-title">Reset password</h2>
              <p className="auth-card-subtitle">
                Enter your work email and we'll send a reset link.
              </p>

              {error   && <div className="auth-error"   role="alert">{error}</div>}
              {success && <div className="auth-success" role="status">{success}</div>}

              <form onSubmit={handleForgot} noValidate>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="forgot-email">Work email</label>
                  <input
                    id="forgot-email"
                    className="auth-input"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoFocus
                    placeholder="you@company.com"
                  />
                </div>

                <button
                  id="btn-send-reset"
                  type="submit"
                  className="btn-primary"
                  disabled={loading || !email}
                >
                  {loading ? <span className="spinner" /> : 'Send reset link'}
                </button>
              </form>

              <div className="auth-divider" />
              <button
                id="btn-back-to-login"
                type="button"
                className="btn-microsoft"
                onClick={() => switchView(VIEWS.LOGIN)}
              >
                ← Back to sign in
              </button>
            </>
          )}

          {/* ── Login + Signup tabs ── */}
          {view !== VIEWS.FORGOT && (
            <>
              <h2 className="auth-card-title">
                {view === VIEWS.LOGIN ? 'Welcome back' : 'Create account'}
              </h2>
              <p className="auth-card-subtitle">
                {view === VIEWS.LOGIN
                  ? 'Sign in to your GoalFlow workspace.'
                  : 'Get started with GoalFlow today.'}
              </p>

              <div className="auth-tabs" role="tablist">
                <button
                  id="tab-login"
                  role="tab"
                  className={`auth-tab ${view === VIEWS.LOGIN ? 'active' : ''}`}
                  onClick={() => switchView(VIEWS.LOGIN)}
                >
                  Sign in
                </button>
                <button
                  id="tab-signup"
                  role="tab"
                  className={`auth-tab ${view === VIEWS.SIGNUP ? 'active' : ''}`}
                  onClick={() => switchView(VIEWS.SIGNUP)}
                >
                  Sign up
                </button>
              </div>

              {error   && <div className="auth-error"   role="alert">{error}</div>}
              {success && <div className="auth-success" role="status">{success}</div>}

              {/* ── Login form ── */}
              {view === VIEWS.LOGIN && (
                <form onSubmit={handleLogin} noValidate>
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="login-email">Email</label>
                    <input
                      id="login-email"
                      className="auth-input"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      autoFocus
                      placeholder="you@company.com"
                    />
                  </div>

                  <div className="auth-field">
                    <label className="auth-label" htmlFor="login-password">Password</label>
                    <input
                      id="login-password"
                      className="auth-input"
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                    />
                  </div>

                  <div className="auth-forgot">
                    <button
                      id="btn-forgot-password"
                      type="button"
                      onClick={() => switchView(VIEWS.FORGOT)}
                    >
                      Forgot password?
                    </button>
                  </div>

                  <button
                    id="btn-login-submit"
                    type="submit"
                    className="btn-primary"
                    disabled={loading || !email || !password}
                  >
                    {loading ? <span className="spinner" /> : 'Sign in'}
                  </button>

                  <MicrosoftButton />
                </form>
              )}

              {/* ── Signup form ── */}
              {view === VIEWS.SIGNUP && (
                <form onSubmit={handleSignup} noValidate>
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="signup-name">Full name</label>
                    <input
                      id="signup-name"
                      className="auth-input"
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      required
                      autoFocus
                      placeholder="Rahul Sharma"
                    />
                  </div>

                  <div className="auth-field">
                    <label className="auth-label" htmlFor="signup-email">Work email</label>
                    <input
                      id="signup-email"
                      className="auth-input"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="you@company.com"
                    />
                  </div>

                  <div className="auth-field">
                    <label className="auth-label" htmlFor="signup-password">Password</label>
                    <input
                      id="signup-password"
                      className="auth-input"
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder="Min. 8 characters"
                    />
                  </div>

                  <button
                    id="btn-signup-submit"
                    type="submit"
                    className="btn-primary"
                    disabled={loading || !email || !password || !name}
                  >
                    {loading ? <span className="spinner" /> : 'Create account'}
                  </button>

                  <MicrosoftButton />
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
