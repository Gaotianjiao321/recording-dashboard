import { execFile, execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { accessSync, constants, existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// GUI apps on macOS don't inherit shell PATH (homebrew, nvm, etc.)
export function findBinary(name, envVar) {
  if (envVar && process.env[envVar]) return process.env[envVar];
  
  // Try common macOS locations first for absolute paths (more robust in GUI apps)
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    `/bin/${name}`,
    `/usr/sbin/${name}`,
    `/sbin/${name}`,
  ];
  for (const path of candidates) {
    try {
      accessSync(path, constants.X_OK);
      console.log(`[audio] Resolved ${name} via candidate: ${path}`);
      return path;
    } catch {}
  }

  // Try resolving via user shell (picks up homebrew, custom paths, nvm etc.)
  if (process.platform === "darwin") {
    try {
      const home = process.env.HOME;
      if (home) {
        // Source multiple profiles to find the binary
        const shellCmd = `source ${home}/.zprofile 2>/dev/null; source ${home}/.zshrc 2>/dev/null; source ${home}/.bash_profile 2>/dev/null; which ${name}`;
        const path = execSync(shellCmd, { shell: "/bin/zsh", timeout: 3000 }).toString().trim();
        if (path && existsSync(path)) {
          console.log(`[audio] Resolved ${name} via shell: ${path}`);
          return path;
        }
      }
    } catch {}
  }

  console.log(`[audio] Falling back to default name for ${name}`);
  return name;
}

const FFPROBE_BIN = findBinary("ffprobe", "FFPROBE_BIN");
const FFMPEG_BIN = findBinary("ffmpeg", "FFMPEG_BIN");

console.log(`[audio] Resolved binaries: ffmpeg=${FFMPEG_BIN}, ffprobe=${FFPROBE_BIN}`);

export async function getAudioDurationSeconds(filePath) {
  const { stdout } = await execFileAsync(FFPROBE_BIN, [
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

    await execFileAsync(FFMPEG_BIN, [
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
