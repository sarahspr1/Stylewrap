/**
 * analyseOutfit.js
 *
 * Sends an outfit photo to Groq (primary) or Gemini (fallback) for analysis.
 * Prompts and model names live in outfitPrompts.json — edit that file to
 * change what the AI is asked or which model is used, without touching this code.
 *
 * Fallback logic:
 *   1. Try Groq  → if rate-limited (429) or key missing, fall through
 *   2. Try Gemini → if also fails, throw so the caller can show an empty edit form
 */

import PROMPTS from "./outfitPrompts.json";

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(knownItems) {
  const schema = JSON.stringify(PROMPTS.schema, null, 2);

  if (!knownItems.length) {
    return PROMPTS.prompt.base.replace("{schema}", schema);
  }

  const knownList = knownItems
    .map(i => `- "${i.name}" (${i.category}, ${i.color})`)
    .join("\n");

  return PROMPTS.prompt.withKnownItems
    .replace("{knownList}", knownList)
    .replace("{schema}", schema);
}

// ── Response parser (same shape regardless of which API responded) ─────────

function parseResponse(rawText) {
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  const parsed  = JSON.parse(cleaned);

  const rawItems = Array.isArray(parsed)
    ? parsed
    : (parsed.clothing_items || parsed.items || []);

  return {
    style_category: parsed.style_category || parsed.style || null,
    formality_level: parsed.formality_level || null,
    season:          parsed.season          || null,
    color_palette:   Array.isArray(parsed.color_palette) ? parsed.color_palette : [],
    clothing_items:  rawItems,
  };
}

// ── Groq ──────────────────────────────────────────────────────────────────────

async function analyseWithGroq(base64, mediaType, knownItems) {
  const key = import.meta.env.VITE_GROQ_KEY;
  if (!key) throw new Error("NO_KEY");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model:      PROMPTS.groq.model,
      max_tokens: 1024,
      messages: [{
        role:    "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
          { type: "text",      text: buildPrompt(knownItems) },
        ],
      }],
    }),
  });

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok)            throw new Error(`GROQ_${res.status}`);

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  return parseResponse(text);
}

// ── Gemini ────────────────────────────────────────────────────────────────────

async function analyseWithGemini(base64, mediaType, knownItems) {
  const key = import.meta.env.VITE_GEMINI_KEY;
  if (!key) throw new Error("NO_KEY");

  const res = await fetch(
    `${GEMINI_URL}/${PROMPTS.gemini.model}:generateContent?key=${key}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: buildPrompt(knownItems) },
          ],
        }],
      }),
    }
  );

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok)            throw new Error(`GEMINI_${res.status}`);

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return parseResponse(text);
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * @param {string}   base64      - base64-encoded image (no data URL prefix)
 * @param {string}   mediaType   - e.g. "image/jpeg"
 * @param {Array}    knownItems  - previously logged items for wear tracking
 *                                 [{ name, category, color, price }]
 * @returns {Promise<object>}    - { style_category, formality_level, season,
 *                                   color_palette, clothing_items }
 */
export async function analyseOutfit(base64, mediaType, knownItems = []) {
  let groqError;
  try {
    return await analyseWithGroq(base64, mediaType, knownItems);
  } catch (e) {
    groqError = e;
  }

  // Groq failed for any reason — try Gemini before giving up
  try {
    return await analyseWithGemini(base64, mediaType, knownItems);
  } catch (geminiError) {
    // Both failed — throw the original Groq error so the toast shows it
    throw groqError;
  }
}
