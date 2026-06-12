import express from "express";
import { chromium } from "playwright";
import { fillEngine } from "./fill-engine.js";

const PORT = process.env.PORT || 8787;
const API_TOKEN = process.env.AUTOFILL_API_TOKEN;
const MAX_CONCURRENCY = Number(process.env.AUTOFILL_MAX_CONCURRENCY || 3);

const app = express();
app.use(express.json({ limit: "5mb" }));

let active = 0;
const queue = [];
function withSlot(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        active--;
        const next = queue.shift();
        if (next) next();
      }
    };
    if (active < MAX_CONCURRENCY) run();
    else queue.push(run);
  });
}

app.get("/health", (_req, res) => res.json({ ok: true, active, queued: queue.length }));

app.post("/fill", async (req, res) => {
  if (API_TOKEN) {
    const auth = req.header("authorization") || "";
    if (auth !== `Bearer ${API_TOKEN}`) return res.status(401).json({ error: "unauthorized" });
  }

  const { url, answers } = req.body || {};
  if (typeof url !== "string" || !Array.isArray(answers)) {
    return res.status(400).json({ error: "url (string) and answers (array) are required" });
  }
  let target;
  try {
    target = new URL(url);
    if (!/^https?:$/.test(target.protocol)) throw new Error("bad protocol");
  } catch {
    return res.status(400).json({ error: "invalid url" });
  }

  try {
    const result = await withSlot(async () => {
      const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
      try {
        const context = await browser.newContext({
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          viewport: { width: 1366, height: 900 },
        });
        const page = await context.newPage();
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 45000 });
        try {
          await page.waitForSelector('[role="radiogroup"], [role="checkbox"], input, textarea', { timeout: 15000 });
        } catch {
          // proceed anyway — page may be slow or use unusual markup
        }
        await page.waitForTimeout(1500);
        const fillResult = await page.evaluate(fillEngine, answers);
        const debugInfo = await page.evaluate(() => ({
          title: document.title,
          radiogroups: document.querySelectorAll('[role="radiogroup"]').length,
          checkboxes: document.querySelectorAll('[role="checkbox"]').length,
          textFields: document.querySelectorAll('input[type="text"], textarea').length,
          buttons: Array.from(document.querySelectorAll('[role="button"], button')).map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 10),
        }));
        return { ...fillResult, debug: debugInfo };
      } finally {
        await browser.close();
      }
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "fill failed" });
  }
});

app.listen(PORT, () => console.log(`Surveyor automation service listening on :${PORT}`));
