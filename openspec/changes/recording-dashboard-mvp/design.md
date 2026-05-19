# Recording Dashboard MVP Design

The user confirmed a local MVP using macOS recording, ffmpeg post-processing, Tencent Cloud speech recognition, LLM parsing, SQLite persistence, dashboard display, and macOS local notifications.

This implementation provides the integration boundary and testable pipeline. Tencent/LLM production credentials are intentionally not hard-coded. Provider adapters can be replaced behind the transcriber and parser interfaces without changing storage, job orchestration, notification, or dashboard behavior.

SQLite tables:

- `recordings`
- `chunks`
- `transcripts`
- `parsed_results`
- `tasks`
- `processing_jobs`
- `notifications`

Recording source types:

- `recording`
- `manual`

Task statuses:

- `pending_confirm`
- `in_progress`
- `done`
- `dismissed`

Task metadata:

- `priority`: `high`, `medium`, or `low`
- `due_date`: optional local date string
- `project`: optional project ownership label
