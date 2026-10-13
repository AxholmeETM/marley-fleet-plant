// Cloudflare Workers entry point. Runs the same Express app as src/server.js, through
// Cloudflare's Node.js HTTP server support. Files in public/ are served by Cloudflare directly.
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { createApp } from './app.js';
import { perRequest, endRequest } from './db.js';

// Copy the Worker's variables and secrets into process.env, where the app reads its settings.
// Done on the first request: Cloudflare doesn't allow Hyperdrive to be read before then.
let settingsLoaded = false;
function loadSettings() {
  if (settingsLoaded) return;
  settingsLoaded = true;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && process.env[key] === undefined) process.env[key] = value;
  }
  // Workers can't open an encrypted Postgres connection themselves. Hyperdrive (the HYPERDRIVE binding in
  // wrangler.jsonc) holds the encrypted connection to Supabase and hands the app a local one.
  if (env.HYPERDRIVE) {
    process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
    process.env.DATABASE_SSL = 'off';
  }
}

let app = null;

const server = createServer((req, res) => {
  loadSettings();
  // Tell the app whether the visitor is on HTTPS, so it can set secure sign-in cookies.
  if (!req.headers['x-forwarded-proto']) {
    req.headers['x-forwarded-proto'] = /"scheme":"http"/.test(req.headers['cf-visitor'] || '') ? 'http' : 'https';
  }
  perRequest(async (scope) => {
    res.on('close', () => endRequest(scope));
    try {
      // The first request starts the app: it checks the database tables and the first admin account.
      app ||= createApp().catch((err) => { app = null; throw err; });
      (await app)(req, res);
    } catch (err) {
      console.error('Could not start:', err);
      if (!res.headersSent) res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      // Show the reason (never a connection string) so whoever set it up can fix the secret.
      const reason = String(err && err.message || err).replace(/postgres(ql)?:\/\/\S+/gi, '[connection string]');
      // Names only, never values, to show which settings reached the site.
      const seen = Object.keys(env).filter((k) => typeof env[k] === 'string' || k === 'HYPERDRIVE').sort().join(', ') || 'none';
      res.end(`The site could not reach its database. Check the DATABASE_URL secret in Cloudflare.\n\nReason: ${reason}\n\nSettings the site can see: ${seen}`);
    }
  });
});
server.listen(8080);

export default httpServerHandler({ port: 8080 });
