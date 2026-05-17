export function calculateProgressScore(uomType, targetStr, actualStr, actualDateStr, targetDateStr) {
  const target = Number(targetStr)
  const actual = Number(actualStr)
  
  let score = 0
  
  if (uomType === 'timeline') {
    if (!targetDateStr || !actualDateStr) return 0
    const targetDate = new Date(targetDateStr)
    const actualDate = new Date(actualDateStr)
    if (actualDate <= targetDate) score = 100
    else score = 0 // simple logic for timeline
  } else if (uomType === 'zero_based') {
    score = actual === 0 ? 100 : 0
  } else if (uomType.includes('_min')) {
    if (target === 0) return 0
    score = (actual / target) * 100
  } else if (uomType.includes('_max')) {
    if (actual === 0 && target > 0) return 100 // completed perfectly
    if (actual === 0) return 0
    score = (target / actual) * 100
  }
  
  return Math.min(100, Math.max(0, score)) // cap between 0-100
}
