'use strict'
// No business transport exists in this public artifact, including after completion.
function errorOf(type, message, extra) { return Object.assign(new Error(message), { type }, extra || {}) }
function blocked() { return Promise.reject(errorOf('demo-blocked', '此入口使用本地演示数据', { code: 'PORTFOLIO_NETWORK_DISABLED' })) }
function classifyRequestError(error) { return error && error.type === 'offline' ? 'offline' : 'service' }
module.exports = { request: blocked, requestOptional: blocked, refreshAccessToken: blocked, clearSession() {}, saveSession() { return false }, classifyRequestError, errorOf }
