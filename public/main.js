const selectors = {
  refresh: "#refresh",
  uploadInput: "#recording-upload",
  uploadButton: "#upload-recording",
  uploadStatus: "#upload-status",
  autoRefresh: "#auto-refresh",
  lastUpdated: "#last-updated",
  boardStatus: "#board-status",
  recordings: "#recordings",
  processing: "#processing",
  pending: "#pending",
  pendingCount: "#pending-count",
  processingCount: "#processing-count",
  doneCount: "#done-count",
  pendingColumn: "#pending-column",
  processingColumn: "#processing-column",
  doneColumn: "#done-column",
  summary: "#summary",
  decisions: "#decisions",
  questions: "#questions",
  notifications: "#notifications",
  completionBar: "#completion-bar"
};

const normalPollMs = 30_000;
const activePollMs = 5_000;
const allowedExtensions = new Set(["wav", "mp3", "m4a"]);
const state = {
  data: null,
  isRefreshing: false,
  isUploading: false,
  pollTimer: null
};

async function refresh() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  setLoading(true);

  try {
    const response = await fetch("/api/dashboard/today");
    if (!response.ok) {
      throw new Error(`看板数据请求失败：${response.status}`);
    }

    const data = await response.json();
    state.data = data;
    renderDashboard(data);
    document.querySelector(selectors.boardStatus).textContent = statusTextForPolling(data);
    document.querySelector(selectors.lastUpdated).textContent = `最近刷新 ${formatTime(new Date())}`;
  } catch (error) {
    document.querySelector(selectors.boardStatus).textContent = "看板数据加载失败";
    renderEmptyState("加载失败，请稍后重试。");
    console.error(error);
  } finally {
    state.isRefreshing = false;
    setLoading(false);
    scheduleAutoRefresh();
  }
}

function renderDashboard(data) {
  const stats = data.stats ?? {};
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const recordings = Array.isArray(data.recordings) ? data.recordings : [];
  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  const latest = data.latest ?? null;

  const pendingTasks = tasks.filter((task) => task.status === "pending_confirm");
  const processingRecordings = recordings.filter((recording) => recording.status === "processing");
  const doneRecordings = recordings.filter((recording) => recording.status === "processed");

  setText(selectors.recordings, stats.recordings ?? recordings.length);
  setText(selectors.processing, stats.processing ?? processingRecordings.length);
  setText(selectors.pending, stats.pendingTasks ?? pendingTasks.length);

  setText(selectors.pendingCount, pendingTasks.length);
  setText(selectors.processingCount, processingRecordings.length);
  setText(selectors.doneCount, doneRecordings.length);

  renderCards(selectors.pendingColumn, pendingTasks.map(createTaskCard), "暂无待确认任务。");
  renderCards(selectors.processingColumn, processingRecordings.map(createProcessingCard), "暂无处理中的录音。");
  renderCards(selectors.doneColumn, doneRecordings.map(createDoneCard), "暂无已完成录音。");

  setText(selectors.summary, latest?.summary || "暂无已处理录音。");
  renderInsights(selectors.decisions, latest?.decisions, "暂无决策。");
  renderInsights(selectors.questions, latest?.open_questions, "暂无待解决问题。", "question");
  renderNotifications(notifications);

  const total = Math.max(recordings.length, 1);
  const completionRate = Math.round((doneRecordings.length / total) * 100);
  document.querySelector(selectors.completionBar).style.width = `${completionRate}%`;
}

function createTaskCard(task) {
  return {
    tag: "待确认",
    tagClass: "tag-task",
    title: task.title || "未命名任务",
    meta: `任务 #${task.id}`,
    avatar: "待",
    points: `录音 #${task.recording_id}`,
    actions: [
      { label: "确认", variant: "primary", taskId: task.id, onClick: () => updateTask(task.id, "confirm") },
      { label: "忽略", variant: "ghost", taskId: task.id, onClick: () => updateTask(task.id, "dismiss") }
    ]
  };
}

function createProcessingCard(recording) {
  return {
    tag: "处理中",
    tagClass: "tag-processing",
    title: recordingTitle(recording, "录音正在转写或解析"),
    meta: `录音 #${recording.id}`,
    avatar: "进",
    points: formatDuration(recording.duration_seconds),
    status: "处理中，自动刷新会临时加快到 5 秒"
  };
}

