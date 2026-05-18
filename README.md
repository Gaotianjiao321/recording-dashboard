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
npm run dev
just ai-check
```

## Environment

```bash
MAX_CHUNK_BYTES=26214400

TENCENT_SECRET_ID=...
TENCENT_SECRET_KEY=...
TENCENT_REGION=ap-guangzhou
TENCENT_ASR_ENGINE=16k_zh
TENCENT_ASR_TIMEOUT_MS=900000

ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```
