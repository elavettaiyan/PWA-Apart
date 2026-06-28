import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

const expectedApiMounts = [
  '/api/auth',
  '/api/flats',
  '/api/billing',
  '/api/payments',
  '/api/complaints',
  '/api/expenses',
  '/api/association',
  '/api/reports',
  '/api/public',
  '/api/settings',
  '/api/admin/crm',
  '/api/admin',
  '/api/staff',
  '/api/visitors',
  '/api/deliveries',
  '/api/premium',
  '/api/notifications',
  '/api/announcements',
  '/api/events',
  '/api/approvals',
  '/api/surveys',
  '/api/assets',
];

describe('API registry certification', () => {
  it('mounts every expected API module', () => {
    for (const mountPath of expectedApiMounts) {
      assert.match(indexSource, new RegExp(`app\\.use\\('${mountPath.replace(/\//g, '\\/')}'`), `${mountPath} should be mounted`);
    }
  });

  it('keeps raw Premium webhook registration before JSON parsing', () => {
    const webhookIndex = indexSource.indexOf("app.post('/api/premium/webhook'");
    const jsonParserIndex = indexSource.indexOf('app.use(express.json');

    assert.ok(webhookIndex >= 0, 'Premium webhook route should be registered');
    assert.ok(jsonParserIndex >= 0, 'JSON parser should be registered');
    assert.ok(webhookIndex < jsonParserIndex, 'Premium webhook must stay before express.json() for signature verification');
  });

  it('mounts CRM routes before generic admin routes', () => {
    const crmIndex = indexSource.indexOf("app.use('/api/admin/crm'");
    const adminIndex = indexSource.indexOf("app.use('/api/admin'");

    assert.ok(crmIndex >= 0, 'CRM admin routes should be mounted');
    assert.ok(adminIndex >= 0, 'Generic admin routes should be mounted');
    assert.ok(crmIndex < adminIndex, 'CRM routes must stay before generic admin routes');
  });
});