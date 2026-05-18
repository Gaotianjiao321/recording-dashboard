export type ActiveRecording = {
  id: string;
  filePath: string;
  startedAt: string;
};

export type Recording = {
  id: string;
  title: string | null;
  file_path: string;
  format: string;
  duration_ms: number | null;
  file_size_bytes: number | null;
  status: 'recording' | 'recorded' | 'failed';
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4123';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers
    }
  });

  const body = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }

  return body;
}

export async function getCurrentRecording(): Promise<ActiveRecording | null> {
  const body = await request<{ active: ActiveRecording | null }>('/api/recordings/current');
  return body.active;
}

export async function listRecordings(): Promise<Recording[]> {
  const body = await request<{ recordings: Recording[] }>('/api/recordings?limit=10');
  return body.recordings;
}

export async function startRecording(): Promise<ActiveRecording> {
  const body = await request<{ active: ActiveRecording }>('/api/recordings/start', { method: 'POST' });
  return body.active;
}

export async function stopRecording(): Promise<Recording> {
  const body = await request<{ recording: Recording }>('/api/recordings/stop', { method: 'POST' });
  return body.recording;
}

