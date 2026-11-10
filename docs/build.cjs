// Builds the submission PDFs from docs/src/*.html.
// Usage: node docs/build.cjs https://your-app.onrender.com
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const appUrl = (process.argv[2] || 'https://YOUR-APP.onrender.com').replace(/\/$/, '');
const mcpUrl = `${appUrl}/mcp/demo-volopay-7Qx2pLk9`;
const src = path.join(__dirname, 'src');
const out = [
  ['strategy.html', 'Dealflow_Strategy.pdf'],
  ['architecture.html', 'Dealflow_Architecture.pdf'],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [file, pdf] of out) {
    const html = fs.readFileSync(path.join(src, file), 'utf8')
      .replaceAll('{{APP_URL}}', appUrl).replaceAll('{{MCP_URL}}', mcpUrl);
    const tmp = path.join(src, `.build-${file}`);
    fs.writeFileSync(tmp, html);
    await page.goto(`file://${tmp}`);
    await page.pdf({ path: path.join(__dirname, pdf), format: 'A4', printBackground: true, preferCSSPageSize: true });
    fs.unlinkSync(tmp);
    console.log('wrote', pdf);
  }
  await browser.close();
})();