function createDoneCard(recording) {
  return {
    tag: "已处理",
    tagClass: "tag-done",
    title: recordingTitle(recording, "录音已生成纪要"),
    meta: `录音 #${recording.id}`,
    avatar: "完",
    points: formatDuration(recording.duration_seconds),
    progress: 100
  };
}

function renderCards(selector, cards, emptyText) {
  const container = document.querySelector(selector);
  container.replaceChildren(...(cards.length ? cards.map(renderCard) : [renderEmptyCard(emptyText)]));
}

function renderCard(card) {
  const article = document.createElement("article");
  article.className = "kanban-card";

  const tag = document.createElement("span");
  tag.className = `card-tag ${card.tagClass}`;
  tag.textContent = card.tag;

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = card.title;

  const meta = document.createElement("div");
  meta.className = "card-meta";

  const left = document.createElement("div");
  left.className = "card-meta-left";

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.textContent = card.avatar;

  const points = document.createElement("span");
  points.className = "points";
  points.textContent = card.points;

  const id = document.createElement("span");
  id.textContent = card.meta;

  left.append(avatar, points);
  meta.append(left, id);
  article.append(tag, title);

  if (card.status) {
    const status = document.createElement("p");
    status.className = "card-status";
    status.textContent = card.status;
    article.append(status);
  }

  if (typeof card.progress === "number") {
    const progress = document.createElement("div");
    progress.className = "progress";
    const bar = document.createElement("span");
    bar.style.width = `${card.progress}%`;
    progress.append(bar);
    article.append(progress);
  }

  article.append(meta);

  if (Array.isArray(card.actions) && card.actions.length) {
    const actions = document.createElement("div");
    actions.className = "card-actions";
    for (const action of card.actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `card-action ${action.variant}`;
      button.textContent = action.label;
      if (action.taskId) button.dataset.taskId = String(action.taskId);
      button.addEventListener("click", action.onClick);
      actions.append(button);
    }
    article.append(actions);
  }

  return article;
}

function renderEmptyCard(text) {
  const element = document.createElement("div");
  element.className = "empty-card";
  element.textContent = text;
  return element;
}

function renderInsights(selector, items, emptyText, variant = "") {
  const list = document.querySelector(selector);
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];

  if (!safeItems.length) {
    const empty = document.createElement("p");
    empty.className = "insight-empty";
    empty.textContent = emptyText;
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(
    ...safeItems.map((item) => {
      const element = document.createElement("div");
      element.className = `insight-item ${variant}`.trim();
      element.textContent = item;
      return element;
    })
  );
}

function renderNotifications(notifications) {
  const list = document.querySelector(selectors.notifications);
  const safeNotifications = notifications.filter((notification) => notification?.body || notification?.title);

  if (!safeNotifications.length) {
    const empty = document.createElement("p");
    empty.className = "insight-empty";
    empty.textContent = "暂无通知。";
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(
    ...safeNotifications.slice(0, 8).map((notification) => {
      const item = document.createElement("article");
      item.className = "notification-item";

      const title = document.createElement("strong");
      title.textContent = notificationTitle(notification.title);

      const body = document.createElement("p");
      body.textContent = notification.body || "通知内容为空。";

      const meta = document.createElement("span");
      meta.textContent = `录音 #${notification.recording_id} · ${formatDateTime(notification.sent_at)}`;

      item.append(title, body, meta);
      return item;
    })
  );
}

function renderEmptyState(message) {
  setText(selectors.recordings, 0);
  setText(selectors.processing, 0);
  setText(selectors.pending, 0);
  setText(selectors.pendingCount, 0);
  setText(selectors.processingCount, 0);
  setText(selectors.doneCount, 0);
  setText(selectors.summary, message);
  renderCards(selectors.pendingColumn, [], "暂无待确认任务。");
  renderCards(selectors.processingColumn, [], "暂无处理中的录音。");
  renderCards(selectors.doneColumn, [], "暂无已完成录音。");
  renderInsights(selectors.decisions, [], "暂无决策。");
  renderInsights(selectors.questions, [], "暂无待解决问题。", "question");
  renderNotifications([]);
  document.querySelector(selectors.completionBar).style.width = "0%";
}

async function uploadRecording(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!allowedExtensions.has(extension)) {
    setUploadStatus("请选择 wav、mp3 或 m4a 音频文件。", true);
    return;
  }

  const formData = new FormData();
  formData.append("recording", file);
  state.isUploading = true;
  setUploadState(true, `正在上传并处理：${file.name}`);
  scheduleAutoRefresh();

  try {
    const response = await fetch("/api/recordings/process", {
      method: "POST",
      body: formData
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || `录音处理失败：${response.status}`);
    }
    setUploadStatus(`处理完成：录音 #${payload.recordingId}`);
    await refresh();
  } catch (error) {
    setUploadStatus(error.message || "上传失败，请重试。", true);
    console.error(error);
  } finally {
    state.isUploading = false;
    setUploadState(false);
    document.querySelector(selectors.uploadInput).value = "";
    scheduleAutoRefresh();
  }
}

