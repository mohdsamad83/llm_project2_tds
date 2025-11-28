// lib/aipipe.js
import axios from "axios";

/**
 * askAipipeForJson(pageText, instruction)
 * Returns { rawText, parsedJson }
 */
export async function askAipipeForJson(pageText, instruction, model = "openai/gpt-4.1-nano", max_tokens = 3000) {
  if (!process.env.AIPIPE_TOKEN) throw new Error("AIPIPE_TOKEN missing in environment");

  const system = `You are a precise data analysis assistant. Respond with valid JSON ONLY (no commentary, no markdown).`;
  const user = `PAGE_TEXT:
${pageText}

INSTRUCTION:
${instruction}

Return valid JSON only. Example:
{"answer": 123, "explanation": "one-line", "visualization_base64": "data:image/png;base64,..."} `;

  const payload = { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens, temperature: 0 };
  const url = "https://aipipe.org/openrouter/v1/chat/completions";

  try {
    const resp = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${process.env.AIPIPE_TOKEN}`, "Content-Type": "application/json" },
      timeout: 60000
    });

    const assistantContent = resp?.data?.choices?.[0]?.message?.content ?? resp?.data?.output ?? JSON.stringify(resp.data);
    const rawText = (typeof assistantContent === "string") ? assistantContent.trim() : String(assistantContent);

    let parsedJson = null;
    try { parsedJson = JSON.parse(rawText); }
    catch {
      const firstBrace = rawText.indexOf("{");
      const lastBrace = rawText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try { parsedJson = JSON.parse(rawText.slice(firstBrace, lastBrace + 1)); } catch { parsedJson = null; }
      }
    }

    return { rawText, parsedJson };
  } catch (err) {
    const detail = err?.response?.data ?? err?.message ?? String(err);
    throw new Error("AIPipe request failed: " + JSON.stringify(detail));
  }
}
