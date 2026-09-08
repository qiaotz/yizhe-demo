const STORAGE_KEY = 'v1FreeQueryFabYRatio'
const TARGET_URL = '/pkg-ai/query/index'
const FAB_SIZE_RPX = 100
const TABBAR_HEIGHT_RPX = 168
const TOP_GAP_RPX = 16
const BOTTOM_GAP_RPX = 20
const DRAG_THRESHOLD_PX = 6
const KEYBOARD_STEP_PX = 44

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(finiteNumber(value, minimum), minimum), maximum)
}

function rpxToPx(value, windowWidth) {
  return finiteNumber(value, 0) * finiteNumber(windowWidth, 375) / 750
}

function dockBounds(windowInfo, menuRect, viewportMetrics) {
  const info = windowInfo || {}
  const viewport = viewportMetrics || {}
  const windowWidth = Math.max(320, finiteNumber(viewport.windowWidth, finiteNumber(info.windowWidth, 375)))
  const windowHeight = Math.max(320, finiteNumber(viewport.windowHeight, finiteNumber(info.windowHeight, 667)))
  const safeTop = clamp(finiteNumber(viewport.safeTop, 0), 0, 120)
  const statusBarHeight = Math.max(safeTop, finiteNumber(info.statusBarHeight, 0))
  const menu = menuRect || {}
  const menuTop = finiteNumber(menu.top, 0)
  const menuHeight = finiteNumber(menu.height, 0)
  const barHeight = menuTop > statusBarHeight && menuHeight > 0
    ? (menuTop - statusBarHeight) * 2 + menuHeight
    : 44
  const safeAreaBottom = info.safeArea ? finiteNumber(info.safeArea.bottom, windowHeight) : windowHeight
  const declaredSafeBottom = clamp(windowHeight - Math.min(windowHeight, safeAreaBottom), 0, 80)
  const safeBottom = Math.max(declaredSafeBottom, clamp(finiteNumber(viewport.safeBottom, 0), 0, 80))
  const size = rpxToPx(FAB_SIZE_RPX, windowWidth)
  const minimum = statusBarHeight + barHeight + rpxToPx(TOP_GAP_RPX, windowWidth)
  const reservedBottom = safeBottom + rpxToPx(TABBAR_HEIGHT_RPX + BOTTOM_GAP_RPX, windowWidth)
  const maximum = Math.max(minimum, windowHeight - reservedBottom - size)
  return { minimum, maximum, size, windowWidth, windowHeight }
}

function storedRatio(value) {
  const candidate = value && typeof value === 'object' ? value.ratio : value
  if (candidate === null || candidate === undefined) return 1
  if (typeof candidate !== 'number' && typeof candidate !== 'string') return 1
  if (typeof candidate === 'string' && !candidate.trim()) return 1
  const number = Number(candidate)
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : 1
}

function topFromRatio(value, bounds) {
  const range = Math.max(0, bounds.maximum - bounds.minimum)
  return bounds.minimum + range * storedRatio(value)
}

function ratioFromTop(value, bounds) {
  const range = Math.max(0, bounds.maximum - bounds.minimum)
  if (!range) return 1
  return clamp((clamp(value, bounds.minimum, bounds.maximum) - bounds.minimum) / range, 0, 1)
}

function nativeEvent(event) {
  return event && event.originalEvent ? event.originalEvent : event || null
}

function firstPointer(event) {
  const source = nativeEvent(event)
  if (!source) return null
  const touches = source.touches && source.touches.length ? source.touches : source.changedTouches
  if (touches && touches.length) return touches[0]
  return Number.isFinite(Number(source.clientY)) ? source : null
}

function pointerIdentity(event) {
  const pointer = firstPointer(event)
  if (!pointer) return null
  if (pointer.pointerId !== undefined) return `pointer:${pointer.pointerId}`
  if (pointer.identifier !== undefined) return `touch:${pointer.identifier}`
  return null
}

function positionLabel(topPx, bounds) {
  if (!bounds) return '屏幕下方'
  const ratio = ratioFromTop(topPx, bounds)
  if (ratio <= 0.18) return '屏幕上方'
  if (ratio >= 0.82) return '屏幕下方'
  return '屏幕中部'
}

function ariaLabel(topPx, bounds, dragging) {
  return `AI答疑，${dragging ? '正在上下移动' : '可上下拖动'}，当前位于${positionLabel(topPx, bounds)}，轻点开始提问`
}

