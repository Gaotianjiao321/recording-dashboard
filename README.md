# Recording Dashboard

Mac personal work recording dashboard MVP.

## Development

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the Hono API and the Tauri desktop app. The API listens on `http://127.0.0.1:4123` and stores local data in `data/app.sqlite`.

## Recording

The MVP recording path uses `ffmpeg` with macOS AVFoundation to capture the default microphone input into `recordings/*.wav`. Override the input device with:

```bash
AUDIO_INPUT_DEVICE=":0" pnpm dev
```

## Checks

```bash
just ai-check
```

