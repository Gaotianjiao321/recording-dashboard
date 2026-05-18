import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getAudioDurationSeconds(filePath) {
  const { stdout } = await execFileAsync(process.env.FFPROBE_BIN ?? "ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  return Number(stdout.trim()) || 0;
}

export async function chunkAudio(filePath, options = {}) {
  const chunkSeconds = options.chunkSeconds ?? 600;
  const overlapSeconds = options.overlapSeconds ?? 5;
  const outputDir = options.outputDir ?? join(process.env.RECORDINGS_DIR ?? "recordings", "chunks");
  const durationSeconds = await getAudioDurationSeconds(filePath);
  const chunks = [];
  const baseName = basename(filePath, extname(filePath));

  await mkdir(outputDir, { recursive: true });

  if (durationSeconds <= 0) {
    throw new Error("audio duration is zero or unreadable");
  }

  for (let start = 0, position = 0; start < durationSeconds; position += 1) {
    const end = Math.min(start + chunkSeconds, durationSeconds);
    const outputPath = join(outputDir, `${baseName}-${String(position).padStart(3, "0")}.mp3`);

    await execFileAsync(process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-y",
      "-v",
      "error",
      "-ss",
      String(Math.max(0, start)),
      "-to",
      String(end),
      "-i",
      filePath,
      "-b:a",
      "128k",
      outputPath
    ]);

    chunks.push({ filePath: outputPath, position, startSeconds: start, endSeconds: end });
    if (end >= durationSeconds) break;
    start = Math.max(end - overlapSeconds, start + 1);
  }

  return { durationSeconds, chunks };
}