function readWebSafeInsets() {
  if (typeof document === 'undefined' || !document.body || typeof getComputedStyle !== 'function') return { top: 0, right: 0, bottom: 0, left: 0 }
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:var(--yy-h5-safe-top,env(safe-area-inset-top,0px));padding-right:env(safe-area-inset-right,0px);padding-bottom:var(--yy-h5-safe-bottom,env(safe-area-inset-bottom,0px));padding-left:env(safe-area-inset-left,0px)'
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const result = {
    top: Math.max(0, finiteNumber(parseFloat(style.paddingTop), 0)),
    right: Math.max(0, finiteNumber(parseFloat(style.paddingRight), 0)),
    bottom: Math.max(0, finiteNumber(parseFloat(style.paddingBottom), 0)),
    left: Math.max(0, finiteNumber(parseFloat(style.paddingLeft), 0))
  }
  probe.remove()
  return result
}

function readWebViewport() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return {}
  const app = document.querySelector('#app')
  const visualViewport = window.visualViewport
  const appWidth = app && app.clientWidth
  const appHeight = app && app.clientHeight
  const visualHeight = visualViewport && finiteNumber(visualViewport.height, 0)
  const safe = readWebSafeInsets()
  return {
    windowWidth: finiteNumber(appWidth, finiteNumber(window.innerWidth, 375)),
    windowHeight: visualHeight > 0 ? Math.min(finiteNumber(appHeight, visualHeight), visualHeight) : finiteNumber(appHeight, finiteNumber(window.innerHeight, 667)),
    safeTop: safe.top,
    safeBottom: safe.bottom
  }
}

function readWebScrollOffset() {
  if (typeof document === 'undefined') return 0
  const app = document.querySelector('#app')
  if (!app || typeof getComputedStyle !== 'function') return 0
  const style = getComputedStyle(app)
  const fixedIsScrollBound = style.transform !== 'none'
    || style.perspective !== 'none'
    || /(?:layout|paint|strict|content)/.test(String(style.contain || ''))
  return fixedIsScrollBound ? Math.max(0, finiteNumber(app.scrollTop, 0)) : 0
}

function subscribeWebViewport(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') return () => {}
  let frame = 0
  let pendingReason = ''
  const schedule = (reason) => {
    if (reason === 'viewport' || !pendingReason) pendingReason = reason
    if (frame) return
    const run = () => {
      const nextReason = pendingReason || 'viewport'
      frame = 0
      pendingReason = ''
      callback(nextReason)
    }
    frame = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(run) : window.setTimeout(run, 16)
  }
  const app = typeof document !== 'undefined' ? document.querySelector('#app') : null
  const viewportChanged = () => schedule('viewport')
  const appScrolled = () => schedule('scroll')
  window.addEventListener('resize', viewportChanged, { passive: true })
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', viewportChanged, { passive: true })
    window.visualViewport.addEventListener('scroll', viewportChanged, { passive: true })
  }
  if (app) app.addEventListener('scroll', appScrolled, { passive: true })
  return () => {
    window.removeEventListener('resize', viewportChanged)
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', viewportChanged)
      window.visualViewport.removeEventListener('scroll', viewportChanged)
    }
    if (app) app.removeEventListener('scroll', appScrolled)
    if (!frame) return
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
    else window.clearTimeout(frame)
    frame = 0
  }
}

