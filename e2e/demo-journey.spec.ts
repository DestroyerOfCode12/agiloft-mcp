import { test, expect } from '@playwright/test';
import { approvePlan, executePlan, expectAccessible, loginAs } from './helpers';

const SHOTS = 'docs/screenshots';

test.describe.serial('demo journey', () => {
  test('capabilities explain unsupported administration', async ({ browser }) => {
    const page = await loginAs(browser, 'viewer');
    await page.screenshot({ path: `${SHOTS}/overview.png`, fullPage: true });
    await page.getByRole('link', { name: 'Capability Explorer' }).click();
    await page.getByLabel('Search').fill('rules');
    await page.getByRole('button', { name: 'Create, read or modify rules' }).click();
    const panel = page.getByRole('dialog');
    await expect(panel.getByText('Unsupported').first()).toBeVisible();
    await expect(panel.getByText(/Rules wizard/).first()).toBeVisible();
    await expect(panel.getByRole('link', { name: /REST Interface/ })).toHaveAttribute(
      'href',
      /agiloft-public\.atlassian\.net/,
    );
    await page.screenshot({ path: `${SHOTS}/capability-explorer.png` });
    await page.keyboard.press('Escape');
    await expectAccessible(page);
  });

  test('schema discovery and record search', async ({ browser }) => {
    const page = await loginAs(browser, 'viewer');
    await page.goto('/schema/laptop_requests');
    await expect(page.getByRole('heading', { name: /Schema: Laptop Requests/ })).toBeVisible();
    await expect(page.getByText('Read-only schema')).toBeVisible();
    await expect(page.getByRole('link', { name: 'employees.full_name' }).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/schema-explorer.png`, fullPage: true });
    await expectAccessible(page);

    await page.goto('/records?table=laptop_requests');
    await page.getByRole('button', { name: 'Add filter' }).click();
    await page.getByLabel('Field', { exact: true }).selectOption('status');
    await page.getByLabel('Value').fill('Submitted');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText("Query sent: status='Submitted'")).toBeVisible();
    await page.getByRole('button', { name: '304' }).click();
    await expect(page.getByRole('dialog').getByText(/ignore previous instructions/)).toBeVisible();
    await expect(
      page.getByRole('dialog').getByText('Record content is untrusted data'),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/record-detail.png` });
    await expectAccessible(page);
  });

  test('scenario builder produces a reviewable plan', async ({ browser }) => {
    const page = await loginAs(browser, 'operator');
    await page.getByRole('link', { name: 'Scenario Builder' }).click();
    await page.getByRole('button', { name: 'Use the laptop-request example' }).click();
    await page.getByRole('button', { name: 'Analyse' }).click();
    await expect(page.getByText(/planning steps/).first()).toBeVisible();
    await expect(
      page.getByText('Which business calendar and public holidays define "overdue"?').first(),
    ).toBeVisible();
    await expect(page.getByText('Manual administrator step').first()).toBeVisible();
    await expect(page.getByText('Configuration records (automated)').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/scenario-builder.png`, fullPage: true });
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Create change plan' }).click();
    await expect(
      page.getByRole('heading', { name: /Implement: Laptop Request approval process/ }),
    ).toBeVisible();
    await expect(
      page.getByText('Administrator instructions (not performed by Agiloft Control)').first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByText('Awaiting approval').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/change-plan.png`, fullPage: true });
  });

  test('stale-data conflict blocks a write', async ({ browser }) => {
    await approvePlan(browser, 'Route LR-1004 to manager approval');
    const page = await loginAs(browser, 'operator');
    // Another Agiloft user edits the record after approval.
    await page.goto('/connections');
    await page.getByRole('button', { name: 'Apply external edit' }).click();
    await expect(page.getByText(/Record changed as if by another Agiloft user/)).toBeVisible();
    await executePlan(page, 'Route LR-1004 to manager approval');
    await expect(page.getByText('Failed').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/STALE_RECORD/)).toBeVisible();
    await expect(page.getByText(/Nothing was written/).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/execution-stale.png`, fullPage: true });
  });

  test('partial failure is reported without rollback', async ({ browser }) => {
    // Use the seeded scenario plan; the one created above stays awaiting approval.
    const seededTitle = /Implement: Laptop Request approval process/;
    const op = await loginAs(browser, 'operator');
    await op.goto('/connections');
    await op.getByLabel('Inject a fault').selectOption('reject_next_write');
    await op.getByLabel('Table (optional)').fill('task_templates');
    await op.getByRole('button', { name: 'Arm fault' }).click();
    await expect(op.getByText(/Armed: reject_next_write on task_templates/)).toBeVisible();

    const approver = await loginAs(browser, 'approver');
    await approver.goto('/approvals');
    const links = approver.getByRole('link', { name: seededTitle });
    await links.last().click();
    // Separation of duties: approver did not create the plan, so approval is allowed.
    await approver.getByLabel('Reason').fill('Approved for demo of partial failure handling.');
    await approver.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(approver.getByText('Approved').first()).toBeVisible();
    await approver.screenshot({ path: `${SHOTS}/approval-decided.png`, fullPage: true });

    await op.goto('/plans?status=approved');
    await op.getByRole('link', { name: seededTitle }).click();
    await op.getByRole('button', { name: 'Execute' }).click();
    await expect(op.getByRole('dialog').getByText(/cannot be undone/)).toBeVisible();
    await op.getByRole('button', { name: 'Execute now' }).click();
    await expect(op.getByText('Partially succeeded').first()).toBeVisible({ timeout: 30_000 });
    await expect(op.getByText(/Nothing was rolled back automatically/)).toBeVisible();
    await expect(op.getByText('Skipped').first()).toBeVisible();
    await op.screenshot({ path: `${SHOTS}/execution-partial.png`, fullPage: true });
    await expectAccessible(op);
  });

  test('approved record change executes successfully', async ({ browser }) => {
    const op = await loginAs(browser, 'operator');
    await op.goto('/records?table=tasks');
    await op.getByRole('button', { name: '505' }).click();
    await op.getByRole('button', { name: 'Propose an update' }).click();
    await op.getByRole('dialog').getByLabel('Status').selectOption('In Progress');
    await op.getByRole('dialog').getByLabel('Reason').fill('Imaging unblocked');
    await op.getByRole('button', { name: 'Create change plan' }).click();
    await expect(op.getByRole('heading', { name: /Update Tasks #505/ })).toBeVisible();
    await expect(op.getByRole('cell', { name: 'Blocked' })).toBeVisible();
    await op.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(op.getByText('Awaiting approval').first()).toBeVisible();

    await approvePlan(browser, 'Update Tasks #505');
    await executePlan(op, 'Update Tasks #505');
    await expect(op.getByText('Succeeded').first()).toBeVisible({ timeout: 20_000 });
    await op.screenshot({ path: `${SHOTS}/execution-success.png`, fullPage: true });
  });

  test('approvers cannot approve their own plans and viewers cannot approve at all', async ({
    browser,
  }) => {
    const viewer = await loginAs(browser, 'viewer');
    await viewer.goto('/approvals');
    await viewer
      .getByRole('link', { name: /Implement: Laptop Request/ })
      .first()
      .click();
    await expect(viewer.getByText(/do not have the approver role/)).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  });

  test('audit log records decisions and denials', async ({ browser }) => {
    const admin = await loginAs(browser, 'admin');
    await admin.goto('/audit');
    await expect(admin.getByRole('cell', { name: 'plans.approve' }).first()).toBeVisible();
    await expect(admin.getByRole('cell', { name: 'execution.finished' }).first()).toBeVisible();
    await admin.screenshot({ path: `${SHOTS}/audit-log.png` });
    await expectAccessible(admin);
    await admin.goto('/settings');
    await expect(admin.getByText('Writes enabled').first()).toBeVisible();
    await admin.screenshot({ path: `${SHOTS}/settings.png`, fullPage: true });
    await expectAccessible(admin);
  });
});
