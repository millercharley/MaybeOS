// Local Netlify Build Plugin: compiles the NestJS API (via its own `nest
// build` / tsc pipeline, which correctly handles decorator metadata) ahead
// of the Netlify Functions bundling step. Deliberately additive — it runs
// alongside whatever build command is already configured for the site,
// rather than replacing it, so the existing Next.js frontend build is
// untouched.
module.exports = {
  onPreBuild: async ({ utils }) => {
    try {
      await utils.run.command('npm run build:api');
    } catch (error) {
      utils.build.failBuild('Failed to build the MaybeOS API for Netlify Functions', { error });
    }
  },
};
