'use strict'
// Telemetry is deliberately absent from the public demonstration.
module.exports = { record() {}, requestResult() {}, reset() {}, flush() { return Promise.resolve() }, capture() { return null } }
