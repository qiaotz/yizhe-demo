const VIDEO_ELEMENT_PATH = '/@weapp-vite/web/dist/runtime/nativeComponents/video/index.mjs'
const VIDEO_CONTEXT_PATH = '/@weapp-vite/web/dist/runtime/polyfill/videoContext.mjs'

function replaceOnce(code, before, after, label) {
  if (code.split(before).length !== 2) {
    throw new Error(`Web Runtime video ${label} changed; H5 video compatibility patch must be reviewed`)
  }
  return code.replace(before, after)
}

// Keep the dependency untouched, and fail the build if its implementation changes.
export function transformH5VideoRuntime(code, id) {
  const normalized = id.replace(/\\/g, '/')
  if (normalized.endsWith(VIDEO_ELEMENT_PATH)) {
    let next = replaceOnce(code,
      '\t#video;\n\t#fullscreenTarget;',
      '\t#video;\n\t#initialTime;\n\t#fullscreenTarget;',
      'element state')
    next = replaceOnce(next,
      '\t\tconst video = document.createElement("video");',
      '\t\tconst video = document.createElement("video");\n\t\tvideo.playsInline = true;\n\t\tvideo.setAttribute("webkit-playsinline", "");\n\t\tvideo.preload = "metadata";',
      'inline playback')
    next = replaceOnce(next,
      '\t\tif (src) video.src = src;\n\t\telse video.removeAttribute("src");',
      '\t\tconst sourceChanged = video.getAttribute("src") !== (src || null);\n\t\tif (sourceChanged) {\n\t\t\tif (src) video.src = src;\n\t\t\telse video.removeAttribute("src");\n\t\t}',
      'source synchronization')
    next = replaceOnce(next,
      '\t\tif (initialTime !== void 0 && initialTime >= 0) try {\n\t\t\tvideo.currentTime = initialTime;\n\t\t} catch {}',
      '\t\tif (initialTime !== void 0 && initialTime >= 0 && (sourceChanged || initialTime !== this.#initialTime)) try {\n\t\t\tvideo.currentTime = initialTime;\n\t\t\tthis.#initialTime = initialTime;\n\t\t} catch {}',
      'initial position synchronization')
    return { code: next, map: null }
  }
  if (normalized.endsWith(VIDEO_CONTEXT_PATH)) {
    let next = replaceOnce(code,
      '\t\tplay() {\n\t\t\tgetVideo()?.play?.();\n\t\t},',
      '\t\tplay() {\n\t\t\ttry { getVideo()?.play?.()?.catch?.(() => {}); } catch {}\n\t\t},',
      'play promise')
    next = replaceOnce(next,
      '\t\trequestFullScreen() {\n\t\t\tgetVideo()?.requestFullscreen?.();\n\t\t},',
      '\t\trequestFullScreen() {\n\t\t\ttry { getVideo()?.requestFullscreen?.()?.catch?.(() => {}); } catch {}\n\t\t},',
      'fullscreen request promise')
    next = replaceOnce(next,
      '\t\texitFullScreen() {\n\t\t\tdocument.exitFullscreen?.();\n\t\t}',
      '\t\texitFullScreen() {\n\t\t\tif (typeof document === "undefined" || !document.fullscreenElement) return;\n\t\t\ttry { document.exitFullscreen?.()?.catch?.(() => {}); } catch {}\n\t\t}',
      'fullscreen exit promise')
    return { code: next, map: null }
  }
  return null
}
