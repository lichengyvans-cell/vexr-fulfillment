/**
 * generate-shopify-token.mjs
 * Creates a Shopify Custom App with write_orders + write_fulfillments scopes
 * and outputs a permanent Admin API access token.
 *
 * Run: node generate-shopify-token.mjs
 * Requires: Shopify CLI already authenticated (used for the initial setup only).
 */

import fs from 'fs';

const SHOP = 'vexr-6601.myshopify.com';

function readCliToken() {
  try {
    const cfg  = JSON.parse(fs.readFileSync(
      'C:/Users/Asus/AppData/Roaming/shopify-cli-kit-nodejs/Config/config.json', 'utf8'));
    const sess = JSON.parse(cfg.sessionStore)['accounts.shopify.com'];
    return sess[Object.keys(sess)[0]].identity.accessToken;
  } catch { return ''; }
}

const CLI_TOKEN = readCliToken();
if (!CLI_TOKEN) {
  console.error('No Shopify CLI token found. Run: shopify auth login');
  process.exit(1);
}

async function shopify(method, endpoint, body) {
  const res = await fetch(`https://${SHOP}/admin/api/2024-10${endpoint}`, {
    method,
    headers: { 'Authorization': `Bearer ${CLI_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function run() {
  console.log('Creating Shopify Custom App for VEXR Fulfillment...\n');

  // Check if app already exists
  const apps = await shopify('GET', '/custom_apps.json');
  let app = apps.apps?.find(a => a.title === 'VEXR Fulfillment');

  if (!app) {
    const r = await shopify('POST', '/custom_apps.json', {
      application: {
        title:  'VEXR Fulfillment',
        contact_email: 'admin@vexr.com',
      }
    });
    app = r.application;
  }

  if (!app?.id) {
    console.error('Failed to create app:', apps);
    process.exit(1);
  }

  console.log('App:', app.title, '(id:', app.id + ')');

  // Update scopes
  await shopify('PUT', `/custom_apps/${app.id}.json`, {
    application: {
      api_permissions: {
        access_scopes: 'write_orders,read_orders,write_fulfillments,read_fulfillments'
      }
    }
  });

  // Get API credentials
  const creds = await shopify('GET', `/custom_apps/${app.id}/api.json`);
  const token = creds?.api?.admin_api_token || creds?.api?.api_key;

  if (token) {
    console.log('\n✓ Shopify Admin API token:\n');
    console.log('  SHOPIFY_ACCESS_TOKEN=' + token);
    console.log('\nAdd this to your .env file.');
    // Auto-write to .env if it exists
    if (fs.existsSync('.env')) {
      let env = fs.readFileSync('.env', 'utf8');
      env = env.replace(/^SHOPIFY_ACCESS_TOKEN=.*/m, 'SHOPIFY_ACCESS_TOKEN=' + token);
      fs.writeFileSync('.env', env);
      console.log('.env updated automatically.');
    }
  } else {
    console.log('Credentials:', JSON.stringify(creds, null, 2));
    console.log('\nGo to Shopify Admin → Apps → App development → VEXR Fulfillment → API credentials to copy the token manually.');
  }
}

run().catch(console.error);
