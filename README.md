# Recording Dashboard

Backend foundation for the Mac recording dashboard MVP.

## Phase 3 scope

- Compress recordings to MP3 128kbps with `ffmpeg`.
- Split audio into 10 minute chunks with 5 second overlap.
- Transcribe chunks through Tencent Cloud ASR.
- Merge transcripts in chunk order.
- Parse the merged transcript with Claude into structured JSON.
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
TENCENT_ASR_ENGINE=16k_zh

ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```
