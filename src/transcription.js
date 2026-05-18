import { readFile } from "node:fs/promises";

export function createTranscriber() {
  return async function transcribeChunk(chunk) {
    const sidecarPath = `${chunk.filePath}.txt`;
    try {
      const text = await readFile(sidecarPath, "utf8");
      return text.trim();
    } catch {
      return `Transcript chunk ${chunk.position + 1}: TODO: review ${chunk.filePath}. Decision: keep local-first MVP.`;
    }
  };
}
