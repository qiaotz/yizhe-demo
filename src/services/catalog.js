const DIRECTION_RULES = Object.freeze([
  Object.freeze({ code: '306', shortName: '西医', name: '临床医学综合能力（西医）', status: 'OPEN' }),
  Object.freeze({ code: '307', shortName: '中医', name: '临床医学综合能力（中医）', status: 'PREPARING' })
])

function ruleFor(code) {
  return DIRECTION_RULES.find((item) => item.code === String(code || '')) || DIRECTION_RULES[0]
}

function normalizeDirection(direction) {
  const source = direction && typeof direction === 'object' ? direction : {}
  const matchedRule = DIRECTION_RULES.find((item) => item.code === String(source.code || ''))
  const rule = matchedRule || ruleFor()
  const status = source.status === 'OPEN' || source.status === 'PREPARING' ? source.status : rule.status
  return {
    code: rule.code,
    shortName: rule.shortName,
    name: matchedRule && typeof source.name === 'string' && source.name.trim() ? source.name.trim() : rule.name,
    status
  }
}

function catalogStatus(group, fallbackStatus) {
  if (!group || typeof group !== 'object' || !Object.keys(group).length) return fallbackStatus
  const questionCount = Math.max(0, Number(group.questionCount || 0))
  return group.publicationState === 'PUBLIC' && group.availability === 'AVAILABLE' && questionCount > 0
    ? 'OPEN'
    : 'PREPARING'
}

function publicDirections(groups) {
  const source = Array.isArray(groups) ? groups : []
  return DIRECTION_RULES.map((rule) => {
    const group = source.find((item) => String(item && item.code) === rule.code) || {}
    const status = catalogStatus(group, rule.status)
    const subjects = Array.isArray(group.subjects) ? group.subjects.map((subject) => Object.assign({}, subject, {
      questionCount: status === 'OPEN' ? Math.max(0, Number(subject.questionCount || 0)) : 0
    })) : []
    const questionCount = status === 'OPEN' ? Math.max(0, Number(group.questionCount || 0)) : 0
    return Object.assign({}, group, {
      code: rule.code,
      shortName: rule.shortName,
      name: typeof group.name === 'string' && group.name.trim() ? group.name.trim() : rule.name,
      status,
      publicationState: status === 'OPEN' ? 'PUBLIC' : 'PREPARING',
      availability: status === 'OPEN' ? 'AVAILABLE' : 'PREPARING',
      questionCount,
      subjects
    })
  })
}

function isOpenDirection(direction) {
  return !!direction && normalizeDirection(direction).status === 'OPEN'
}

module.exports = { DIRECTION_RULES, normalizeDirection, publicDirections, isOpenDirection }
