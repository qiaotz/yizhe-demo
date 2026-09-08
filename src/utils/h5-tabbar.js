function nativeTabBarAction(hidden) {
  const runtime = typeof wx === 'undefined' ? null : wx
  if (!runtime) return null
  return hidden ? runtime.hideTabBar : runtime.showTabBar
}

function syncTabBar(page, selected, options = {}) {
  const hidden = options.hidden === true
  const guideLocked = options.guideLocked === true
  const custom = page && typeof page.getTabBar === 'function' ? page.getTabBar() : null

  if (custom && typeof custom.setData === 'function') {
    custom.setData({ selected, hidden, guideLocked })
  }

  const action = nativeTabBarAction(hidden)
  if (typeof action !== 'function') return
  try {
    Promise.resolve(action.call(wx, { animation: false })).catch(() => {})
  } catch (error) {}
}

module.exports = { syncTabBar }