async function updateTask(taskId, action) {
  setTaskButtonsDisabled(taskId, true);
  document.querySelector(selectors.boardStatus).textContent = action === "confirm" ? "正在确认任务" : "正在忽略任务";

  try {
    const response = await fetch(`/api/tasks/${taskId}/${action}`, { method: "POST" });
    if (!response.ok) {
      const payload = await readJsonResponse(response);
      throw new Error(payload.error || `任务操作失败：${response.status}`);
    }
    await refresh();
  } catch (error) {
    document.querySelector(selectors.boardStatus).textContent = "任务操作失败";
    console.error(error);
  } finally {
    setTaskButtonsDisabled(taskId, false);
  }
}

function setTaskButtonsDisabled(taskId, disabled) {
  document.querySelectorAll(`[data-task-id="${taskId}"]`).forEach((button) => {
    button.disabled = disabled;
  });
}

function setLoading(isLoading) {
  const refreshButton = document.querySelector(selectors.refresh);
  refreshButton.disabled = isLoading;
  refreshButton.textContent = isLoading ? "刷新中" : "刷新";
}

function setUploadState(isUploading, message = "可上传 wav、mp3、m4a 录音文件。") {
  const uploadButton = document.querySelector(selectors.uploadButton);
  uploadButton.disabled = isUploading;
  uploadButton.textContent = isUploading ? "处理中" : "上传录音";
  setUploadStatus(message, false);
}

function setUploadStatus(message, isError = false) {
  const uploadStatus = document.querySelector(selectors.uploadStatus);
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle("error", isError);
}

function scheduleAutoRefresh() {
  window.clearTimeout(state.pollTimer);
  if (!isAutoRefreshEnabled()) return;
  state.pollTimer = window.setTimeout(refresh, pollIntervalMs(state.data));
}

function pollIntervalMs(data) {
  return hasProcessing(data) || state.isUploading ? activePollMs : normalPollMs;
}

function hasProcessing(data) {
  const recordings = Array.isArray(data?.recordings) ? data.recordings : [];
  return recordings.some((recording) => recording.status === "processing") || Number(data?.stats?.processing) > 0;
}

function statusTextForPolling(data) {
  if (!isAutoRefreshEnabled()) return "看板数据已同步，自动刷新已关闭";
  const seconds = pollIntervalMs(data) / 1000;
  return hasProcessing(data) || state.isUploading ? `处理中，${seconds} 秒后自动刷新` : `看板数据已同步，${seconds} 秒后自动刷新`;
}

function isAutoRefreshEnabled() {
  return document.querySelector(selectors.autoRefresh).checked;
}

function setText(selector, value) {
  document.querySelector(selector).textContent = String(value);
}

function recordingTitle(recording, fallback) {
  return recording?.id ? `第 ${recording.id} 条录音 · ${fallback}` : fallback;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "未计时";
  }

  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`;
}

function formatTime(date) {
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "时间未知";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function notificationTitle(title) {
  if (!title || title === "Recording parsed") return "录音解析完成";
  return title;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

document.querySelector(selectors.refresh).addEventListener("click", () => {
  window.clearTimeout(state.pollTimer);
  refresh();
});
document.querySelector(selectors.uploadButton).addEventListener("click", () => {
  document.querySelector(selectors.uploadInput).click();
});
document.querySelector(selectors.uploadInput).addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) uploadRecording(file);
});
document.querySelector(selectors.autoRefresh).addEventListener("change", () => {
  scheduleAutoRefresh();
  document.querySelector(selectors.boardStatus).textContent = document.querySelector(selectors.autoRefresh).checked
    ? statusTextForPolling(state.data)
    : "自动刷新已关闭";
});

refresh();
