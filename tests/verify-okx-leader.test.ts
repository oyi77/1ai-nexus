import { test, expect } from '@playwright/test';

test('OKX leader detail page renders correctly', async ({ page }) => {
  const url = 'https://tracker.aitradepulse.com/copy-trading/leader/C84FB1E4F4BA4B2A?platform=okx';
  
  console.log('Navigating to:', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  
  // Wait for hydration and data fetch
  await page.waitForLoadState('networkidle');
  
  // Get page content for verification
  const content = await page.content();
  const textContent = await page.textContent('body');
  
  console.log('=== Page Title ===');
  console.log(await page.title());
  
  console.log('=== Body Text (first 5000 chars) ===');
  console.log(textContent?.substring(0, 5000));
  
  // Check for NOT FOUND fallback
  const notFound = textContent?.includes('not found') || 
                   textContent?.includes('Not Found') || 
                   textContent?.includes('404') ||
                   textContent?.includes('Leader not found');
  
  console.log('\n=== NOT FOUND Check ===');
  console.log('Not found detected:', notFound);
  
  // Check for key elements
  const checks = {
    'OmniPos name': textContent?.includes('OmniPos') || false,
    'Leader ID': textContent?.includes('C84FB1E4F4BA4B2A') || false,
    'Equity curve': textContent?.includes('Equity') || textContent?.includes('equity') || false,
    'Profit stat': textContent?.includes('Profit') || false,
    'ROI stat': textContent?.includes('ROI') || textContent?.includes('roi') || false,
    'Win Rate': textContent?.includes('Win Rate') || textContent?.includes('win rate') || false,
    'Bronze tier': textContent?.includes('Bronze') || false,
    'Leverage': textContent?.includes('Leverage') || textContent?.includes('leverage') || false,
    'Profit Sharing': textContent?.includes('Profit Sharing') || textContent?.includes('profit sharing') || false,
    'Instruments': textContent?.includes('Instruments') || textContent?.includes('instruments') || false,
  };
  
  console.log('\n=== Key Element Checks ===');
  for (const [key, value] of Object.entries(checks)) {
    console.log(`${key}: ${value ? '✓ FOUND' : '✗ MISSING'}`);
  }
  
  // Take screenshot
  await page.screenshot({ path: 'okx-leader-verification.png', fullPage: true });
  console.log('\nScreenshot saved to okx-leader-verification.png');
  
  // Assert page is not showing "not found"
  expect(notFound).toBeFalsy();
  
  // At least some key elements should be present
  const foundCount = Object.values(checks).filter(v => v).length;
  console.log(`\nFound ${foundCount}/${Object.keys(checks).length} key elements`);
  expect(foundCount).toBeGreaterThan(3);
});