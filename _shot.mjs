import { chromium } from 'playwright-core';
const DIR = process.env.DIR;
const browser = await chromium.launch({ executablePath: process.env.PW_EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
await page.goto('http://localhost:3001/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
const texts = await page.$$eval('a,button,[role=button],li,span,div', els => els.map(e=>({t:e.textContent.trim(),c:e.className})).filter(o=>o.t && o.t.length<28));
console.log('LIQ:', JSON.stringify([...new Set(texts.map(o=>o.t))].filter(t=>/liquid|fed|balance|interbank|credit/i.test(t)).slice(0,40)));
await browser.close();
