/**
 * test-order.mjs
 * Simulates a Shopify order.paid webhook against the local server.
 * Run after starting server: node test-order.mjs [variantId]
 *
 * Default variant: first mapped Oversize Tee XS Black Gold Logo
 */

import fs from 'fs';
import crypto from 'crypto';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';

// Pick a real mapped variant to test
const variantMap = JSON.parse(fs.readFileSync('./variant-map.json', 'utf8'));
const testVariantId = process.argv[2] || Object.keys(variantMap)[0];
const cfg = variantMap[testVariantId];

if (!cfg) {
  console.error('Variant not found in map:', testVariantId);
  process.exit(1);
}

const payload = {
  id:               9999999999001,
  name:             '#TEST-001',
  financial_status: 'paid',
  email:            'test@vexr.com',
  phone:            '+1 555 000 0000',
  shipping_address: {
    name:          'Test Customer',
    address1:      '100 Test Boulevard',
    address2:      '',
    city:          'Los Angeles',
    province_code: 'CA',
    country_code:  'US',
    zip:           '90001',
    phone:         '+1 555 000 0000',
  },
  line_items: [{
    id:               8888888888001,
    variant_id:       Number(testVariantId),
    name:             cfg.shopifyName,
    quantity:         1,
    price:            cfg.retailPrice,
    fulfillment_status: null,
  }],
};

const body = JSON.stringify(payload);
const hmac = WEBHOOK_SECRET
  ? crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('base64')
  : 'test-no-secret';

console.log('Test order → ' + SERVER_URL + '/webhook/shopify');
console.log('Variant:', testVariantId, '—', cfg.shopifyName);
console.log('→ Printful variant:', cfg.printfulVariantId, '| logo:', cfg.printfulFile.url.split('/').pop());

const res = await fetch(`${SERVER_URL}/webhook/shopify`, {
  method:  'POST',
  headers: {
    'Content-Type':            'application/json',
    'X-Shopify-Topic':         'orders/paid',
    'X-Shopify-Hmac-Sha256':   hmac,
    'X-Shopify-Shop-Domain':   'vexr-6601.myshopify.com',
  },
  body,
});

console.log('Response:', res.status, res.statusText);
console.log('Check server logs for Printful order result.');
