// Thin shim: the real implementation is compiled ahead of time by the
// build-api plugin (which runs `nest build` — a proper TypeScript compile
// that preserves the decorator metadata Nest's DI needs, unlike Netlify's
// default esbuild function bundler). This file just loads that output, so
// esbuild only ever has to bundle plain, already-compiled JS.
exports.handler = require('../../apps/api/dist/lambda.js').handler;
