const TAB_BAR_STYLE_ID = 'yanyizhi-h5-tabbar-parity'
const DIALOG_STYLE_ID = 'yanyizhi-h5-dialog-parity'
const AI_ASSISTANT_HOST_SELECTOR = 'wv-component-components-yy-ai-assistant-index'

const TAB_BAR_STYLE = `
:host {
  position: fixed !important;
  z-index: var(--yy-v3-z-tabbar, 100) !important;
  right: var(--yy-h5-fixed-inset, 0px) !important;
  bottom: 0 !important;
  left: var(--yy-h5-fixed-inset, 0px) !important;
  width: auto !important;
  height: calc(var(--rpx, .5px) * 168 + var(--yy-h5-safe-bottom, env(safe-area-inset-bottom))) !important;
}
:host([hidden]) { display: none !important; }
:host([data-yanyizhi-guide-active="true"]) { display: none !important; }
.weapp-tab-bar {
  display: flex !important;
  height: 100% !important;
  box-sizing: border-box !important;
  align-items: flex-start !important;
  justify-content: space-around !important;
  padding: calc(var(--rpx, .5px) * 16) calc(var(--rpx, .5px) * 8)
    calc(var(--rpx, .5px) * 44 + var(--yy-h5-safe-bottom, env(safe-area-inset-bottom))) !important;
  border-top: 1px solid rgba(170, 182, 197, .12) !important;
  background: rgba(13, 19, 27, .98) !important;
  box-shadow: 0 calc(var(--rpx, .5px) * -18) calc(var(--rpx, .5px) * 44) rgba(0, 0, 0, .18) !important;
}
.weapp-tab-bar__item {
  position: relative !important;
  display: flex !important;
  width: 20% !important;
  min-width: 0 !important;
  height: calc(var(--rpx, .5px) * 108) !important;
  box-sizing: border-box !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  gap: calc(var(--rpx, .5px) * 8) !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: calc(var(--rpx, .5px) * 16) !important;
  color: #8997A8 !important;
  background: transparent !important;
  font: 500 calc(var(--rpx, .5px) * 24) / 1.2 var(--yy-v3-font, sans-serif) !important;
  transition: opacity 160ms cubic-bezier(.2, .8, .2, 1), transform 160ms cubic-bezier(.2, .8, .2, 1) !important;
  -webkit-tap-highlight-color: transparent;
}
.weapp-tab-bar__item:active { opacity: .94 !important; transform: scale(.97) !important; }
.weapp-tab-bar__item:focus { outline: none !important; }
.weapp-tab-bar__item:focus-visible { box-shadow: 0 0 0 2px #45A3FF inset !important; }
.weapp-tab-bar__item[aria-current="page"] { font-weight: 600 !important; }
.weapp-tab-bar__item:nth-child(1)[aria-current="page"] { color: #4CBFD3 !important; }
.weapp-tab-bar__item:nth-child(2)[aria-current="page"] { color: #D6A84B !important; }
.weapp-tab-bar__item:nth-child(3)[aria-current="page"] { color: #5B7FFF !important; }
.weapp-tab-bar__item:nth-child(4)[aria-current="page"] { color: #E96B50 !important; }
.weapp-tab-bar__item:nth-child(5)[aria-current="page"] { color: #3FB982 !important; }
.weapp-tab-bar__icon-wrap {
  display: flex !important;
  width: calc(var(--rpx, .5px) * 44) !important;
  height: calc(var(--rpx, .5px) * 44) !important;
  align-items: center !important;
  justify-content: center !important;
  margin: 0 !important;
}
.weapp-tab-bar__icon {
  width: calc(var(--rpx, .5px) * 44) !important;
  height: calc(var(--rpx, .5px) * 44) !important;
  object-fit: contain !important;
}
.weapp-tab-bar__label {
  margin: 0 !important;
  font-family: inherit !important;
  font-size: calc(var(--rpx, .5px) * 24) !important;
  font-weight: inherit !important;
  line-height: 1.2 !important;
}
@media (prefers-reduced-motion: reduce) {
  .weapp-tab-bar__item { transition: none !important; }
}
`

