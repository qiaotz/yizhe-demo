// The public demo supports browsing stages, including non-tab detail pages.
// Keep navigation outside the page viewport so page actions cannot cover it.
export const stages = [
  { id: 'preview', label: '预习', icon: 'preview', paths: ['/pages/preview/index', '/pages/preview/chapter', '/pkg-course/learning-check/index'] },
  { id: 'classroom', label: '上课', icon: 'class', paths: ['/pages/learning/index', '/pkg-course/classroom/index'] },
  { id: 'practice', label: '做题', icon: 'practice', paths: ['/pages/question/index', '/pkg-question/answer/index'] },
  { id: 'correction', label: '改错', icon: 'correction', paths: ['/pages/wrong/index', '/pkg-question/wrong-case/index', '/pkg-question/wrong-retest/index'] },
  { id: 'review', label: '复习', icon: 'review', paths: ['/pages/review/index'] },
]

export function stageForRoute(hash) {
  const path = String(hash || '').replace(/^#/, '').split('?')[0]
  return stages.find(stage => stage.paths.includes(path))?.id || ''
}

function mountNavigation() {
  const nav = document.querySelector('.demo-stage-nav')
  const shell = document.querySelector('.device-shell')
  if (!nav || !shell) return
  for (const stage of stages) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'demo-stage-button'
    button.dataset.stage = stage.id
    const icon = document.createElement('img')
    icon.className = 'demo-stage-icon'
    icon.src = new URL(`./images/prototype/tab-${stage.icon}.svg`, document.baseURI).href
    icon.alt = ''
    const text = document.createElement('span')
    text.textContent = stage.label
    button.append(icon, text)
    button.addEventListener('click', () => {
      if (stageForRoute(location.hash) === stage.id) return
      globalThis.__YIZHE_PORTFOLIO__?.open(stage.id)
    })
    nav.append(button)
  }
  const sync = (route = location.hash) => {
    const active = stageForRoute(route)
    const visible = !!active || route.replace(/^#/, '').startsWith('/pages/onboarding/index')
    nav.hidden = !visible
    shell.classList.toggle('has-stage-nav', visible)
    for (const button of nav.querySelectorAll('button')) {
      if (button.dataset.stage === active) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    }
  }
  window.addEventListener('portfolio:route', event => sync(event.detail))
  window.addEventListener('hashchange', () => sync())
  window.addEventListener('popstate', () => sync())
  sync()
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountNavigation, { once: true })
  else mountNavigation()
}
