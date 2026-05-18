# Recording Dashboard AI Context

This MVP is a local-first Mac recording dashboard.

Core flow:

1. A recording file is saved under `recordings/`.
2. The backend creates a `processing_jobs` row.
3. Audio post-processing chunks the file in chronological order.
4. Each chunk is transcribed.
5. The merged transcript is parsed into summary, tasks, decisions, open questions, and ideas.
6. Results are written to SQLite.
7. A macOS notification is sent with the summary and key todo.
8. The dashboard reads the latest local SQLite state through `/api/dashboard/today`.

The implementation keeps external providers behind small adapters. Tests inject deterministic fake chunker/transcriber/parser/notifier services so integration coverage does not require paid APIs or notification permissions.