const DIALOG_STYLE = `
.yy-h5-runtime-overlay {
  position: fixed;
  z-index: calc(var(--yy-v3-z-dialog, 220) + 10);
  top: 0;
  right: var(--yy-h5-fixed-inset, 0px);
  bottom: 0;
  left: var(--yy-h5-fixed-inset, 0px);
  display: flex;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  padding: calc(var(--rpx, .5px) * 32);
  background: rgba(0, 0, 0, .68);
  overscroll-behavior: contain;
}
.yy-h5-runtime-modal,
.yy-h5-runtime-sheet {
  width: min(calc(var(--rpx, .5px) * 640), calc(100% - var(--rpx, .5px) * 64));
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid rgba(170, 182, 197, .22);
  border-radius: calc(var(--rpx, .5px) * 32);
  color: #F2F5F8;
  background: #151F2B;
  box-shadow: 0 calc(var(--rpx, .5px) * 22) calc(var(--rpx, .5px) * 56) rgba(0, 0, 0, .38);
  font-family: var(--yy-v3-font, sans-serif);
}
.yy-h5-runtime-modal { padding: calc(var(--rpx, .5px) * 32); }
.yy-h5-runtime-title {
  color: #F2F5F8;
  font-size: calc(var(--rpx, .5px) * 31);
  line-height: 1.35;
  font-weight: 600;
  text-align: center;
}
.yy-h5-runtime-content {
  margin-top: calc(var(--rpx, .5px) * 18);
  color: #B7C1CE;
  font-size: calc(var(--rpx, .5px) * 26);
  line-height: 1.65;
  white-space: pre-wrap;
}
.yy-h5-runtime-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: calc(var(--rpx, .5px) * 16);
  margin-top: calc(var(--rpx, .5px) * 30);
}
.yy-h5-runtime-actions.one { grid-template-columns: 1fr; }
.yy-h5-runtime-button,
.yy-h5-runtime-sheet-button {
  min-height: calc(var(--rpx, .5px) * 88);
  box-sizing: border-box;
  margin: 0;
  padding: calc(var(--rpx, .5px) * 14) calc(var(--rpx, .5px) * 20);
  border: 1px solid rgba(170, 182, 197, .22);
  border-radius: calc(var(--rpx, .5px) * 20);
  color: #B7C1CE;
  background: #1A2634;
  font: 500 calc(var(--rpx, .5px) * 26) / 1.3 var(--yy-v3-font, sans-serif);
}
.yy-h5-runtime-button.confirm {
  border-color: #45A3FF;
  color: #071016;
  background: #45A3FF;
  font-weight: 600;
}
.yy-h5-runtime-button:focus,
.yy-h5-runtime-sheet-button:focus { outline: none; }
.yy-h5-runtime-button:focus-visible,
.yy-h5-runtime-sheet-button:focus-visible { box-shadow: 0 0 0 2px #78C4FF; }
.yy-h5-runtime-sheet-wrap {
  align-items: flex-end;
  padding: 0;
}
.yy-h5-runtime-sheet {
  width: 100%;
  max-height: 72vh;
  max-height: min(72dvh, 680px);
  overflow-y: auto;
  padding: calc(var(--rpx, .5px) * 18) calc(var(--rpx, .5px) * 24)
    calc(var(--rpx, .5px) * 24 + var(--yy-h5-safe-bottom, env(safe-area-inset-bottom)));
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  border-radius: calc(var(--rpx, .5px) * 32) calc(var(--rpx, .5px) * 32) 0 0;
  overscroll-behavior: contain;
}
.yy-h5-runtime-grip {
  width: calc(var(--rpx, .5px) * 72);
  height: calc(var(--rpx, .5px) * 8);
  margin: 0 auto calc(var(--rpx, .5px) * 18);
  border-radius: 999px;
  background: #566373;
}
.yy-h5-runtime-sheet-button {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: center;
}
.yy-h5-runtime-sheet-button + .yy-h5-runtime-sheet-button { border-top: 1px solid rgba(170, 182, 197, .12); }
.yy-h5-runtime-sheet-button.cancel {
  margin-top: calc(var(--rpx, .5px) * 16);
  border: 1px solid rgba(170, 182, 197, .22);
  border-radius: calc(var(--rpx, .5px) * 20);
  color: #8997A8;
  background: #101821;
}
`

function ensureDocumentStyle(id, css) {
  if (typeof document === 'undefined' || document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.append(style)
}

function callOption(options, name, value) {
  try { options && typeof options[name] === 'function' && options[name](value) } catch (error) {}
}

function finish(options, result, resolve) {
  callOption(options, 'success', result)
  callOption(options, 'complete', result)
  resolve(result)
}

function cancelAction(options, reject) {
  const result = { errMsg: 'showActionSheet:fail cancel' }
  callOption(options, 'fail', result)
  callOption(options, 'complete', result)
  reject(result)
}

function button(label, className) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = label
  return element
}

