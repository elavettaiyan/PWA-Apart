import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routeModules = [
  ['modules/auth/routes.ts', 'auth routes'],
  ['modules/flats/routes.ts', 'flats routes'],
  ['modules/billing/routes.ts', 'billing routes'],
  ['modules/payments/routes.ts', 'payments routes'],
  ['modules/complaints/routes.ts', 'complaints routes'],
  ['modules/expenses/routes.ts', 'expenses routes'],
  ['modules/association/routes.ts', 'association routes'],
  ['modules/reports/routes.ts', 'reports routes'],
  ['modules/settings/routes.ts', 'settings routes'],
  ['modules/admin/routes.ts', 'admin routes'],
  ['modules/admin/crmRoutes.ts', 'admin CRM routes'],
  ['modules/staff/routes.ts', 'staff routes'],
  ['modules/visitors/routes.ts', 'visitors routes'],
  ['modules/deliveries/routes.ts', 'deliveries routes'],
  ['modules/premium/routes.ts', 'premium routes'],
  ['modules/notifications/routes.ts', 'notifications routes'],
  ['modules/announcements/routes.ts', 'announcements routes'],
  ['modules/events/routes.ts', 'events routes'],
  ['modules/approvals/routes.ts', 'approvals routes'],
  ['modules/surveys/routes.ts', 'surveys routes'],
  ['modules/assets/routes.ts', 'assets routes'],
  ['modules/public/routes.ts', 'public routes'],
] as const;

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

describe('route module certification', () => {
  for (const [modulePath, label] of routeModules) {
    it(`declares ${label} as an Express router module`, () => {
      const source = readSource(modulePath);

      assert.match(source, /Router\(\)/, `${label} should create an Express router`);
      assert.match(source, /export default router/, `${label} should export the router as default`);
    });
  }

  it('exposes special route handlers used by server bootstrap', () => {
    const paymentsSource = readSource('modules/payments/routes.ts');
    const premiumSource = readSource('modules/premium/routes.ts');
    const assetsSource = readSource('modules/assets/routes.ts');

    assert.match(paymentsSource, /export\s+(async\s+)?function\s+maintenanceRazorpayWebhookHandler|export\s+const\s+maintenanceRazorpayWebhookHandler/);
    assert.match(premiumSource, /export\s+(async\s+)?function\s+premiumWebhookHandler|export\s+const\s+premiumWebhookHandler/);
    assert.match(assetsSource, /export\s+(async\s+)?function\s+sendServiceDueReminders|export\s+const\s+sendServiceDueReminders|export\s*\{\s*sendServiceDueReminders\s*\}/);
  });
});