import { test, expect } from '@playwright/test';
import { expectAccessible, loginAs, noHorizontalOverflow } from './helpers';

const PAGES = [
  '/',
  '/connections',
  '/capabilities',
  '/schema/laptop_requests',
  '/records?table=laptop_requests',
  '/scenario',
  '/plans',
  '/approvals',
  '/executions',
  '/audit',
  '/settings',
];

test('pages fit narrow screens and remain accessible', async ({ browser }) => {
  const page = await loginAs(browser, 'admin');
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await noHorizontalOverflow(page);
  }
  await page.goto('/');
  await page.screenshot({ path: 'docs/screenshots/mobile-overview.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Approvals' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/mobile-navigation.png' });
  await page.getByRole('dialog').getByRole('link', { name: 'Approvals' }).click();
  await expect(page.locator('main h1')).toHaveText('Approvals');
  await expectAccessible(page);
  expect((page as unknown as { pageErrors: string[] }).pageErrors).toEqual([]);
});
