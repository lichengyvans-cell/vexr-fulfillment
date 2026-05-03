/**
 * register-webhook.mjs
 * Registers the Shopify order.paid webhook and the Printful package_shipped webhook.
 * Run once: node register-webhook.mjs <PUBLIC_URL>
 *
 * Example: node register-webhook.mjs https://vexr-fulfillment.railway.app
 */

import fs from 'fs';

const PUBLIC_URL = process.argv[2];
if (!PUBLIC_URL) {
  console.error('Usage: node register-webhook.mjs <PUBLIC_URL>');
  console.error('Example: node register-webhook.mjs https://vexr-fulfillment.railway.app');
  process.exit(1);
}

// Shopify config
const SHOP         = 'vexr-6601.myshopify.com';
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || readCliToken();

// Printful config
const PF_TOKEN = process.env.PRINTFUL_TOKEN || 'ihJVcGGE9t6ZhxoqgblWGxyMLwlUD3sPpoRP1UAJ';
const PF_STORE = process.env.PRINTFUL_STORE_ID || '18077906';

function readCliToken() {
  try {
    const cfg  = JSON.parse(fs.readFileSync(
      'C:/Users/Asus/AppData/Roaming/shopify-cli-kit-nodejs/Config/config.json', 'utf8'));
    const sess = JSON.parse(cfg.sessionStore)['accounts.shopify.com'];
    return sess[Object.keys(sess)[0]].identity.accessToken;
  } catch { return ''; }
}

async function shopify(method, endpoint, body) {
  const res = await fetch(`https://${SHOP}/admin/api/2024-10${endpoint}`, {
    method,
    headers: { 'Authorization': `Bearer ${SHOPIFY_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function pf(method, path, body) {
  const res = await fetch(`https://api.printful.com${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${PF_TOKEN}`,
      'X-PF-Store-Id': PF_STORE,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function run() {
  console.log(`Registering webhooks → ${PUBLIC_URL}\n`);

  // ── 1. Shopify: order.paid ─────────────────────────────────────────────────
  const shopifyEndpoint = `${PUBLIC_URL}/webhook/shopify`;

  // Check if already registered
  const existing = await shopify('GET', '/webhooks.json?topic=orders/paid');
  const alreadyExists = existing.webhooks?.some(w => w.address === shopifyEndpoint);

  if (alreadyExists) {
    console.log('✓ Shopify webhook already registered:', shopifyEndpoint);
  } else {
    const r = await shopify('POST', '/webhooks.json', {
      webhook: {
        topic:   'orders/paid',
        address: shopifyEndpoint,
        format:  'json',
      }
    });
    if (r.webhook?.id) {
      console.log('✓ Shopify webhook registered  id:', r.webhook.id);
      console.log('  Topic:   orders/paid');
      console.log('  URL:     ' + shopifyEndpoint);
      console.log('  Secret:  ' + r.webhook.api_client_secret);
      console.log('\n  → Set SHOPIFY_WEBHOOK_SECRET=' + r.webhook.api_client_secret + ' in your .env\n');
    } else {
      console.error('✗ Shopify webhook failed:', r.errors ?? r);
    }
  }

  // ── 2. Printful: package_shipped ───────────────────────────────────────────
  const printfulEndpoint = `${PUBLIC_URL}/webhook/printful`;

  const pfWebhooks = await pf('GET', '/webhooks');
  const pfHooks = pfWebhooks.result?.url ? [pfWebhooks.result] : [];
  const pfExists = pfHooks.some(w => w.url === printfulEndpoint);

  if (pfExists) {
    console.log('✓ Printful webhook already registered:', printfulEndpoint);
  } else {
    // Printful supports one webhook URL per store — registers all events
    const pfR = await pf('POST', '/webhooks', {
      url:    printfulEndpoint,
      types: ['package_shipped', 'order_failed'],
    });
    if (pfR.code === 200) {
      console.log('✓ Printful webhook registered');
      console.log('  URL:    ' + printfulEndpoint);
      console.log('  Events: package_shipped, order_failed');
    } else {
      console.error('✗ Printful webhook failed:', pfR.error ?? pfR.result);
    }
  }

  console.log('\nDone. Start your server and test with a real order.');
}

run().catch(console.error);
