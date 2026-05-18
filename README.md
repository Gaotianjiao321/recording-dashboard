# Recording Dashboard

Backend foundation for the Mac recording dashboard MVP.

## Phase 3 scope

- Compress recordings to MP3 128kbps with `ffmpeg`.
- Split audio into 4 minute chunks with 5 second overlap for Tencent local-file uploads.
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
AUDIO_CHUNK_SECONDS=240

TENCENT_ASR_ENDPOINT=asr.ap-guangzhou.tencentcloudapi.com
TENCENT_SECRET_ID=...
TENCENT_SECRET_KEY=...
TENCENT_REGION=ap-guangzhou
TENCENT_ASR_ENGINE=16k_zh

HERMES_API_URL=...
HERMES_API_KEY=...
HERMES_MODEL=...
```

Tencent ASR local-file uploads are limited to 5 MB per request. The default chunk length is 240 seconds at 128 kbps so chunks stay below that limit for local upload mode.
