# Recording Dashboard

Backend foundation for the Mac recording dashboard MVP.

## Phase 3 scope

- Compress recordings to MP3 128kbps with `ffmpeg`.
- Split audio into 10 minute chunks with 5 second overlap.
- Transcribe chunks through Tencent Cloud ASR.
- Merge transcripts in chunk order.
- Parse the merged transcript with Hermes into structured JSON.
- Persist transcripts, parsed results, extracted tasks, chunks, and processing jobs in SQLite.

## Commands

```bash
npm install
npm run dev
just ai-check
```

## Environment

```bash
DATABASE_PATH=./data/recording-dashboard.sqlite
RECORDINGS_DIR=./recordings
FFMPEG_BIN=ffmpeg
FFPROBE_BIN=ffprobe

TENCENT_SECRET_ID=...
TENCENT_SECRET_KEY=...
TENCENT_REGION=ap-guangzhou
TENCENT_ASR_ENDPOINT=asr.ap-guangzhou.tencentcloudapi.com
TENCENT_ASR_ENGINE=16k_zh
TENCENT_ASR_MODE=tencent

HERMES_COMMAND=hermes
HERMES_TIMEOUT_MS=120000
HERMES_HEURISTIC_FALLBACK=true
```

`ANTHROPIC_API_KEY` is no longer used. `TENCENT_SECRET_KEY` must be provided locally before
running a real Tencent ASR flow; keep `.env` uncommitted.
