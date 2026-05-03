/**
 * get-shopify-token.mjs
 * Starts a local OAuth callback server, prints the auth URL,
 * captures the code, exchanges it for shpat_ token, saves to .env
 *
 * Run: node get-shopify-token.mjs
 * Then open the printed URL in your browser and click Install.
 */

import http from 'http';
import crypto from 'crypto';
import fs from 'fs';

const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID     || '4d1aa37efec4d7516c06c6ec994a4ea6';
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const SHOP          = 'vexr-6601.myshopify.com';
const PORT          = 9999;
const REDIRECT_URI  = `http://localhost:${PORT}/callback`;
const SCOPES        = 'write_orders,read_orders,write_fulfillments,read_fulfillments';
const STATE         = crypto.randomBytes(8).toString('hex');

const authUrl = [
  `https://${SHOP}/admin/oauth/authorize`,
  `?client_id=${CLIENT_ID}`,
  `&scope=${SCOPES}`,
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
  `&state=${STATE}`,
  `&grant_options[]=offline`,
].join('');

console.log('\n╔══════════════════════════════════════════╗');
console.log('║   VEXR — Shopify Token Generator         ║');
console.log('╚══════════════════════════════════════════╝\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n──────────────────────────────────────────');
console.log('Waiting for Shopify callback on port', PORT, '...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') { res.end('ok'); return; }

  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err   = url.searchParams.get('error');

  if (err) {
    const msg = url.searchParams.get('error_description') || err;
    console.error('✗ Shopify returned error:', msg);
    res.writeHead(400); res.end(`<h2>Error: ${msg}</h2>`);
    server.close(); return;
  }

  if (state !== STATE) {
    console.error('✗ State mismatch');
    res.writeHead(400); res.end('<h2>State mismatch</h2>');
    server.close(); return;
  }

  console.log('✓ Got auth code, exchanging for token...');

  try {
    const tokenRes = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
    });
    const data = await tokenRes.json();

    if (!data.access_token) {
      console.error('✗ Token exchange failed:', JSON.stringify(data));
      res.writeHead(500);
      res.end(`<h2>Token exchange failed</h2><pre>${JSON.stringify(data, null, 2)}</pre>`);
      server.close(); return;
    }

    const token = data.access_token;
    console.log('\n✓ Token received:', token);

    // Build .env
    const envContent = [
      '# Printful',
      'PRINTFUL_TOKEN=ihJVcGGE9t6ZhxoqgblWGxyMLwlUD3sPpoRP1UAJ',
      'PRINTFUL_STORE_ID=18077906',
      'PRINTFUL_WEBHOOK_SECRET=',
      '',
      '# Shopify',
      'SHOPIFY_STORE=vexr-6601.myshopify.com',
      `SHOPIFY_ACCESS_TOKEN=${token}`,
      'SHOPIFY_WEBHOOK_SECRET=',
      '',
      '# Server',
      'PORT=3000',
      '',
    ].join('\n');

    fs.writeFileSync('C:/VEXR/fulfillment/.env', envContent, 'utf8');
    console.log('✓ Saved to C:/VEXR/fulfillment/.env\n');
    console.log('Next step: node register-webhook.mjs <RAILWAY_URL>');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">
      <h2 style="color:#008060">✓ Token saved!</h2>
      <p><code>${token}</code></p>
      <p>Saved to <code>C:/VEXR/fulfillment/.env</code></p>
      <p>You can close this tab.</p>
    </body></html>`);

  } catch (e) {
    console.error('✗ Fetch error:', e.message);
    res.writeHead(500); res.end(`<h2>${e.message}</h2>`);
  }

  server.close();
  process.exit(0);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`✗ Port ${PORT} already in use. Kill the process using it and retry.`);
  } else {
    console.error('✗ Server error:', e.message);
  }
  process.exit(1);
});

server.listen(PORT, 'localhost');
