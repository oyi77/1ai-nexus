import { chromium } from 'playwright';

async function verifyOkxLeader() {
  const url = 'https://tracker.aitradepulse.com/copy-trading/leader/C84FB1E4F4BA4B2A?platform=okx';
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to:', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  
  // Wait for hydration and data fetch
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000); // Extra wait for React hydration
  
  // Get page content for verification
  const content = await page.content();
  const textContent = await page.textContent('body');
  
  console.log('=== Page Title ===');
  console.log(await page.title());
  
  console.log('\n=== Body Text (first 5000 chars) ===');
  console.log(textContent?.substring(0, 5000));
  
  // Check for EXACT NOT FOUND fallback phrase from the component
  const exactNotFoundPhrase = 'Leader C84FB1E4F4BA4B2A not found on the okx copy-trading leaderboard';
  const hasExactNotFound = textContent?.includes(exactNotFoundPhrase) || false;
  
  // Also check for generic "not found" in visible UI (not in JSON payload)
  const visibleNotFound = await page.locator('text=/not found/i').count() > 0;
  const visible404 = await page.locator('text=/404/i').count() > 0;
  const visibleLeaderNotFound = await page.locator('text=/leader not found/i').count() > 0;
  
  console.log('\n=== NOT FOUND Checks ===');
  console.log('Exact fallback phrase:', hasExactNotFound);
  console.log('Visible "not found":', visibleNotFound);
  console.log('Visible "404":', visible404);
  console.log('Visible "Leader not found":', visibleLeaderNotFound);
  
  // Check for key elements in VISIBLE text (not JSON payload)
  // Use locator to check visible elements
  const checks = {
    'OmniPos name': await page.locator('text=OmniPos').count() > 0,
    'Leader ID': await page.locator('text=C84FB1E4F4BA4B2A').count() > 0,
    'Profit stat': await page.locator('text=/Profit/i').count() > 0,
    'ROI stat': await page.locator('text=/ROI/i').count() > 0,
    'Win Rate': await page.locator('text=/Win Rate/i').count() > 0,
    'Bronze tier': await page.locator('text=Bronze').count() > 0,
    'Leverage': await page.locator('text=/Leverage/i').count() > 0,
    'Profit Sharing': await page.locator('text=/Profit Sharing/i').count() > 0,
    'Instruments': await page.locator('text=/Instruments/i').count() > 0,
  };
  
  // Check equity curve - look for SVG/chart element, NOT just "Equity" text
  const equityCurveSvg = await page.locator('svg').count();
  const equityCurveCanvas = await page.locator('canvas').count();
  const noEquityData = await page.locator('text=/No equity curve data/i').count() > 0;
  
  checks['Equity curve (SVG/Canvas)'] = equityCurveSvg > 0 || equityCurveCanvas > 0;
  checks['No equity data message'] = noEquityData;
  
  console.log('\n=== Key Element Checks (Visible UI) ===');
  for (const [key, value] of Object.entries(checks)) {
    console.log(`${key}: ${value ? '✓ FOUND' : '✗ MISSING'}`);
  }
  
  console.log(`\nSVG elements: ${equityCurveSvg}, Canvas elements: ${equityCurveCanvas}`);
  console.log(`"No equity curve data" message: ${noEquityData}`);
  
  // Take screenshot
  await page.screenshot({ path: 'okx-leader-verification.png', fullPage: true });
  console.log('\nScreenshot saved to okx-leader-verification.png');
  
  // Determine success
  const hasNotFound = hasExactNotFound || visibleNotFound || visible404 || visibleLeaderNotFound;
  
  if (hasNotFound) {
    console.log('\n❌ FAILURE: Page shows "not found" fallback!');
    process.exit(1);
  }
  
  const foundCount = Object.values(checks).filter(v => v).length;
  console.log(`\nFound ${foundCount}/${Object.keys(checks).length} key elements`);
  
  if (foundCount < 5) {
    console.log('\n❌ FAILURE: Too few key elements found!');
    process.exit(1);
  }
  
  // Check equity curve is actually rendering (not empty state)
  if (checks['No equity data message']) {
    console.log('\n⚠️  WARNING: Equity curve shows "No equity curve data" empty state');
  } else if (checks['Equity curve (SVG/Canvas)']) {
    console.log('\n✅ Equity curve is rendering (SVG/Canvas present)');
  }
  
  console.log('\n✅ SUCCESS: Page renders correctly with OKX leader data!');
  
  await browser.close();
}

verifyOkxLeader().catch(console.error);