function trapFocus(container, cancel) {
  const previous = document.activeElement
  const keydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(container.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])'))
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  container.addEventListener('keydown', keydown)
  const first = container.querySelector('button:not([disabled])')
  if (first) setTimeout(() => first.focus(), 0)
  return () => {
    container.removeEventListener('keydown', keydown)
    if (previous && typeof previous.focus === 'function') previous.focus()
  }
}

function showModal(options = {}) {
  ensureDocumentStyle(DIALOG_STYLE_ID, DIALOG_STYLE)
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'yy-h5-runtime-overlay'
    overlay.setAttribute('role', 'presentation')
    const modal = document.createElement('section')
    modal.className = 'yy-h5-runtime-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')

    const title = document.createElement('div')
    const titleId = `yy-h5-modal-${Date.now().toString(36)}`
    title.id = titleId
    title.className = 'yy-h5-runtime-title'
    title.textContent = String(options.title || '提示')
    modal.setAttribute('aria-labelledby', titleId)
    modal.append(title)

    if (options.content) {
      const content = document.createElement('div')
      content.className = 'yy-h5-runtime-content'
      content.textContent = String(options.content)
      modal.append(content)
    }

    const actions = document.createElement('div')
    actions.className = `yy-h5-runtime-actions${options.showCancel === false ? ' one' : ''}`
    let restore = () => {}
    let settled = false
    const close = (result) => {
      if (settled) return
      settled = true
      restore()
      overlay.remove()
      finish(options, result, resolve)
    }
    if (options.showCancel !== false) {
      const cancel = button(String(options.cancelText || '取消'), 'yy-h5-runtime-button cancel')
      if (options.cancelColor) cancel.style.color = String(options.cancelColor)
      cancel.addEventListener('click', () => close({ confirm: false, cancel: true, errMsg: 'showModal:ok' }))
      actions.append(cancel)
    }
    const confirm = button(String(options.confirmText || '确定'), 'yy-h5-runtime-button confirm')
    if (options.confirmColor) {
      confirm.style.background = String(options.confirmColor)
      confirm.style.borderColor = String(options.confirmColor)
    }
    confirm.addEventListener('click', () => close({ confirm: true, cancel: false, errMsg: 'showModal:ok' }))
    actions.append(confirm)
    modal.append(actions)
    overlay.append(modal)
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay && options.showCancel !== false) close({ confirm: false, cancel: true, errMsg: 'showModal:ok' })
    })
    document.body.append(overlay)
    restore = trapFocus(modal, () => {
      if (options.showCancel !== false) close({ confirm: false, cancel: true, errMsg: 'showModal:ok' })
    })
  })
}

function showActionSheet(options = {}) {
  ensureDocumentStyle(DIALOG_STYLE_ID, DIALOG_STYLE)
  const items = Array.isArray(options.itemList) ? options.itemList.map((item) => String(item).trim()).filter(Boolean) : []
  return new Promise((resolve, reject) => {
    if (!items.length) {
      const result = { errMsg: 'showActionSheet:fail invalid itemList' }
      callOption(options, 'fail', result)
      callOption(options, 'complete', result)
      reject(result)
      return
    }
    const overlay = document.createElement('div')
    overlay.className = 'yy-h5-runtime-overlay yy-h5-runtime-sheet-wrap'
    overlay.setAttribute('role', 'presentation')
    const sheet = document.createElement('section')
    sheet.className = 'yy-h5-runtime-sheet'
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-modal', 'true')
    sheet.setAttribute('aria-label', String(options.alertText || '请选择'))
    const grip = document.createElement('div')
    grip.className = 'yy-h5-runtime-grip'
    grip.setAttribute('aria-hidden', 'true')
    sheet.append(grip)

    let restore = () => {}
    let settled = false
    const close = (result, cancelled) => {
      if (settled) return
      settled = true
      restore()
      overlay.remove()
      if (cancelled) cancelAction(options, reject)
      else finish(options, result, resolve)
    }
    items.forEach((item, tapIndex) => {
      const choice = button(String(item), 'yy-h5-runtime-sheet-button')
      if (options.itemColor) choice.style.color = String(options.itemColor)
      choice.addEventListener('click', () => close({ tapIndex, errMsg: 'showActionSheet:ok' }, false))
      sheet.append(choice)
    })
    const cancel = button('取消', 'yy-h5-runtime-sheet-button cancel')
    cancel.addEventListener('click', () => close(null, true))
    sheet.append(cancel)
    overlay.append(sheet)
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(null, true) })
    document.body.append(overlay)
    restore = trapFocus(sheet, () => close(null, true))
  })
}

