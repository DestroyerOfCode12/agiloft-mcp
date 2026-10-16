import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

test('keyboard users can skip to content and reach navigation', async ({ browser }) => {
  const page = await loginAs(browser, 'viewer');
  await page.reload();
  await expect(page.locator('main h1')).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});
