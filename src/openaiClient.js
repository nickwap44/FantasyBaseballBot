import { config } from "./config.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

function getHeaders(extra = {}) {
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  return {
    Authorization: `Bearer ${config.openAiApiKey}`,
    ...extra
  };
}

function extractTextFromOutputItems(output = []) {
  const chunks = [];

  for (const item of output) {
    if (!item || !Array.isArray(item.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (!contentItem) {
        continue;
      }

      if (typeof contentItem.text === "string" && contentItem.text.trim()) {
        chunks.push(contentItem.text.trim());
        continue;
      }

      if (typeof contentItem.output_text === "string" && contentItem.output_text.trim()) {
        chunks.push(contentItem.output_text.trim());
      }
    }
  }

  return chunks.join("\n").trim();
}

export async function generateText({
  systemPrompt,
  userPrompt,
  model = "gpt-5-mini",
  temperature = null
}) {
  const body = {
    model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }]
      }
    ]
  };

  // GPT-5 models reject temperature, so only send it when explicitly set on other models.
  if (temperature !== null && !model.startsWith("gpt-5")) {
    body.temperature = temperature;
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI text generation failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const directText = payload.output_text?.trim() || "";
  if (directText) {
    return directText;
  }

  const fallbackText = extractTextFromOutputItems(payload.output);
  if (fallbackText) {
    return fallbackText;
  }

  console.warn("OpenAI text response was empty.", {
    model,
    outputTextPresent: typeof payload.output_text === "string",
    outputItemCount: Array.isArray(payload.output) ? payload.output.length : 0,
    responseShape: JSON.stringify(
      {
        id: payload.id,
        status: payload.status,
        output_text: payload.output_text,
        output: payload.output
      },
      null,
      2
    ).slice(0, 4000)
  });

  return "";
}

export async function generateSpeech({
  text,
  voice = "alloy",
  format = "wav",
  instructions = null
}) {
  const body = {
    model: "gpt-4o-mini-tts",
    voice,
    response_format: format,
    input: text
  };

  if (instructions) {
    body.instructions = instructions;
  }

  const response = await fetch(OPENAI_SPEECH_URL, {
    method: "POST",
    headers: getHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI speech generation failed: ${response.status} ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
