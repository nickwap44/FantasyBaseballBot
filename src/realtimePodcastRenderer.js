import WebSocket from "ws";
import { convertPcmToMp3, stitchMp3Segments } from "./audioAssembler.js";
import { config } from "./config.js";
import { buildVerbatimSpeechInput, buildVerbatimSpeechInstructions } from "./podcastSpeech.js";

const REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
const PCM_SAMPLE_RATE = 24000;

function createRealtimeSocket() {
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  return new WebSocket(REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      "OpenAI-Beta": "realtime=v1"
    }
  });
}

function waitForSocketOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function buildSessionInstructions(speakerInstructions) {
  return buildVerbatimSpeechInstructions(
    [
      "Render the line as natural spoken podcast audio.",
      "Keep the performance conversational and human.",
      speakerInstructions
    ].filter(Boolean).join(" ")
  );
}

function sendEvent(ws, event) {
  ws.send(JSON.stringify(event));
}

function renderLineWithRealtime({ text, voice, instructions }) {
  return new Promise(async (resolve, reject) => {
    const ws = createRealtimeSocket();
    const audioChunks = [];
    let settled = false;

    const cleanup = () => {
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    const finish = async () => {
      if (settled) {
        return;
      }
      settled = true;

      try {
        const pcmBuffer = Buffer.concat(audioChunks);
        const mp3 = await convertPcmToMp3(pcmBuffer, PCM_SAMPLE_RATE);
        cleanup();
        resolve(mp3);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    ws.on("error", (error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    });

    ws.on("message", (rawMessage) => {
      const event = JSON.parse(rawMessage.toString());

      if (event.type === "error") {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(event.error?.message || "Realtime API error"));
        }
        return;
      }

      if (event.type === "response.output_audio.delta" || event.type === "response.audio.delta") {
        const chunk = event.delta || event.audio || "";
        if (chunk) {
          audioChunks.push(Buffer.from(chunk, "base64"));
        }
        return;
      }

      if (event.type === "response.done") {
        finish().catch(reject);
      }
    });

    try {
      await waitForSocketOpen(ws);
      sendEvent(ws, {
        type: "session.update",
        session: {
          modalities: ["audio"],
          output_audio_format: "pcm16",
          voice,
          instructions: buildSessionInstructions(instructions)
        }
      });

      sendEvent(ws, {
        type: "response.create",
        response: {
          conversation: "none",
          modalities: ["audio"],
          output_audio_format: "pcm16",
          voice,
          input: [
            {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: buildVerbatimSpeechInput(text)
                }
              ]
            }
          ]
        }
      });
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    }
  });
}

export async function buildRealtimePodcastAudio(lines, getVoiceForSpeaker, getInstructionsForSpeaker) {
  const segments = [];

  for (const line of lines) {
    segments.push(
      await renderLineWithRealtime({
        text: line.text,
        voice: getVoiceForSpeaker(line.speaker),
        instructions: getInstructionsForSpeaker(line.speaker)
      })
    );
  }

  return stitchMp3Segments(segments);
}
