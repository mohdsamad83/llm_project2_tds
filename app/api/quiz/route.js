// app/api/quiz/route.js
import axios from "axios";
import { askAipipeForJson } from "../../../lib/aipipe.js";
import { fetchAndParse } from "../../../lib/data.js";

async function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function launchBrowser() {
  const isProduction = process.env.VERCEL || process.env.NODE_ENV === "production";
  if (isProduction) {
    // use playwright-core in production (Playwright browsers should be installed during build)
    const playwright = await import("playwright-core");
    const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"], ignoreHTTPSErrors: true });
    return { browser, playwright };
  } else {
    try {
      const playwright = await import("playwright");
      const browser = await playwright.chromium.launch({ headless: true });
      return { browser, playwright };
    } catch {
      const playwright = await import("playwright-core");
      const browser = await playwright.chromium.launch({ headless: true });
      return { browser, playwright };
    }
  }
}

export async function POST(req) {
  let payload;
  try { payload = await req.json(); } catch { return jsonResponse(400, { error: "Invalid JSON" }); }

  const { email, secret, url } = payload;
  if (!email || !secret || !url) return jsonResponse(400, { error: "Missing required fields: email, secret, url" });
  if (!process.env.MY_SECRET) return jsonResponse(500, { error: "Server misconfigured: MY_SECRET not set" });
  if (secret !== process.env.MY_SECRET) return jsonResponse(403, { error: "Invalid secret" });

  let browserObj = null;
  const results = [];
  try {
    const launched = await launchBrowser();
    browserObj = launched.browser;
    const context = await browserObj.newContext();
    const page = await context.newPage();

    let currentUrl = url;
    const MAX_STEPS = 10;
    let step = 0;

    while (currentUrl && step < MAX_STEPS) {
      step += 1;
      try { await page.goto(currentUrl, { waitUntil: "networkidle", timeout: 45000 }); }
      catch {
        try { await page.waitForLoadState("networkidle", { timeout: 60000 }); } catch {}
      }

      const pageText = await page.evaluate(() => document.body?.innerText || "");
      const pageHtml = await page.evaluate(() => document.documentElement?.outerHTML || "");
      const submitUrlMatch = pageText.match(/https?:\/\/[^\s'"]+\/submit[^\s'"]*/i);
      let foundSubmit = submitUrlMatch ? submitUrlMatch[0] : null;

      const links = await page.evaluate(() => Array.from(document.querySelectorAll("a")).map(a => ({ href: a.href, text: a.innerText || "" })));
      const dataLinks = links.filter(l => /(\.csv|\.xlsx?|\.pdf|\.json)$/i.test(l.href));

      let dataSummary = null;
      if (dataLinks.length > 0) {
        try { const dl = dataLinks[0].href; const parsed = await fetchAndParse(dl); dataSummary = { url: dl, type: parsed.type, size: parsed.size, parsed: parsed.parsed }; }
        catch (e) { dataSummary = { error: "Failed to fetch/parse data link", detail: String(e) }; }
      }

      const instructionParts = [
        `You are given the scraped page text and any attached data summary.`,
        `Task: Extract the data-related task from the page, perform required analysis/transformations, and produce output JSON with field "answer".`,
        `If a visualization is requested, return "visualization_base64" (data URI PNG).`,
        `Return JSON only.`
      ];
      if (dataSummary) instructionParts.push(`Data summary (truncated): ${JSON.stringify(dataSummary).slice(0,2000)}`);
      const instruction = instructionParts.join("\n");

      let aiResp;
      try { aiResp = await askAipipeForJson(pageText + "\n\n" + pageHtml, instruction); }
      catch (e) { return jsonResponse(500, { error: "AIPipe failed", detail: String(e) }); }

      const answerObj = aiResp.parsedJson ?? { raw: aiResp.rawText };

      let submitEndpoint = null;
      try {
        const action = await page.evaluate(() => { const form = document.querySelector("form"); return form ? form.getAttribute("action") : null; });
        if (action) submitEndpoint = new URL(action, currentUrl).toString();
      } catch {}

      if (!submitEndpoint && foundSubmit) submitEndpoint = foundSubmit;
      if (!submitEndpoint) {
        try { submitEndpoint = new URL("/submit", currentUrl).toString(); } catch { return jsonResponse(500, { error: "Could not determine submit endpoint", pageText: pageText.slice(0,1000) }); }
      }

      const submitPayload = { email, secret, url: currentUrl, answer: answerObj.answer ?? answerObj };
      let submitResp;
      try { const resp = await axios.post(submitEndpoint, submitPayload, { headers: { "Content-Type": "application/json" }, timeout: 30000 }); submitResp = resp.data; }
      catch (e) { return jsonResponse(500, { error: "Submission failed", detail: e?.response?.data ?? e?.message ?? String(e) }); }

      results.push({ url: currentUrl, answer: submitPayload.answer, submitResponse: submitResp });

      if (submitResp && typeof submitResp.url === "string" && submitResp.url.length > 0) currentUrl = submitResp.url; else currentUrl = null;
    }

    try { await browserObj.close(); } catch {}
    return jsonResponse(200, { correct: true, results });
  } catch (err) {
    try { if (browserObj) await browserObj.close(); } catch {}
    return jsonResponse(500, { error: "Unexpected error", detail: String(err?.message ?? err) });
  }
}
