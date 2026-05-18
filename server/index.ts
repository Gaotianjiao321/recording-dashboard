import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { openDatabase } from './db';
import { RecordingService } from './recordingService';

const db = openDatabase();
const recordings = new RecordingService(db);
const app = new Hono();

app.use(
  '*',
  cors({
    origin: ['http://127.0.0.1:5173', 'http://localhost:5173'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type']
  })
);

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/recordings', (c) => {
  const limit = Number(c.req.query('limit') ?? 20);
  return c.json({ recordings: recordings.listRecordings(Number.isFinite(limit) ? limit : 20) });
});

app.get('/api/recordings/current', (c) => c.json({ active: recordings.getActive() }));

app.post('/api/recordings/start', (c) => {
  try {
    return c.json({ active: recordings.start() }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unable to start recording.' }, 409);
  }
});

app.post('/api/recordings/stop', async (c) => {
  try {
    const recording = await recordings.stop();
    return c.json({ recording });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unable to stop recording.' }, 409);
  }
});

const port = Number(process.env.PORT ?? 4123);

serve(
  {
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1'
  },
  (info) => {
    console.log(`Recording API listening on http://${info.address}:${info.port}`);
  }
);

export { app };

