import { defineConfig } from 'weapp-vite'
import { transformH5VideoRuntime } from './h5-video-compat.mjs'
import { transformPortfolioTabBarRuntime } from './portfolio-asset-compat.mjs'

// Relative assets make one build portable to GitHub Pages and any static subfolder.
const STATIC_BASE = process.env.DEMO_BASE || './'
if (STATIC_BASE !== './' && !/^\/(?:[A-Za-z0-9_.-]+\/)*$/.test(STATIC_BASE)) {
  throw new Error('DEMO_BASE must be ./ or an absolute directory path ending in /')
}

function h5ButtonRuntimeParity() {
  return {
    name: 'yizhe-demo-button-runtime-parity',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.replace(/\\/g, '/').endsWith('/@weapp-vite/web/dist/runtime/button/style.mjs')) return null
      const disabled = `weapp-button.weapp-btn--loading,
weapp-button.weapp-btn--disabled {
  background-color: #f7f7f7;
  border-color: #d9d9d9;
  color: #bbbbbb;
  cursor: not-allowed;
}`
      const hover = `weapp-button.button-hover {
  background-color: #ededed;
  border-color: #d2d2d2;
}`
      const focus = 'weapp-button .weapp-btn__content {'
      if (!code.includes(disabled) || !code.includes(hover) || !code.includes(focus)) {
        throw new Error('Web Runtime button styles changed; review the compatibility patch')
      }
      const next = code.replace(disabled, `weapp-button.weapp-btn--loading {
  opacity: 0.72;
  cursor: progress;
}
weapp-button.weapp-btn--disabled {
  opacity: 0.52;
  cursor: not-allowed;
}`).replace(hover, `weapp-button.button-hover {
  opacity: var(--yy-v3-pressed-opacity, 0.94);
  transform: scale(var(--yy-v3-press-scale, 0.992));
}`).replace(focus, `weapp-button:focus,
weapp-button:focus-visible,
weapp-button .weapp-btn:focus,
weapp-button .weapp-btn:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}
${focus}`)
      return { code: next, map: null }
    },
  }
}

function portfolioSourceCompat() {
  return {
    name: 'yizhe-demo-source-compat',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const normalized = id.replace(/\\/g, '/')
      const video = transformH5VideoRuntime(code, normalized)
      if (video) return video
      const tabBar = transformPortfolioTabBarRuntime(code, normalized)
      if (tabBar) return tabBar
      if (!normalized.includes('/src/')) return null
      let next = code
      if (/\.[cm]?[jt]sx?$/.test(normalized)) {
        next = next.replace(/observer\s*:\s*(['"])([A-Za-z_$][\w$]*)\1/g,
          (_match, _quote, method) => `observer(...args) { return this[${JSON.stringify(method)}](...args) }`)
      }
      if (/\.(?:wxml|wxss|css|json|[cm]?[jt]sx?)$/.test(normalized)) {
        next = next.replace(/(?<![A-Za-z0-9_./-])\/(?:beta\/)?images\//g, `${STATIC_BASE}images/`)
      }
      return next === code ? null : { code: next, map: null }
    },
    renderChunk(code: string) {
      const next = code.replace(/(?<![A-Za-z0-9_./-])\/(?:beta\/)?images\//g, `${STATIC_BASE}images/`)
      return next === code ? null : { code: next, map: null }
    },
  }
}

function portfolioHostPrelude() {
  return {
    name: 'yizhe-demo-host-prelude',
    enforce: 'post' as const,
    transform(code: string, id: string) {
      if (id !== '\0@weapp-vite/web/entry') return null
      if (!code.includes('initializePageRoutes(')) throw new Error('Web Runtime entry changed; review demo initialization')
      // A side-effect import must execute before app/page modules read wx storage.
      const next = `import { canonicalizeInitialRoute } from '/portfolio-runtime-prelude.js'\n` + code
        .replace(/^initializePageRoutes\(/m, 'canonicalizeInitialRoute();\ninitializePageRoutes(')
        .replace(/"__YIZHE_RUNTIME_BASE__"/g, 'globalThis.__YIZHE_PORTFOLIO_RUNTIME_BASE__')
      return { code: next, map: null }
    },
  }
}

export default defineConfig({
  base: STATIC_BASE,
  // weapp-vite merges its top-level build defaults before web.vite settings.
  // Override the mini-program-style fixed entry name at this level for H5.
  build: {
    rolldownOptions: {
      output: {
        format: 'es',
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: '[name]-[hash].js',
      },
    },
  },
  weapp: {
    srcRoot: 'src',
    web: {
      enable: true,
      outDir: 'dist/web',
      vite: {
        plugins: [h5ButtonRuntimeParity(), portfolioSourceCompat(), portfolioHostPrelude()],
      },
      pluginOptions: {
        runtime: {
          viewport: { mode: 'mini-program', maxWidth: 375, desktopBreakpoint: 480 },
          routing: { mode: 'hash', base: '__YIZHE_RUNTIME_BASE__' },
        },
      },
    },
  },
})
