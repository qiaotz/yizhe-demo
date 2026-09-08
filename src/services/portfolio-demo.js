'use strict'

// A local presentation boundary. Route IDs and progress never identify a real user.
const tour = require('./product-tour')
const guide = require('./onboarding-guide')
const HOME = '/pages/showcase/index'
const STAGES = {
  '/pages/preview/index': 'preview',
  '/pages/preview/chapter': 'chapter',
  '/pkg-course/learning-check/index': 'previewCheck',
  '/pkg-course/classroom/index': 'classroom',
  '/pkg-question/answer/index': 'practice',
  '/pkg-question/wrong-case/index': 'correction',
  '/pkg-question/wrong-retest/index': 'retest',
  '/pages/review/index': 'review'
}
const TABS = new Set(['/pages/preview/index', '/pages/learning/index', '/pages/question/index', '/pages/wrong/index', '/pages/review/index'])
const TAB_TARGETS = { '/pages/learning/index': 'classroom', '/pages/question/index': 'practice', '/pages/wrong/index': 'correction' }
const RESUME_KEY = 'portfolio:last-surface'

function pathOf(url) {
  const value = String(url || '').replace(/^#/, '')
  return ('/' + value.replace(/^\/+/, '')).split(/[?#]/)[0]
}

function canonical(url) {
  const path = pathOf(url)
  if (path === HOME || path === '/pages/profile/index' || path === '/pages/auth/login') return HOME
  if (path === '/pkg-ai/query/index') return guide.route('classroom').url
  if (TAB_TARGETS[path]) return path
  if (path === '/pages/onboarding/index') return '/pages/onboarding/index?complete=1'
  const stage = STAGES[path]
  return stage ? guide.route(stage).url : HOME
}

function activate(url) {
  const route = canonical(url)
  const stage = STAGES[pathOf(route)]
  if (stage) {
    const state = tour.getState()
    if (state.phase !== 'demo' || !state.guideMode) tour.startDemo(guide.demo().source)
    guide.enter(stage)
    wx.setStorageSync(RESUME_KEY, stage)
  }
  return route
}

function prepareNavigation(url) {
  const state = globalThis.__YIZHE_PORTFOLIO__ || {}
  let safe = canonical(url)
  if (state.exitToOverview) {
    state.exitToOverview = false
    safe = HOME
  }
  activate(safe)
  return { url: safe, method: safe === HOME ? 'reLaunch' : TABS.has(pathOf(safe)) ? 'switchTab' : 'navigateTo' }
}

function bootstrap() {
  const hash = typeof location !== 'undefined' ? location.hash : ''
  activate(hash || HOME)
}

function optionsFor(url) {
  const query = canonical(url).split('?')[1] || ''
  const params = {}
  query.split('&').filter(Boolean).forEach(pair => {
    const parts = pair.split('=')
    params[decodeURIComponent(parts[0])] = decodeURIComponent(parts.slice(1).join('='))
  })
  return params
}

// Page lifecycles also run when browser Back bypasses wx navigation wrappers.
function wrapPage(route, definition) {
  const onLoad = definition.onLoad
  const onShow = definition.onShow
  return Object.assign({}, definition, {
    onLoad() {
      activate(route)
      if (onLoad) return onLoad.call(this, optionsFor(route))
    },
    onShow() {
      activate(route)
      if (onShow) return onShow.call(this)
    }
  })
}

function open(stage) {
  const target = guide.route(stage)
  activate(target.url)
  return target.type === 'tab' ? wx.switchTab({ url: target.url }) : wx.navigateTo({ url: target.url })
}

function start() {
  tour.restart()
  tour.startDemo(guide.demo().source)
  return open('preview')
}

function home() { return wx.reLaunch({ url: HOME }) }
function resume() {
  const stage = wx.getStorageSync(RESUME_KEY)
  return open(Object.values(STAGES).includes(stage) ? stage : 'preview')
}
function reset() {
  // clearStorageSync is replaced by the runtime with a prefix-scoped clear.
  wx.clearStorageSync()
  tour.restart()
  return home()
}

globalThis.__YIZHE_PORTFOLIO__ = Object.assign(globalThis.__YIZHE_PORTFOLIO__ || {}, { prepareNavigation, home, start, open, reset })
module.exports = { HOME, STAGES, canonical, activate, prepareNavigation, bootstrap, wrapPage, open, start, home, resume, reset, RESUME_KEY }
