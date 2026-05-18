import React, { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'
import { getActiveCycle, getQuarterFixedDates } from './userApi'

const AppContext = createContext(null)

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}

export function AppProvider({ children }) {
  const [me, setMe] = useState(null)
  const [activeCycle, setActiveCycle] = useState(null)
  const [activeWindow, setActiveWindow] = useState(null)
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // 1. Core Bootstrapping Function
  async function loadAllData() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setMe(null)
        setActiveCycle(null)
        setActiveWindow(null)
        setSettings({})
        setLoading(false)
        return
      }

      // Fetch user profile from database
      const profilePromise = supabase
        .from('users')
        .select(`
          id, auth_id, name, email, role, manager_id
        `)
        .eq('auth_id', session.user.id)
        .maybeSingle()

      // Fetch active cycle
      const cyclePromise = getActiveCycle()

      // Fetch settings
      const settingsPromise = supabase.from('app_settings').select('*')

      const [profileRes, activeCycleData, settingsRes] = await Promise.all([
        profilePromise,
        cyclePromise,
        settingsPromise
      ])

      if (profileRes.error) throw profileRes.error
      if (settingsRes.error) throw settingsRes.error

      const profile = profileRes.data
      setMe(profile)
      setActiveCycle(activeCycleData)

      // Decode settings array to key-value object
      const settingsMap = {}
      if (settingsRes.data) {
        settingsRes.data.forEach(s => {
          settingsMap[s.key] = s.value
        })
      }
      setSettings(settingsMap)

      // Resolve Active Check-In Window for active cycle if cycle exists
      if (activeCycleData) {
        const override = settingsMap['active_quarter_override']
        const auto = settingsMap['auto_active_quarter']
        const currentQ = override && override !== 'auto' && override !== '' ? override : (auto || 'phase1')

        if (currentQ === 'phase1') {
          setActiveWindow(null)
        } else {
          let { data: windows, error: winErr } = await supabase
            .from('check_in_windows')
            .select('*')
            .eq('cycle_id', activeCycleData.id)
            .eq('quarter', currentQ)
            .order('window_open', { ascending: false })
            .limit(1)

          if (winErr) throw winErr
          let win = windows?.[0] || null

          // Auto-create quarterly window if it doesn't exist yet
          if (!win) {
            const dates = getQuarterFixedDates(currentQ)
            const { data: newWin, error: insertErr } = await supabase
              .from('check_in_windows')
              .insert({
                cycle_id: activeCycleData.id,
                quarter: currentQ,
                window_open: dates.open,
                window_close: dates.close
              })
              .select()
              .single()

            if (!insertErr) {
              win = newWin
            }
          }
          setActiveWindow(win)
        }
      } else {
        setActiveWindow(null)
      }

      setError(null)
    } catch (err) {
      console.error('[AppContext] Bootstrapping failed:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // 2. Real-Time Syncing on Auth and Table updates
  useEffect(() => {
    // Initial fetch
    loadAllData()

    // Listen to session changes
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log(`[AppContext] Auth event: ${event}`)
      if (event === 'SIGNED_IN') {
        loadAllData()
      } else if (event === 'SIGNED_OUT') {
        setMe(null)
        setActiveCycle(null)
        setActiveWindow(null)
        setSettings({})
        setLoading(false)
      }
    })

    // Listen to Real-Time DB changes (app_settings, cycles, and logged-in user profile changes)
    const settingsSub = supabase
      .channel('realtime-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, () => {
        console.log('[AppContext] Realtime: App settings changed, reloading...')
        loadAllData()
      })
      .subscribe()

    const cyclesSub = supabase
      .channel('realtime-cycles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cycles' }, () => {
        console.log('[AppContext] Realtime: Cycles changed, reloading...')
        loadAllData()
      })
      .subscribe()

    return () => {
      authListener.subscription.unsubscribe()
      supabase.removeChannel(settingsSub)
      supabase.removeChannel(cyclesSub)
    }
  }, [])

  // Expose manual reload helper
  const refreshApp = () => {
    setLoading(true)
    loadAllData()
  }

  const isGoalSubmissionWindowOpen = () => {
    const override = settings['goal_window_open']
    if (override === 'true') return true
    if (override === 'false') return false

    // Auto calendar mode: May 1st to June 30th
    const month = new Date().getMonth() + 1 // 1-12
    return month === 5 || month === 6
  }

  const maxGoalsPerSheet = Number(settings['max_goals_per_sheet'] || 8)
  const minGoalWeightage = Number(settings['min_goal_weightage'] || 10)

  const value = {
    me,
    activeCycle,
    activeWindow,
    settings,
    loading,
    error,
    refreshApp,
    isGoalSubmissionWindowOpen,
    maxGoalsPerSheet,
    minGoalWeightage
  }

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  )
}
