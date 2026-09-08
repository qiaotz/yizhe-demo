export function transformPortfolioTabBarRuntime(code, id) {
  if (!id.replace(/\\/g, '/').endsWith('/@weapp-vite/web/dist/runtime/appShell/tabBar/index.mjs')) return null
  const match = code.match(/function resolveAssetUrl\(value\) \{\r?\n[\s\S]*?\r?\n\}/)
  if (!match || !match[0].includes('value.replace(/^\\.\\//, "")')) {
    throw new Error('Web Runtime tab icon resolver changed; review the portfolio asset compatibility patch')
  }
  const replacement = `function resolveAssetUrl(value) {
  return resolvePortfolioAssetUrl(value, globalThis.location?.href)
}`
  return {
    code: 'import { resolvePortfolioAssetUrl } from "/portfolio-runtime-policy.js"\n' + code.replace(match[0], replacement),
    map: null,
  }
}
