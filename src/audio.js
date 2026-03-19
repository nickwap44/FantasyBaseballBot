import lamejs from "lamejs";

function readString(buffer, start, length) {
  return buffer.subarray(start, start + length).toString("ascii");
}

function parseWav(buffer) {
  if (readString(buffer, 0, 4) !== "RIFF" || readString(buffer, 8, 4) !== "WAVE") {
    throw new Error("Invalid WAV file returned from speech API.");
  }

  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  let offset = 12;

  while (offset < buffer.length) {
    const chunkId = readString(buffer, offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === "data") {
      return {
        channels,
        sampleRate,
        bitsPerSample,
        pcmData: buffer.subarray(offset + 8, offset + 8 + chunkSize)
      };
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  throw new Error("WAV file did not contain audio data.");
}

function pcmBufferToInt16Array(buffer) {
  return new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 2));
}

export function combineWavBuffersToMp3(wavBuffers) {
  const parsed = wavBuffers.map(parseWav);
  const first = parsed[0];

  for (const item of parsed) {
    if (item.channels !== 1 || item.bitsPerSample !== 16) {
      throw new Error("Expected mono 16-bit PCM audio from speech API.");
    }

    if (item.sampleRate !== first.sampleRate) {
      throw new Error("Speech API returned mismatched sample rates.");
    }
  }

  const encoder = new lamejs.Mp3Encoder(1, first.sampleRate, 128);
  const chunks = [];
  const blockSize = 1152;

  for (const item of parsed) {
    const samples = pcmBufferToInt16Array(item.pcmData);
    for (let index = 0; index < samples.length; index += blockSize) {
      const sampleBlock = samples.subarray(index, index + blockSize);
      const mp3Chunk = encoder.encodeBuffer(sampleBlock);
      if (mp3Chunk.length > 0) {
        chunks.push(Buffer.from(mp3Chunk));
      }
    }
  }

  const end = encoder.flush();
  if (end.length > 0) {
    chunks.push(Buffer.from(end));
  }

  return Buffer.concat(chunks);
}
