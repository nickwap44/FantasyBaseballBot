import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function escapeConcatPath(filePath) {
  return filePath.replace(/'/g, "'\\''");
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn("ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderr = "";
    process.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    process.on("error", (error) => {
      reject(error);
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

export async function stitchMp3Segments(mp3Buffers) {
  if (mp3Buffers.length === 0) {
    throw new Error("No MP3 segments were provided.");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fantasy-podcast-"));

  try {
    const segmentPaths = [];

    for (const [index, buffer] of mp3Buffers.entries()) {
      const segmentPath = path.join(tempDir, `segment-${index}.mp3`);
      await writeFile(segmentPath, buffer);
      segmentPaths.push(segmentPath);
    }

    const concatFilePath = path.join(tempDir, "concat.txt");
    const outputPath = path.join(tempDir, "podcast.mp3");
    const concatFile = `${segmentPaths.map((segmentPath) => `file '${escapeConcatPath(segmentPath)}'`).join("\n")}\n`;

    await writeFile(concatFilePath, concatFile, "utf8");
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFilePath,
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath
    ]);

    return readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function convertPcmToMp3(pcmBuffer, sampleRate = 24000) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fantasy-pcm-"));

  try {
    const inputPath = path.join(tempDir, "input.pcm");
    const outputPath = path.join(tempDir, "output.mp3");

    await writeFile(inputPath, pcmBuffer);
    await runFfmpeg([
      "-y",
      "-f",
      "s16le",
      "-ar",
      String(sampleRate),
      "-ac",
      "1",
      "-i",
      inputPath,
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath
    ]);

    return readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function generateMusicCue(kind = "intro") {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fantasy-music-"));

  try {
    const outputPath = path.join(tempDir, `${kind}.mp3`);
    const filterMap = {
      intro:
        "sine=frequency=196:duration=0.12[a0];" +
        "sine=frequency=246.94:duration=0.12[a1];" +
        "sine=frequency=293.66:duration=0.12[a2];" +
        "sine=frequency=392:duration=0.4[a3];" +
        "[a0][a1][a2][a3]concat=n=4:v=0:a=1," +
        "volume=0.26," +
        "aecho=0.8:0.6:40:0.2," +
        "afade=t=out:st=0.58:d=0.16",
      outro:
        "sine=frequency=392:duration=0.14[a0];" +
        "sine=frequency=293.66:duration=0.14[a1];" +
        "sine=frequency=246.94:duration=0.5[a2];" +
        "[a0][a1][a2]concat=n=3:v=0:a=1," +
        "volume=0.18," +
        "aecho=0.8:0.6:45:0.15," +
        "afade=t=out:st=0.56:d=0.22"
    };

    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      filterMap[kind] || filterMap.intro,
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath
    ]);

    return readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
