import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, RefreshCw, Square } from 'lucide-react';
import {
  type ActiveRecording,
  type Recording,
  getCurrentRecording,
  listRecordings,
  startRecording,
  stopRecording
} from './api';
import './styles.css';

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function formatDuration(ms: number | null): string {
  if (!ms) {
    return '-';
  }

  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) {
    return '-';
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function App() {
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeSeconds = useTicker(active?.startedAt);

  async function refresh() {
    const [current, latest] = await Promise.all([getCurrentRecording(), listRecordings()]);
    setActive(current);
    setRecordings(latest);
  }

  useEffect(() => {
    refresh().catch((refreshError: unknown) => {
      setError(refreshError instanceof Error ? refreshError.message : '无法连接录音服务');
    });
  }, []);

  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return recordings.filter((recording) => new Date(recording.started_at).toDateString() === today).length;
  }, [recordings]);

  async function toggleRecording() {
    setBusy(true);
    setError(null);

    try {
      if (active) {
        await stopRecording();
      } else {
        await startRecording();
      }

      await refresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '录音操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Recording Dashboard</p>
          <h1>工作录音</h1>
        </div>
        <div className={`status-pill ${active ? 'is-recording' : ''}`}>
          <span />
          {active ? '录音中' : '空闲'}
        </div>
      </aside>

      <section className="workspace">
        <div className="toolbar">
          <div>
            <p className="eyebrow">今日</p>
            <h2>{todayCount} 条录音</h2>
          </div>
          <button className="icon-button" type="button" onClick={() => refresh()} aria-label="刷新录音列表">
            <RefreshCw size={18} />
          </button>
        </div>

        <section className="recorder-panel">
          <button
            className={`record-button ${active ? 'is-stop' : ''}`}
            type="button"
            disabled={busy}
            onClick={toggleRecording}
          >
            {active ? <Square size={26} fill="currentColor" /> : <Mic size={30} />}
            <span>{active ? '停止录音' : '开始录音'}</span>
          </button>

          <div className="recording-meta">
            <span>当前时长</span>
            <strong>{active ? formatDuration(activeSeconds * 1000) : '0:00'}</strong>
          </div>
        </section>

        {error ? <p className="error-banner">{error}</p> : null}

        <section className="list-section">
          <div className="section-heading">
            <h3>最近录音</h3>
            <span>{recordings.length} 条</span>
          </div>

          <div className="recording-list">
            {recordings.length === 0 ? (
              <p className="empty-state">暂无录音</p>
            ) : (
              recordings.map((recording) => (
                <article className="recording-row" key={recording.id}>
                  <div>
                    <strong>{recording.title ?? recording.id}</strong>
                    <span>{recording.file_path}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>开始</dt>
                      <dd>{formatTime(recording.started_at)}</dd>
                    </div>
                    <div>
                      <dt>时长</dt>
                      <dd>{formatDuration(recording.duration_ms)}</dd>
                    </div>
                    <div>
                      <dt>大小</dt>
                      <dd>{formatBytes(recording.file_size_bytes)}</dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>{recording.status}</dd>
                    </div>
                  </dl>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function useTicker(startedAt?: string): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setSeconds(0);
      return;
    }

    const update = () => {
      setSeconds(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));
    };

    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return seconds;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

