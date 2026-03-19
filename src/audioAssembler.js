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
      "-c",
      "copy",
      outputPath
    ]);

    return readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
