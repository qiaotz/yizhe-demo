import * as runtime from '@weapp-vite/web/runtime'
import { createH5RuntimeAdapters } from './h5-runtime-adapters.js'
import { createScopedStorage, disabledOperation, safeNavigation } from './portfolio-runtime-policy.js'

let backingStore
try { backingStore = globalThis.localStorage } catch {}
const storage = createScopedStorage(backingStore)
const blockedFetch = disabledOperation('fetch')
runtime.setWebRuntimeHost({ storage: storage.host, fetch: blockedFetch, open: disabledOperation('open') })
globalThis.fetch = blockedFetch

const adapters = createH5RuntimeAdapters({ runtime, getStored: storage.api.getStorageSync })
const media = Object.freeze(Object.fromEntries([
  'start', 'stop', 'pause', 'resume', 'play', 'destroy', 'seek',
  'onStart', 'onStop', 'onPause', 'onResume', 'onError', 'onEnded', 'onPlay', 'onTimeUpdate',
  'offStart', 'offStop', 'offPause', 'offResume', 'offError', 'offEnded', 'offPlay', 'offTimeUpdate',
].map(name => [name, () => {}])))
const deniedMethods = [
  'request', 'uploadFile', 'downloadFile', 'login', 'checkSession', 'getUserInfo', 'getUserProfile',
  'chooseFile', 'chooseImage', 'chooseMedia', 'chooseMessageFile', 'chooseVideo', 'getImageInfo',
  'getVideoInfo', 'previewMedia', 'previewImage', 'openDocument', 'saveFile', 'saveFileToDisk',
  'saveImageToPhotosAlbum', 'saveVideoToPhotosAlbum', 'requestPayment', 'requestSubscribeMessage',
  'getLocation', 'getFuzzyLocation', 'chooseLocation', 'openLocation', 'makePhoneCall',
  'navigateToMiniProgram', 'openCustomerServiceChat', 'scanCode', 'setKeepScreenOn', 'authorize',
  'reportAnalytics', 'createWorker', 'openRuntimeUrl',
]
const cloud = new Proxy(Object.freeze({ init() {} }), {
  get(target, name) { return name in target ? target[name] : disabledOperation(`cloud.${String(name)}`) },
})

globalThis.__YIZHE_PORTFOLIO_RUNTIME_BASE__ = globalThis.location?.pathname.replace(/(?:index\.html)?$/, '').replace(/\/$/, '') || '/'
globalThis.__YANYIZHI_H5__ = Object.freeze({
  base: globalThis.__YIZHE_PORTFOLIO_RUNTIME_BASE__, releaseId: 'portfolio-v1',
  mediaEnabled: false, guideVideoEnabled: false, portfolioDemo: true,
})
const wx = Object.assign({}, globalThis.wx, runtime, storage.api, adapters, {
  cloud,
  getRecorderManager: () => media,
  createInnerAudioContext: () => media,
  createVideoContext: () => media,
  getFileSystemManager: () => new Proxy({}, { get: (_target, name) => disabledOperation(`fileSystem.${String(name)}`) }),
  base64ToArrayBuffer(value) {
    const binary = atob(String(value || ''))
    return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer
  },
})
for (const name of deniedMethods) wx[name] = disabledOperation(name)
for (const method of ['navigateTo', 'redirectTo', 'switchTab', 'reLaunch']) {
  wx[method] = (options = {}) => {
    const target = safeNavigation(options.url, globalThis.__YIZHE_PORTFOLIO__?.prepareNavigation, method)
    if (!target) return disabledOperation(method)(options)
    return runtime[target.method]({ ...options, url: target.url })
  }
}
globalThis.wx = wx

export function canonicalizeInitialRoute() {
  if (!globalThis.location || !globalThis.history) return
  const raw = '/' + location.hash.replace(/^#\/?/, '')
  const target = safeNavigation(raw, globalThis.__YIZHE_PORTFOLIO__?.prepareNavigation)
  const url = target?.url || '/pages/showcase/index'
  const hash = '#' + url
  if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash)
}
