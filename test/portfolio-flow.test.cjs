'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_ROOT = path.join(ROOT, 'src')
const plain = value => JSON.parse(JSON.stringify(value))

async function fixture() {
  // Exercise the real scoped runtime API while retaining unrelated host state.
  const { createScopedStorage, STORAGE_PREFIX } = await import(pathToFileURL(path.join(ROOT, 'portfolio-runtime-policy.js')).href)
  const backing = new Map([['unrelated', 'keep'], ['__weapp_vite_web_storage__:accessToken', 'private-existing-session']])
  const counts = { rawClear: 0, scopedClear: 0, businessCalls: 0 }
  const hostStorage = {
    get length() { return backing.size },
    key(index) { return [...backing.keys()][index] ?? null },
    getItem(key) { return backing.get(key) ?? null },
    setItem(key, value) { backing.set(key, value) },
    removeItem(key) { backing.delete(key) },
    clear() { counts.rawClear += 1; throw new Error('Raw host clear is forbidden') },
  }
  const scoped = createScopedStorage(hostStorage).api
  const navigations = []
  const forbiddenTransport = () => { counts.businessCalls += 1; throw new Error('Business transport reached from local demonstration') }
  const wx = Object.assign({}, scoped, {
    clearStorageSync() { counts.scopedClear += 1; return scoped.clearStorageSync() },
    navigateTo(options) { navigations.push({ method: 'navigateTo', ...plain(options) }) },
    switchTab(options) { navigations.push({ method: 'switchTab', ...plain(options) }) },
    reLaunch(options) { navigations.push({ method: 'reLaunch', ...plain(options) }) },
    navigateBack() { navigations.push({ method: 'navigateBack' }) },
    hideTabBar() {}, showTabBar() {}, showToast() {},
    request: forbiddenTransport,
    cloud: { callContainer: forbiddenTransport, uploadFile: forbiddenTransport },
  })
  let definition = null
  let timerId = 0
  const context = vm.createContext({
    wx, console, location: { hash: '' },
    localStorage: hostStorage,
    setTimeout() { return ++timerId }, clearTimeout() {},
    setInterval() { return ++timerId }, clearInterval() {},
    getApp: () => ({ globalData: { token: '', networkOnline: true } }),
    getCurrentPages: () => [],
    Page(value) { definition = value },
  })
  const cache = new Map()
  function load(relativePath) {
    const filename = path.resolve(SOURCE_ROOT, relativePath)
    assert.ok(filename.startsWith(SOURCE_ROOT + path.sep), 'test loader only reads demonstration source')
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const localRequire = specifier => {
      assert.ok(specifier.startsWith('.'), `unexpected external CommonJS dependency: ${specifier}`)
      const resolved = path.resolve(path.dirname(filename), specifier)
      return load(path.relative(SOURCE_ROOT, path.extname(resolved) ? resolved : resolved + '.js'))
    }
    const factory = vm.runInContext(`(function (require, module, exports) {\n${fs.readFileSync(filename, 'utf8')}\n})`, context, { filename })
    factory(localRequire, module, module.exports)
    return module.exports
  }
  function page(route) {
    definition = null
    load(route.replace(/^\//, '') + '.js')
    assert.ok(definition, `${route} must register a page`)
    const instance = Object.assign({}, definition, {
      data: plain(definition.data || {}),
      setData(patch, done) { Object.assign(this.data, patch); if (done) done() },
      getTabBar() { return null },
      selectComponent() { return null },
    })
    return instance
  }
  const portfolio = load('services/portfolio-demo.js')
  const tour = load('services/product-tour.js')
  const guide = load('services/onboarding-guide.js')
  return { portfolio, tour, guide, load, page, context, wx, backing, navigations, counts, STORAGE_PREFIX }
}

test('canonical links discard foreign identifiers, credentials, mode overrides and fragments', async () => {
  const { portfolio, guide } = await fixture()
  const cases = [
    ['/pages/preview/chapter?guide=0&chapterId=987654', 'chapter'],
    ['/pkg-course/learning-check/index?id=real-user-check&type=validation&guide=0', 'previewCheck'],
    ['/pkg-course/classroom/index?externalUnitId=private&examGroupCode=999&token=old', 'classroom'],
    ['/pkg-question/answer/index?sessionId=real-user-session&mode=EXAM&questionId=123#token=old', 'practice'],
    ['/pkg-question/wrong-case/index?caseId=real-user-case&sourceSessionId=secret', 'correction'],
    ['/pkg-question/wrong-retest/index?caseId=real-user-case', 'retest'],
    ['#/pages/review/index?userId=123&accessToken=old', 'review'],
  ]
  for (const [input, stage] of cases) assert.equal(portfolio.canonical(input), guide.route(stage).url)
  for (const input of ['https://example.com/pages/preview/index', 'javascript:alert(1)', '/pkg-account/settings/index', '/pkg-question/exam-answer/index', '/pages/../private', '/%70ages/preview/index']) {
    assert.equal(portfolio.canonical(input), portfolio.HOME)
  }
})

test('a fresh detail deep link initializes only the matching local surface', async () => {
  const { portfolio, tour, guide, context, wx } = await fixture()
  context.location.hash = '#/pkg-question/wrong-case/index?caseId=foreign&guide=0'
  portfolio.bootstrap()
  const state = tour.getState()
  assert.equal(state.phase, 'demo')
  assert.equal(state.guideMode, true)
  assert.equal(state.surface, 'correction')
  assert.equal(state.contentVersion, guide.demo().source.contentVersion)
  assert.equal(wx.getStorageSync(portfolio.RESUME_KEY), 'correction')
  assert.equal(wx.getStorageSync('accessToken'), '')
})

test('wrapped lifecycles activate before original handlers and sanitize supplied options', async () => {
  const { portfolio, tour } = await fixture()
  const calls = []
  const receiver = { identity: 'page' }
  const page = portfolio.wrapPage('/pkg-question/answer/index', {
    onLoad(options) { calls.push({ context: this.identity, event: 'load', surface: tour.getState().surface, options }); return 12 },
    onShow() { calls.push({ context: this.identity, event: 'show', surface: tour.getState().surface }); return 34 },
  })
  assert.equal(page.onLoad.call(receiver, { sessionId: 'private', guide: '0', token: 'secret' }), 12)
  assert.deepEqual(plain(calls[0]), {
    context: 'page', event: 'load', surface: 'practice',
    options: { sessionId: 'guide-practice', mode: 'VALIDATION', guide: '1' },
  })
  tour.complete('exited')
  assert.equal(page.onShow.call(receiver), 34)
  assert.equal(calls[1].surface, 'practice')
  assert.equal(tour.getState().guideMode, true)
})

test('actual detail pages bootstrap into ready local data and survive Back after another stage', async () => {
  const routes = [
    ['/pages/preview/chapter', 'chapter'],
    ['/pkg-course/learning-check/index', 'previewCheck'],
    ['/pkg-course/classroom/index', 'classroom'],
    ['/pkg-question/answer/index', 'practice'],
    ['/pkg-question/wrong-case/index', 'correction'],
    ['/pkg-question/wrong-retest/index', 'retest'],
    ['/pages/review/index', 'review'],
  ]
  for (const [route, stage] of routes) {
    const fixtureState = await fixture()
    const { page, portfolio, tour, load, counts } = fixtureState
    // Any accidental fallback into the business API fails this flow test immediately.
    const api = load('services/api.js').api
    for (const name of Object.keys(api)) if (typeof api[name] === 'function') api[name] = () => { counts.businessCalls += 1; throw new Error(`Unexpected business call: ${name}`) }
    const actualPage = page(route)
    actualPage.onLoad({ guide: '0', sessionId: 'private', caseId: 'private' })
    actualPage.onShow?.()
    assert.equal(actualPage.data.guideMode, true, `${route} must display a local example`)
    assert.equal(actualPage.data.state, 'ready', `${route} must open without login or a business API`)
    portfolio.activate(stage === 'review' ? '/pages/preview/index' : '/pages/review/index')
    actualPage.onShow?.()
    assert.equal(tour.getState().surface, stage, `${route} must reactivate on browser Back`)
    assert.equal(actualPage.data.guideMode, true)
    assert.equal(counts.businessCalls, 0)
  }
})

test('exiting a guided step returns to overview once and preserves a resumable surface', async () => {
  const { portfolio, guide, tour, wx } = await fixture()
  portfolio.activate(guide.route('classroom').url)
  guide.exit('guide_exited')
  const exit = portfolio.prepareNavigation('/pages/preview/index')
  assert.equal(exit.url, portfolio.HOME)
  assert.equal(tour.getState().phase, 'done')
  assert.equal(wx.getStorageSync(portfolio.RESUME_KEY), 'classroom')
  const next = portfolio.prepareNavigation(guide.route('practice').url)
  assert.equal(next.url, guide.route('practice').url)
  assert.equal(tour.getState().surface, 'practice')
})

test('the actual showcase offers resume after leaving an unfinished walkthrough', async () => {
  const { portfolio, guide, page } = await fixture()
  portfolio.activate(guide.route('classroom').url)
  guide.exit('guide_exited')
  const showcase = page('/pages/showcase/index')
  showcase.onShow()
  assert.equal(showcase.data.canResume, true)
  assert.equal(showcase.data.completed, false, 'leaving the walkthrough is not completing it')
})

test('the actual completion receipt does not claim completion after an unfinished exit', async () => {
  const { portfolio, guide, tour, page } = await fixture()
  portfolio.activate(guide.route('classroom').url)
  guide.exit('guide_exited')
  const receipt = page('/pages/onboarding/index')
  receipt.onLoad({ complete: '1' })
  assert.equal(receipt.data.completed, false, 'a completion URL must not turn an exit into success')
  assert.equal(tour.getState().outcome, 'guide_exited')
})

test('resume accepts only local surfaces and restart clears prior answer progress', async () => {
  const { portfolio, tour, wx, navigations } = await fixture()
  portfolio.activate('/pkg-question/wrong-case/index')
  tour.update({ correctionReason: 'REASONING', reviewRevealed: true })
  portfolio.resume()
  assert.equal(tour.getState().surface, 'correction')
  assert.match(navigations.at(-1).url, /caseId=guide-wrong-case/)
  wx.setStorageSync(portfolio.RESUME_KEY, 'https://example.com/private')
  portfolio.resume()
  assert.equal(tour.getState().surface, 'preview')
  portfolio.start()
  assert.equal(tour.getState().correctionReason, '')
  assert.equal(tour.getState().reviewRevealed, false)
  assert.equal(tour.getState().surface, 'preview')
})

test('reset uses the scoped runtime clear and leaves existing host and H5 data untouched', async () => {
  const { portfolio, tour, wx, backing, counts, navigations, STORAGE_PREFIX } = await fixture()
  portfolio.activate('/pkg-question/wrong-case/index')
  wx.setStorageSync('portfolio-draft', 'discard')
  portfolio.reset()
  assert.equal(counts.scopedClear, 1)
  assert.equal(counts.rawClear, 0)
  assert.equal(backing.get('unrelated'), 'keep')
  assert.equal(backing.get('__weapp_vite_web_storage__:accessToken'), 'private-existing-session')
  assert.equal(backing.has(STORAGE_PREFIX + 'portfolio-draft'), false)
  assert.equal(wx.getStorageSync(portfolio.RESUME_KEY), '')
  assert.equal(tour.getState().phase, 'intro')
  assert.equal(navigations.at(-1).url, portfolio.HOME)
})

test('business requests stay blocked before, during and after the walkthrough', async () => {
  const { portfolio, tour, load, counts } = await fixture()
  const request = load('services/request.js')
  for (const phase of ['intro', 'demo', 'done']) {
    if (phase === 'demo') portfolio.activate('/pages/preview/index')
    if (phase === 'done') tour.complete('completed')
    for (const method of ['request', 'requestOptional', 'refreshAccessToken']) {
      await assert.rejects(request[method]({ url: '/account', method: 'POST', data: { token: 'old' } }), { code: 'PORTFOLIO_NETWORK_DISABLED' })
    }
  }
  assert.equal(counts.businessCalls, 0)
})

test('the local fixture keeps chapter, classroom, answer, correction and AI examples consistent', async () => {
  const { guide, load } = await fixture()
  const source = load('services/onboarding-demo-data.js')
  const content = guide.demo()
  const chapter = guide.chapterDetail()
  const classroom = guide.classroomPayload()
  const practice = guide.practiceQuestion()
  const correction = guide.wrongCase()
  const retest = guide.retestCase()
  assert.equal(chapter.learningCards[0].externalUnitId, content.path.card.externalId)
  assert.equal(classroom.lessons[0].units[0].externalUnitId, content.path.card.externalId)
  assert.equal(classroom.revision.sourceVersion, content.source.contentVersion)
  assert.equal(correction.stem, practice.stem)
  assert.equal(retest.stem, practice.stem)
  assert.equal(correction.correctAnswer[0], practice.answer)
  assert.ok(practice.options.some(option => option.key === practice.answer))
  assert.ok(practice.options.some(option => option.key === practice.experienceAnswer))
  assert.notEqual(practice.answer, practice.experienceAnswer, 'the correction example requires an initial wrong answer')
  const preview = guide.previewSession()
  const previewAnswer = content.practice.previewQuestions[0].answer
  assert.equal(guide.completePreviewSession([previewAnswer]).correctCount, 1)
  assert.equal(guide.completePreviewSession(['NOT_AN_OPTION']).correctCount, 0)
  assert.equal(preview.items.length, 1)
  for (const target of content.aiTargets) {
    const answer = source.getAiResponse(target.targetKey)
    assert.ok(answer?.text, `AI target ${target.targetKey} needs a frozen sample`)
    assert.equal(answer.binding.contentVersion, content.source.contentVersion)
    assert.equal(answer.chunks.join(''), answer.text)
  }
  const originalTitle = content.path.card.title
  content.path.card.title = 'mutated by visitor'
  assert.equal(guide.demo().path.card.title, originalTitle, 'each consumer gets an independent fixture')
})
