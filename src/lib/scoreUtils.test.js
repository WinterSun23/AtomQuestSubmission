import { describe, it, expect } from 'vitest'
import { calculateProgressScore } from './scoreUtils'

describe('Progress Score Engine', () => {
  it('calculates numeric_min correctly', () => {
    // Target: 100, Actual: 80 => 80%
    expect(calculateProgressScore('numeric_min', '100', '80')).toBe(80)
    // Target: 100, Actual: 150 => capped at 100%
    expect(calculateProgressScore('numeric_min', '100', '150')).toBe(100)
  })

  it('calculates numeric_max correctly', () => {
    // Target: 5 days, Actual: 4 days => 125% -> capped to 100%
    expect(calculateProgressScore('numeric_max', '5', '4')).toBe(100)
    // Target: 5, Actual: 10 => 50%
    expect(calculateProgressScore('numeric_max', '5', '10')).toBe(50)
  })

  it('calculates timeline correctly', () => {
    // Completed on or before target date
    expect(calculateProgressScore('timeline', null, null, '2026-07-20', '2026-07-31')).toBe(100)
    // Completed after target date
    expect(calculateProgressScore('timeline', null, null, '2026-08-05', '2026-07-31')).toBe(0)
  })

  it('calculates zero_based correctly', () => {
    expect(calculateProgressScore('zero_based', '0', '0')).toBe(100)
    expect(calculateProgressScore('zero_based', '0', '2')).toBe(0)
  })
})
