'use strict'

const STORAGE_KEY = 'portfolio-tour:v1'
const VERSION = 'portfolio-demo-v1'

function initialState() {
  return {
    version: VERSION,
    contentVersion: '',
    payloadHash: '',
    phase: 'intro',
    guideMode: false,
    surface: 'intro',
    runId: '',
    demoStep: 0,
    subjectSelected: false,
    chapterSelected: false,
    lessonSelected: false,
    cardSelected: false,
    previewAnswered: false,
    classroomAnswered: false,
    aiCompleted: false,
    correctionPhase: 'reason',
    correctionReason: '',
    reviewRevealed: false,
    reviewRating: '',
    videoSeconds: 0,
    videoCompleted: false,
    outcome: '',
    updatedAt: Date.now()
  }
}

function readRaw() {
  try { return wx.getStorageSync(STORAGE_KEY) || null } catch (error) { return null }
}

function write(state) {
  const next = Object.assign({}, state, { version: VERSION, updatedAt: Date.now() })
  try { wx.setStorageSync(STORAGE_KEY, next) } catch (error) {}
  return next
}

function normalize(value) {
  const raw = value && typeof value === 'object' ? value : {}
  if (raw.version !== VERSION) return initialState()
  const phase = ['intro', 'demo', 'done'].includes(raw.phase) ? raw.phase : 'intro'
  const demoStep = Math.max(0, Math.min(9, Number(raw.demoStep || 0)))
  const videoSeconds = Number(raw.videoSeconds)
  return Object.assign(initialState(), raw, {
    version: VERSION,
    phase,
    demoStep,
    videoSeconds: Number.isFinite(videoSeconds) && videoSeconds >= 0 ? videoSeconds : 0,
    videoCompleted: raw.videoCompleted === true
  })
}

function getState() {
  const raw = readRaw()
  const state = normalize(raw)
  if (!raw || raw.version !== VERSION) write(state)
  return state
}

function update(patch) {
  return write(Object.assign({}, getState(), patch || {}))
}

function restart() {
  return write(initialState())
}

function previewRestart() {
  return initialState()
}

function startDemo(binding) {
  const source = binding && typeof binding === 'object' ? binding : {}
  return update({
    phase: 'demo',
    guideMode: true,
    surface: 'preview',
    runId: `guide-${Date.now()}`,
    demoStep: 0,
    outcome: '',
    contentVersion: String(source.contentVersion || ''),
    payloadHash: String(source.payloadHash || '')
  })
}

function saveDemoProgress(patch) {
  return update(Object.assign({ phase: 'demo' }, patch || {}))
}

function saveVideoProgress(seconds, completed) {
  const state = getState()
  const currentSeconds = Number(seconds)
  if (state.phase !== 'intro' || !Number.isFinite(currentSeconds) || currentSeconds < 0) return state
  return write(Object.assign({}, state, {
    videoSeconds: currentSeconds,
    videoCompleted: state.videoCompleted || completed === true
  }))
}

function complete(outcome) {
  return update({ phase: 'done', guideMode: false, surface: 'complete', demoStep: 9, outcome: outcome || 'completed' })
}

function skipAll() {
  return complete('skipped')
}

function isPending() {
  return getState().phase !== 'done'
}

module.exports = {
  STORAGE_KEY,
  VERSION,
  getState,
  update,
  restart,
  previewRestart,
  startDemo,
  saveDemoProgress,
  saveVideoProgress,
  complete,
  skipAll,
  isPending
}

