/**
 * VEXR Fulfillment Webhook Server
 *
 * POST /webhook/shopify  — receives Shopify order.paid events
 *                          → creates Printful fulfillment order
 *
 * POST /webhook/printful — receives Printful package_shipped events
 *                          → pushes tracking number back to Shopify
 *
 * GET  /health           — liveness probe
 */

import express from 'express';
import crypto  from 'crypto';
import fs      from 'fs';
import path    from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT              = process.env.PORT              || 3000;
const PF_TOKEN          = process.env.PRINTFUL_TOKEN    || 'ihJVcGGE9t6ZhxoqgblWGxyMLwlUD3sPpoRP1UAJ';
const PF_STORE          = process.env.PRINTFUL_STORE_ID || '18077906';
const PF_WH_SECRET      = process.env.PRINTFUL_WEBHOOK_SECRET || '';
const SHOPIFY_STORE     = process.env.SHOPIFY_STORE     || 'vexr-6601.myshopify.com';
const SHOPIFY_TOKEN     = process.env.SHOPIFY_ACCESS_TOKEN || readCliToken();
const SHOPIFY_WH_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';

function readCliToken() {
  try {
    const cfg  = JSON.parse(fs.readFileSync(
      'C:/Users/Asus/AppData/Roaming/shopify-cli-kit-nodejs/Config/config.json', 'utf8'));
    const sess = JSON.parse(cfg.sessionStore)['accounts.shopify.com'];
    return sess[Object.keys(sess)[0]].identity.accessToken;
  } catch { return ''; }
}

// ─── Variant map  (Shopify variantId → Printful config) ──────────────────────
const VARIANT_MAP = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'variant-map.json'), 'utf8')
);

// ─── Printful API ─────────────────────────────────────────────────────────────
async function pf(method, endpoint, body) {
  const res = await fetch(`https://api.printful.com${endpoint}`, {
    method,
    headers: {
      'Authorization':  `Bearer ${PF_TOKEN}`,
      'X-PF-Store-Id':  PF_STORE,
      'Content-Type':   'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ─── Shopify Admin REST API ───────────────────────────────────────────────────
async function shopify(method, endpoint, body) {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-10${endpoint}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ─── HMAC helpers ─────────────────────────────────────────────────────────────
function verifyHmac(rawBody, header, secret) {
  if (!secret || !header) return true; // skip if unconfigured
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(header)); }
  catch { return false; }
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();

// Parse JSON but keep the raw body for HMAC verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, variants: Object.keys(VARIANT_MAP).length, ts: new Date().toISOString() });
});

// ── Shopify order.paid → Printful order ──────────────────────────────────────
app.post('/webhook/shopify', async (req, res) => {
  // Respond to Shopify immediately (must be < 5 s)
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!verifyHmac(req.rawBody, hmac, SHOPIFY_WH_SECRET)) {
    console.warn('[shopify] HMAC failed');
    return res.status(401).end();
  }
  res.status(200).end();

  const order = req.body;
  console.log(`\n[shopify] Order ${order.name} — status: ${order.financial_status}`);

  if (order.financial_status !== 'paid') return;

  // Map line items → Printful items
  const items = [];
  for (const li of order.line_items ?? []) {
    const cfg = VARIANT_MAP[String(li.variant_id)];
    if (!cfg) {
      console.log(`  skip  ${li.name} — no Printful config for variant ${li.variant_id}`);
      continue;
    }
    items.push({
      variant_id:   cfg.printfulVariantId,
      quantity:     li.quantity,
      retail_price: cfg.retailPrice,
      name:         li.name,
      files:        [cfg.printfulFile],
    });
    console.log(`  ✓  ${li.name}  →  Printful variant ${cfg.printfulVariantId}`);
  }

  if (!items.length) {
    console.log('  → No Printful items — order skipped');
    return;
  }

  // Build recipient
  const a = order.shipping_address ?? order.billing_address ?? {};
  const recipient = {
    name:         a.name         || order.email,
    address1:     a.address1     || '',
    address2:     a.address2     || '',
    city:         a.city         || '',
    state_code:   a.province_code || '',
    country_code: a.country_code || 'US',
    zip:          a.zip          || '',
    email:        order.email    || '',
    phone:        a.phone        || order.phone || '',
  };

  // Submit to Printful
  const pfRes = await pf('POST', '/orders', {
    external_id: `shopify_${order.id}`,
    confirm:      true,
    recipient,
    items,
  });

  if (pfRes.code === 200 && pfRes.result?.id) {
    console.log(`  → Printful order ${pfRes.result.id} created ✓`);
  } else {
    console.error(`  → Printful order failed:`, pfRes.error ?? pfRes.result);
  }
});

// ── Printful package_shipped → Shopify tracking ───────────────────────────────
app.post('/webhook/printful', async (req, res) => {
  res.status(200).end();

  const event = req.body;
  if (event.type !== 'package_shipped') return;

  const pfOrder  = event.data?.order;
  const shipment = event.data?.shipment;
  if (!pfOrder || !shipment?.tracking_number) return;

  // Recover Shopify order ID from our external_id convention: "shopify_{id}"
  const shopifyOrderId = pfOrder.external_id?.replace(/^shopify_/, '');
  if (!shopifyOrderId) {
    console.log(`[printful] No Shopify order ID in external_id "${pfOrder.external_id}" — skipping`);
    return;
  }

  console.log(`\n[printful] Order ${pfOrder.id} shipped  →  Shopify order ${shopifyOrderId}`);
  console.log(`  Tracking: ${shipment.tracking_number} via ${shipment.service}`);

  // Get unfulfilled Shopify line items
  const orderData = await shopify('GET', `/orders/${shopifyOrderId}.json`);
  const unfulfilled = (orderData.order?.line_items ?? [])
    .filter(li => !li.fulfillment_status)
    .map(li => ({ id: li.id }));

  if (!unfulfilled.length) {
    console.log('  → All line items already fulfilled — skipping');
    return;
  }

  // Create Shopify fulfillment
  const fulfillRes = await shopify('POST', `/orders/${shopifyOrderId}/fulfillments.json`, {
    fulfillment: {
      tracking_company: shipment.service   || 'Other',
      tracking_number:  shipment.tracking_number,
      tracking_urls:    [shipment.tracking_url].filter(Boolean),
      notify_customer:  true,
      line_items:       unfulfilled,
    }
  });

  if (fulfillRes.fulfillment?.id) {
    console.log(`  → Shopify fulfillment ${fulfillRes.fulfillment.id} created ✓  (customer notified)`);
  } else {
    console.error('  → Shopify fulfillment failed:', fulfillRes.errors ?? fulfillRes);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`VEXR fulfillment server  port ${PORT}`);
  console.log(`Variant map: ${Object.keys(VARIANT_MAP).length} variants`);
  console.log(`Shopify store: ${SHOPIFY_STORE}`);
  console.log(`Printful store: ${PF_STORE}`);
  console.log(`Endpoints:`);
  console.log(`  GET  /health`);
  console.log(`  POST /webhook/shopify`);
  console.log(`  POST /webhook/printful`);
});
