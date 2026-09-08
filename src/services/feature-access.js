const { api } = require('./api')
const { hasToken } = require('./auth')

let cached = null
let pending = null

const FAIL_CLOSED = { P0_CORE: true, COMPLETE_EXAM_V4: false, OCR_V4: false, TTS_V4: false, AI_NOTE_DRAFT_V4: false, AI_WRONG_REASON_V4: false, ACTIVE_RECALL_V4: false, AI_RECALL_FOLLOWUP_V4: false, MEMORY_CARDS_V4: false, ENHANCED_REPORT_V4: false, PLAN_INTENSITY_V4: false, MOCK_EXAM_DAY_V4: false, TEST_ENTITLEMENTS_V4: false, EXPIRY_DOWNGRADE_V4: false, AUTHORIZED_OFFLINE_PACKAGES_V4: false, MOCK_EXAM: false, SMART_EXAM: false, MEMBERSHIP_COMMERCE: false, POINTS_REDEMPTION: false, REAL_PAYMENT: false }

function load(force) {
  if (!hasToken()) return Promise.resolve(Object.assign({}, FAIL_CLOSED))
  if (cached && !force) return Promise.resolve(cached)
  if (pending && !force) return pending
  pending = api.getBetaEntitlements().then((body) => {
    cached = Object.assign({}, FAIL_CLOSED, body && body.featureFlags || {})
    return cached
  }).finally(() => { pending = null })
  return pending
}

function pageGate(page, featureCode) {
  page.setData({ featureState: 'loading' })
  return load().then((flags) => {
    const allowed = flags[featureCode] === true
    page.setData({ featureState: allowed ? 'ready' : 'unavailable' })
    return allowed
  }).catch(() => {
    page.setData({ featureState: 'service' })
    return false
  })
}

function reset() { cached = null; pending = null }

module.exports = { load, pageGate, reset }
