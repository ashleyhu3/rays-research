'use strict';

// Minimal Chrome DevTools Protocol PDF renderer. Unlike the `--print-to-pdf`
// CLI (whose `--print-to-pdf-no-header` flag is broken in current Chromium), CDP's
// Page.printToPDF lets us set real per-page margins AND disable the header/footer,
// so every page gets top/bottom breathing room with no timestamp/URL/page junk.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function findChrome() {
  const candidates = [
    process.env.PDF_CHROME_PATH,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/home/codespace/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* next */ }
  }
  // Fall back to any playwright chromium build present.
  try {
    const base = path.join(process.env.HOME || '/root', '.cache/ms-playwright');
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'chrome-linux64', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* none */ }
  throw new Error('No Chrome/Chromium found. Set PDF_CHROME_PATH.');
}

async function waitForJson(url, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 150));
  }
  throw new Error('Chrome debug endpoint did not come up');
}

function makeSend(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
  });
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const message = { id: ++id, method, params };
    if (sessionId) message.sessionId = sessionId;
    pending.set(message.id, { resolve, reject });
    ws.send(JSON.stringify(message));
  });
}

// Page size and margins come from the document's CSS @page rule (preferCSSPageSize);
// CDP only disables the default header/footer. Margin params are a fallback used
// when the document declares no @page.
async function renderPdf({
  htmlPath, pdfPath, landscape = true,
  margin = { top: 0.6, bottom: 0.45, left: 0.45, right: 0.45 },
}) {
  const chrome = findChrome();
  const port = 9200 + Math.floor(Math.random() * 500);
  const child = spawn(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  try {
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const send = makeSend(ws);

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

    const loaded = new Promise((resolve) => {
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) resolve();
      });
    });
    await send('Page.enable', {}, sessionId);
    await send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sessionId);
    await Promise.race([loaded, new Promise(r => setTimeout(r, 8000))]);
    await new Promise(r => setTimeout(r, 300)); // let fonts/layout settle

    const { data } = await send('Page.printToPDF', {
      landscape,
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
      paperWidth: landscape ? 11.69 : 8.27,
      paperHeight: landscape ? 8.27 : 11.69,
      marginTop: margin.top,
      marginBottom: margin.bottom,
      marginLeft: margin.left,
      marginRight: margin.right,
    }, sessionId);

    fs.writeFileSync(pdfPath, Buffer.from(data, 'base64'));
    ws.close();
    return pdfPath;
  } finally {
    child.kill();
  }
}

module.exports = { renderPdf };