function createDefinition(overrides) {
  const deps = Object.assign({
    getWindowInfo: () => wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(),
    getMenuRect: () => wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null,
    getViewportMetrics: readWebViewport,
    getScrollOffset: readWebScrollOffset,
    subscribeViewport: subscribeWebViewport,
    getStorage: (key) => wx.getStorageSync(key),
    setStorage: (key, value) => wx.setStorageSync(key, value),
    navigate: (url) => wx.navigateTo({ url }),
    nextTick: (callback) => {
      if (typeof wx !== 'undefined' && typeof wx.nextTick === 'function') wx.nextTick(callback)
      else callback()
    },
    now: () => Date.now()
  }, overrides || {})

  return {
    data: {
      ready: false,
      topPx: 0,
      renderTopPx: 0,
      dragging: false,
      ariaLabel: 'AI答疑，可上下拖动，轻点开始提问'
    },
    lifetimes: {
      attached() {
        this.detached = false
        this.dragMoved = false
        this.dragStartClientY = 0
        this.dragStartTop = 0
        this.latestTop = 0
        this.suppressTapUntil = 0
        this.activeInput = ''
        this.activePointerId = null
        this.lastTouchAt = 0
        this.mouseMoveListener = null
        this.mouseUpListener = null
        this.unsubscribeViewport = deps.subscribeViewport((reason) => {
          if (this.detached || this.data.dragging) return
          if (reason === 'scroll') this.syncRenderOffset()
          else this.syncPosition(false)
        })
        this.syncPosition()
      },
      detached() {
        this.detached = true
        this.detachMouseDrag()
        if (typeof this.unsubscribeViewport === 'function') this.unsubscribeViewport()
        this.unsubscribeViewport = null
      }
    },
    pageLifetimes: {
      show() { this.syncPosition(true) }
    },
    methods: {
      syncPosition(remount) {
        if (this.detached) return
        if (remount && this.data.ready) {
          this.setData({ ready: false })
          deps.nextTick(() => {
            if (!this.detached) this.syncPosition(false)
          })
          return
        }
        let info = {}
        let menu = null
        let viewport = {}
        let saved = 1
        try { info = deps.getWindowInfo() || {} } catch (error) {}
        try { menu = deps.getMenuRect() } catch (error) {}
        try { viewport = deps.getViewportMetrics() || {} } catch (error) {}
        try { saved = deps.getStorage(STORAGE_KEY) } catch (error) {}
        this.dockBounds = dockBounds(info, menu, viewport)
        this.latestTop = topFromRatio(saved, this.dockBounds)
        this.setData({
          ready: true,
          topPx: this.latestTop,
          renderTopPx: this.latestTop + this.scrollOffset(),
          ariaLabel: ariaLabel(this.latestTop, this.dockBounds, false)
        })
      },
      scrollOffset() {
        try { return Math.max(0, finiteNumber(deps.getScrollOffset(), 0)) } catch (error) { return 0 }
      },
      syncRenderOffset() {
        if (this.detached || !this.data.ready) return false
        this.setData({ renderTopPx: this.latestTop + this.scrollOffset() })
        return true
      },
      beginDrag(event, inputType) {
        if (this.activeInput && this.activeInput !== inputType) return false
        const pointer = firstPointer(event)
        if (!pointer || !this.dockBounds) return false
        this.activeInput = inputType
        this.activePointerId = pointerIdentity(event)
        this.dragMoved = false
        this.dragStartClientY = finiteNumber(pointer.clientY, finiteNumber(pointer.pageY, 0))
        this.dragStartTop = finiteNumber(this.data.topPx, this.latestTop || 0)
        this.latestTop = this.dragStartTop
        const source = nativeEvent(event)
        if (inputType === 'pointer' && source && source.currentTarget && source.pointerId !== undefined && source.currentTarget.setPointerCapture) {
          try { source.currentTarget.setPointerCapture(source.pointerId) } catch (error) {}
        }
        this.setData({ dragging: true, ariaLabel: ariaLabel(this.latestTop, this.dockBounds, true) })
        return true
      },
      moveDrag(event, inputType) {
        if (this.activeInput !== inputType || !this.dockBounds) return false
        const pointer = firstPointer(event)
        if (!pointer || this.activePointerId && pointerIdentity(event) !== this.activePointerId) return false
        const source = nativeEvent(event)
        if (source && typeof source.preventDefault === 'function') source.preventDefault()
        const clientY = finiteNumber(pointer.clientY, finiteNumber(pointer.pageY, this.dragStartClientY))
        const delta = clientY - this.dragStartClientY
        if (Math.abs(delta) >= DRAG_THRESHOLD_PX) this.dragMoved = true
        const topPx = clamp(this.dragStartTop + delta, this.dockBounds.minimum, this.dockBounds.maximum)
        this.latestTop = topPx
        this.setData({ topPx, renderTopPx: topPx + this.scrollOffset(), ariaLabel: ariaLabel(topPx, this.dockBounds, true) })
        return true
      },
      finishDrag(event, inputType) {
        if (this.activeInput !== inputType || !this.dockBounds) return false
        const topPx = clamp(this.latestTop, this.dockBounds.minimum, this.dockBounds.maximum)
        if (this.dragMoved) this.suppressTapUntil = deps.now() + 360
        const source = nativeEvent(event)
        if (inputType === 'pointer' && source && source.currentTarget && source.pointerId !== undefined && source.currentTarget.releasePointerCapture) {
          try { source.currentTarget.releasePointerCapture(source.pointerId) } catch (error) {}
        }
        this.activeInput = ''
        this.activePointerId = null
        this.setData({ dragging: false, topPx, renderTopPx: topPx + this.scrollOffset(), ariaLabel: ariaLabel(topPx, this.dockBounds, false) })
        try { deps.setStorage(STORAGE_KEY, ratioFromTop(topPx, this.dockBounds)) } catch (error) {}
        return true
      },
      attachMouseDrag() {
        if (typeof window === 'undefined' || this.mouseMoveListener) return
        this.mouseMoveListener = (event) => this.moveDrag(event, 'mouse')
        this.mouseUpListener = (event) => {
          this.finishDrag(event, 'mouse')
          this.detachMouseDrag()
        }
        window.addEventListener('mousemove', this.mouseMoveListener, { passive: false })
        window.addEventListener('mouseup', this.mouseUpListener)
      },
      detachMouseDrag() {
        if (typeof window === 'undefined') return
        if (this.mouseMoveListener) window.removeEventListener('mousemove', this.mouseMoveListener)
        if (this.mouseUpListener) window.removeEventListener('mouseup', this.mouseUpListener)
        this.mouseMoveListener = null
        this.mouseUpListener = null
      },
      handlePointerStart(event) { return this.beginDrag(event, 'pointer') },
      handlePointerMove(event) { return this.moveDrag(event, 'pointer') },
      handlePointerEnd(event) { return this.finishDrag(event, 'pointer') },
      handlePointerCancel(event) { return this.finishDrag(event, 'pointer') },
      handleMouseStart(event) {
        if (deps.now() - this.lastTouchAt < 500) return false
        const started = this.beginDrag(event, 'mouse')
        if (started) this.attachMouseDrag()
        return started
      },
      handleTouchStart(event) {
        this.lastTouchAt = deps.now()
        return this.beginDrag(event, 'touch')
      },
      handleTouchMove(event) { return this.moveDrag(event, 'touch') },
      handleTouchEnd(event) { return this.finishDrag(event, 'touch') },
      handleTouchCancel(event) { return this.finishDrag(event, 'touch') },
      moveByKeyboard(topPx) {
        if (!this.dockBounds) return false
        const nextTop = clamp(topPx, this.dockBounds.minimum, this.dockBounds.maximum)
        this.latestTop = nextTop
        this.dragMoved = false
        this.setData({ topPx: nextTop, renderTopPx: nextTop + this.scrollOffset(), dragging: false, ariaLabel: ariaLabel(nextTop, this.dockBounds, false) })
        try { deps.setStorage(STORAGE_KEY, ratioFromTop(nextTop, this.dockBounds)) } catch (error) {}
        return true
      },
      handleKeyDown(event) {
        const source = nativeEvent(event)
        const key = String(source && source.key || '')
        if (key === 'Enter' || key === ' ') {
          if (source && source.preventDefault) source.preventDefault()
          this.dragMoved = false
          return this.openFreeQuery()
        }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key) || !this.dockBounds) return false
        if (source && source.preventDefault) source.preventDefault()
        if (key === 'Home') return this.moveByKeyboard(this.dockBounds.minimum)
        if (key === 'End') return this.moveByKeyboard(this.dockBounds.maximum)
        const direction = key === 'ArrowUp' ? -1 : 1
        return this.moveByKeyboard(finiteNumber(this.data.topPx, this.latestTop) + direction * KEYBOARD_STEP_PX)
      },
      openFreeQuery() {
        if (this.data.dragging || this.dragMoved || deps.now() < this.suppressTapUntil) return false
        deps.navigate(TARGET_URL)
        return true
      }
    }
  }
}

if (typeof Component === 'function') Component(createDefinition())

module.exports = {
  STORAGE_KEY,
  TARGET_URL,
  clamp,
  dockBounds,
  firstPointer,
  positionLabel,
  ariaLabel,
  readWebSafeInsets,
  readWebViewport,
  readWebScrollOffset,
  storedRatio,
  topFromRatio,
  ratioFromTop,
  createDefinition
}
