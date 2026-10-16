import { expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const USERS = {
  operator: 'Oli Operator',
  approver: 'Ana Approver',
  admin: 'Avery Admin',
  viewer: 'Vic Viewer',
} as const;

export async function loginAs(browser: Browser, who: keyof typeof USERS): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as Page & { pageErrors?: string[] }).pageErrors = errors;
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(USERS[who]) }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  return page;
}

export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(', ')}`,
    ),
  ).toEqual([]);
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

export async function approvePlan(browser: Browser, title: string | RegExp) {
  const approver = await loginAs(browser, 'approver');
  await approver.goto('/approvals');
  await approver.getByRole('link', { name: title }).click();
  await expect(approver.getByRole('heading', { name: /^Review:/ })).toBeVisible();
  await approver
    .getByLabel('Reason')
    .fill('Reviewed exact operations, side effects and recovery limits.');
  await approver.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(approver.getByText('Approved').first()).toBeVisible();
  await approver.context().close();
}

export async function executePlan(page: Page, title: string | RegExp) {
  await page.goto('/plans');
  await page.getByRole('link', { name: title }).click();
  await page.getByRole('button', { name: 'Execute' }).click();
  await page.getByRole('button', { name: 'Execute now' }).click();
  await expect(page.getByRole('heading', { name: /^Execution:/ })).toBeVisible();
}
