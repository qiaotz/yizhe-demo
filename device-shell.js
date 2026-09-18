// Keep a 375 × 812 logical viewport on desktop, scaled to fit shorter windows.
// Mobile devices retain the browser's native viewport and safe areas.
function fitDevice() {
  const scale = Math.min(1, (window.innerHeight - 64) / 812, (window.innerWidth - 48) / 375)
  document.documentElement.style.setProperty('--device-scale', String(Math.max(.1, scale)))
}
fitDevice()
window.addEventListener('resize', fitDevice, { passive: true })
