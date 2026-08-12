// Thin shim, same pattern as api.js: the real implementation is compiled
// ahead of time by the build-api plugin, so esbuild only ever bundles
// plain, already-compiled JS.
//
// The cron expression lives in netlify.toml rather than here, so both
// functions and their schedules are visible in one file.
exports.handler = require('../../apps/api/dist/scheduled.js').handler;