function guideLocked(getStored) {
  try {
    const stored = getStored('yanyizhi:onboarding:v3')
    const state = typeof stored === 'string' ? JSON.parse(stored) : stored
    return Boolean(state && typeof state === 'object' && state.phase === 'demo' && state.guideMode === true)
  } catch (error) {
    return false
  }
}

function installTabBarParity(runtime, getStored) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  const observedRoots = new WeakSet()
  const syncGuideState = (host) => {
    host.dataset.yanyizhiGuideActive = guideLocked(getStored) ? 'true' : 'false'
  }
  const keepStyleMounted = (root, host) => {
    syncGuideState(host)
    if (!root.getElementById(TAB_BAR_STYLE_ID)) {
      const style = document.createElement('style')
      style.id = TAB_BAR_STYLE_ID
      style.textContent = TAB_BAR_STYLE
      root.append(style)
    }
    if (observedRoots.has(root)) return
    observedRoots.add(root)
    const observer = new MutationObserver(() => {
      syncGuideState(host)
      if (!root.getElementById(TAB_BAR_STYLE_ID)) queueMicrotask(() => keepStyleMounted(root, host))
    })
    observer.observe(root, { childList: true })
  }
  const enhance = () => {
    document.querySelectorAll('weapp-tab-bar').forEach((host) => {
      const root = host.shadowRoot
      if (!root) return
      keepStyleMounted(root, host)
      if (host.dataset.yanyizhiGuideLock === 'true') return
      host.dataset.yanyizhiGuideLock = 'true'
      root.addEventListener('click', (event) => {
        if (!guideLocked(getStored)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (runtime && typeof runtime.showToast === 'function') {
          Promise.resolve(runtime.showToast({ title: '请先完成当前步骤，再前往其他页面', icon: 'none' })).catch(() => {})
        }
      }, true)
    })
  }
  const start = () => {
    enhance()
    const observer = new MutationObserver(() => enhance())
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}

function assistantControlDisabled(element) {
  if (!element) return true
  if (element.disabled === true || element.getAttribute('aria-disabled') === 'true') return true
  const disabled = element.getAttribute('disabled')
  return disabled !== null && disabled !== 'false'
}

function assistantControlAt(root, clientX, clientY) {
  if (!root || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
  return Array.from(root.querySelectorAll('weapp-button, [aria-role="button"], [role="button"]'))
    .filter((element) => {
      if (assistantControlDisabled(element)) return false
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false
      const style = getComputedStyle(element)
      const opacity = Number.parseFloat(style.opacity || '1')
      return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && (!Number.isFinite(opacity) || opacity > 0.01)
    })
    .sort((left, right) => {
      const leftButton = left.tagName === 'WEAPP-BUTTON' ? 0 : 1
      const rightButton = right.tagName === 'WEAPP-BUTTON' ? 0 : 1
      if (leftButton !== rightButton) return leftButton - rightButton
      const leftRect = left.getBoundingClientRect()
      const rightRect = right.getBoundingClientRect()
      return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height)
    })[0] || null
}

function installAssistantClickBridge() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  const observedRoots = new WeakSet()
  const bridgedHosts = new WeakSet()

  const bridge = (host) => {
    if (!host || !host.shadowRoot || bridgedHosts.has(host)) return
    bridgedHosts.add(host)
    let forwarding = false
    host.addEventListener('click', (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      if (forwarding || path[0] !== host) return
      const target = assistantControlAt(host.shadowRoot, Number(event.clientX), Number(event.clientY))
      if (!target) return
      event.preventDefault()
      event.stopImmediatePropagation()
      forwarding = true
      try { target.click() } finally { forwarding = false }
    }, true)
  }

  const scan = (root) => {
    if (!root || typeof root.querySelectorAll !== 'function') return
    root.querySelectorAll(AI_ASSISTANT_HOST_SELECTOR).forEach(bridge)
    root.querySelectorAll('*').forEach((element) => {
      if (!element.shadowRoot) return
      observe(element.shadowRoot)
      scan(element.shadowRoot)
    })
  }

  const observe = (root) => {
    if (!root || observedRoots.has(root)) return
    observedRoots.add(root)
    const observer = new MutationObserver(() => scan(root))
    observer.observe(root, { childList: true, subtree: true })
  }

  const start = () => {
    observe(document.documentElement)
    scan(document)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}

export function createH5RuntimeAdapters({ runtime, getStored }) {
  installTabBarParity(runtime, getStored)
  installAssistantClickBridge()
  return { showModal, showActionSheet }
}
