# Recording Dashboard AI Context

This MVP is a local-first Mac recording dashboard.

Core flow:

1. A recording file is saved under `recordings/`.
2. The backend creates a `processing_jobs` row.
3. Audio post-processing chunks the file in chronological order.
4. Each chunk is transcribed through the Tencent Cloud ASR adapter when credentials are present, with sidecar text fallback for local tests.
5. The merged transcript is parsed by Claude when `ANTHROPIC_API_KEY` is present, with a deterministic local parser for tests.
6. Results are written to SQLite.
7. A macOS notification is sent with the summary and key todo.
8. The dashboard reads the latest local SQLite state through `/api/dashboard/today`.

The implementation keeps external providers behind small adapters. Tests inject deterministic fake chunker/transcriber/parser/notifier services so integration coverage does not require paid APIs or notification permissions.
