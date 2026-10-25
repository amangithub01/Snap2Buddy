import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

// Load .env if present
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - allow up to 15MB payloads for base64 images (up to 8MB raw images)
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PRIMARY_MODEL = 'gemma-4-31b-it';
const FALLBACK_MODEL = 'gemma-4-26b-a4b-it';

/**
 * Robust JSON extraction as required:
 * Strips ```json fences from model response before JSON.parse,
 * and falls back to extracting text between first "{" and last "}".
 */
function extractAndParseJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty response received from Gemma.');
  }

  // 1. Strip markdown code fences
  let cleaned = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Try parsing directly
  try {
    return JSON.parse(cleaned);
  } catch (err1) {
    // 2. Fall back to text between first '{' and last '}'
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = cleaned.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch (err2) {
        console.error('Failed to parse extracted JSON substring:', candidate);
        throw new Error('Model output contained malformed JSON structure.');
      }
    }
    throw new Error('No JSON payload detected in model response.');
  }
}

/**
 * Call Gemini REST API with specified model, multimodal payload.
 */
async function callGemmaMultimodal(model, promptText, mimeType, base64Data, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  const resJson = await response.json();

  if (!response.ok) {
    const errorMsg = resJson?.error?.message || `API error (${response.status} ${response.statusText})`;
    const err = new Error(errorMsg);
    err.status = response.status;
    err.details = resJson?.error;
    throw err;
  }

  const candidate = resJson?.candidates?.[0];
  if (!candidate || !candidate.content || !candidate.content.parts) {
    throw new Error('No content returned by Gemma model.');
  }

  const rawText = candidate.content.parts
    .map(p => p.text || '')
    .filter(Boolean)
    .join('');

  return { text: rawText, modelUsed: model };
}

/**
 * Orchestrate call with primary model (gemma-4-31b-it) and fallback (gemma-4-26b-a4b-it).
 */
async function runWithFallback(promptText, mimeType, base64Data, apiKey) {
  try {
    console.log(`[Snap2Study] Attempting primary model: ${PRIMARY_MODEL}...`);
    return await callGemmaMultimodal(PRIMARY_MODEL, promptText, mimeType, base64Data, apiKey);
  } catch (primaryErr) {
    console.warn(`[Snap2Study] Primary model (${PRIMARY_MODEL}) failed: ${primaryErr.message}. Falling back to ${FALLBACK_MODEL}...`);
    try {
      return await callGemmaMultimodal(FALLBACK_MODEL, promptText, mimeType, base64Data, apiKey);
    } catch (fallbackErr) {
      console.error(`[Snap2Study] Both models failed. Fallback error: ${fallbackErr.message}`);
      throw new Error(`Primary (${PRIMARY_MODEL}) failed: ${primaryErr.message}. Fallback (${FALLBACK_MODEL}) also failed: ${fallbackErr.message}`);
    }
  }
}

// Config check endpoint (Keeps API key out of UI, only checks readiness)
app.get('/api/status', (req, res) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  res.json({
    configured: hasKey,
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL
  });
});

// Endpoint to generate study kit
app.post('/api/generate', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      return res.status(500).json({
        error: 'Gemini API key is not configured on the server. Please add GEMINI_API_KEY to your .env file or environment variables.'
      });
    }

    const { imageBase64, mimeType, difficulty } = req.body;

    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ error: 'Please upload an image file (JPG, PNG, or WEBP).' });
    }

    // Validate mime types
    const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validMimes.includes(mimeType.toLowerCase())) {
      return res.status(400).json({ error: 'Unsupported format. Allowed formats: JPG, PNG, WEBP.' });
    }

    // Validate size (max 8MB = ~10.6MB base64)
    const approximateSizeInMB = (imageBase64.length * 3 / 4) / (1024 * 1024);
    if (approximateSizeInMB > 8.5) {
      return res.status(400).json({ error: 'Image size exceeds maximum 8 MB limit.' });
    }

    const level = difficulty || 'Intermediate';

    // The required exact prompt instruction
    const promptText = `You are a study assistant. Read all visible text and understand any diagrams in this image. Return ONLY valid JSON with this shape: {title, summary, key_concepts: [string], flashcards: [{q, a}], quiz: [{question, options: [4 strings], answer_index: 0-3, explanation}]}. Create 6 flashcards and 4 quiz questions. Base everything ONLY on what is in the image. Difficulty: ${level}. If the image has no readable study content, return {error: 'No readable study content found in this image.'}`;

    // Clean base64 data if data URI scheme was sent
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');

    const { text, modelUsed } = await runWithFallback(promptText, mimeType, cleanBase64, apiKey);

    // Parse JSON
    const parsedData = extractAndParseJson(text);

    // Check if model returned readable study content error
    if (parsedData.error) {
      return res.status(200).json({
        isContentError: true,
        error: parsedData.error,
        modelUsed
      });
    }

    // Sanitize / validate structure
    const studyKit = {
      title: parsedData.title || 'Study Kit',
      summary: parsedData.summary || 'Summary generated from your notes.',
      key_concepts: Array.isArray(parsedData.key_concepts) ? parsedData.key_concepts : [],
      flashcards: Array.isArray(parsedData.flashcards) ? parsedData.flashcards : [],
      quiz: Array.isArray(parsedData.quiz) ? parsedData.quiz : [],
      modelUsed
    };

    res.json(studyKit);
  } catch (err) {
    console.error('[Snap2Study] Generation error:', err);
    res.status(500).json({
      error: err.message || 'An error occurred while generating your study kit. Please try again.'
    });
  }
});

// Endpoint for follow-up questions
app.post('/api/ask', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      return res.status(500).json({
        error: 'Gemini API key is not configured on the server. Please add GEMINI_API_KEY to your .env file or environment variables.'
      });
    }

    const { imageBase64, mimeType, question } = req.body;

    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ error: 'Image context is missing.' });
    }

    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Please enter a question.' });
    }

    const promptText = `You are a study assistant. Answer the user's question about the uploaded image notes in under 150 words using ONLY the image as context. Keep the answer direct, clear, and factual based solely on what is visible in the image.\n\nUser Question: ${question.trim()}`;

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');

    const { text, modelUsed } = await runWithFallback(promptText, mimeType, cleanBase64, apiKey);

    res.json({
      answer: text.trim(),
      modelUsed
    });
  } catch (err) {
    console.error('[Snap2Study] Follow-up question error:', err);
    res.status(500).json({
      error: err.message || 'Failed to answer follow-up question. Please try again.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`[Snap2Study] Server running on http://localhost:${PORT}`);
  console.log(`[Snap2Study] Model pipeline: Primary = ${PRIMARY_MODEL}, Fallback = ${FALLBACK_MODEL}`);
  console.log(`[Snap2Study] API Key configured: ${Boolean(process.env.GEMINI_API_KEY)}`);
});
