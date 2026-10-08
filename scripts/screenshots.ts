import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dev } from '../src/config.js';
mkdirSync('docs/images', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  deviceScaleFactor: 1,
});
const consoleErrors: string[] = [];
page.on('pageerror', (error) => consoleErrors.push(error.message));
await page.goto(process.env.QUORUM_BROWSER_URL ?? 'http://127.0.0.1:4300');
await page.locator('input[type=file]').first().setInputFiles(resolve(dev, 'actors/admin.json'));
await page.getByRole('heading', { name: 'Wallet overview', exact: true }).waitFor();
await page.getByText('Development treasury', { exact: true }).waitFor();
await page.screenshot({ path: 'docs/images/wallet-overview.png', fullPage: true });
await page.getByRole('button', { name: 'Approval queue' }).click();
await page.getByRole('heading', { name: 'Pending approvals', exact: true }).waitFor();
await page.locator('.transactionrow').first().click();
await page.getByRole('heading', { name: 'Transaction review & timeline' }).waitFor();
await page.screenshot({ path: 'docs/images/approval-queue.png', fullPage: true });
await page.getByRole('button', { name: 'Transactions', exact: true }).click();
const demo = JSON.parse(readFileSync(resolve(dev, 'demo.json'), 'utf8'));
const short = demo.transactionId.slice(0, 8) + '…' + demo.transactionId.slice(-6);
await page.locator('.transactionrow').filter({ hasText: short }).click();
await page.getByText(demo.hash, { exact: true }).waitFor();
await page.screenshot({ path: 'docs/images/completed-transaction.png', fullPage: true });
if (consoleErrors.length) throw new Error('Browser page errors: ' + consoleErrors.join('; '));
// Verify a real browser-generated approval signature reaches and passes the API.
await page.locator('.switch input[type=file]').setInputFiles(resolve(dev, 'actors/bob.json'));
await page.getByRole('button', { name: 'Approval queue' }).click();
await page.locator('.transactionrow').first().click();
await page.getByRole('button', { name: 'Sign exact transaction approval as bob' }).click();
await page.getByText('alice, bob', { exact: true }).waitFor();
console.log('PASS real dashboard screenshots and browser Ed25519 approval.');
await browser.close();
