# Recording Dashboard MVP Design

The user confirmed a local MVP using macOS recording, ffmpeg post-processing, Tencent Cloud speech recognition, LLM parsing, SQLite persistence, dashboard display, and macOS local notifications.

This implementation provides the integration boundary and testable pipeline. Tencent/LLM production credentials are intentionally not hard-coded. Provider adapters can be replaced behind the transcriber and parser interfaces without changing storage, job orchestration, notification, or dashboard behavior.

SQLite tables:

- `recordings`
- `chunks`
- `transcripts`
- `parsed_results`
- `tasks`
- `projects`
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

- `body`: optional task details shown under the bold task title
- `priority`: `high`, `medium`, or `low`
- `due_date`: optional local date string
- `project`: optional project ownership label

Project behavior:

- `GET /api/projects` lists selectable projects.
- `POST /api/projects` creates a project by unique name.
- `GET /api/dashboard/projects` groups non-dismissed tasks by `project`, using `未归属` for empty project values.

Parser behavior:

- The parser still returns the same top-level keys: `summary`, `my_todos`, `waiting_for_others`, `decisions`, `open_questions`, and `ideas`.
- `my_todos` items use `{ title, body }` so parsed recording tasks can render a bold title and separate body.
- Generated tasks remain `pending_confirm` until the user edits or advances them.
