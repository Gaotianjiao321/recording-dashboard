const selectors = {
  refresh: "#refresh",
  uploadButton: "#upload-recording",
  addTaskButton: "#add-task",
  uploadStatus: "#upload-status",
  autoRefresh: "#auto-refresh",
  lastUpdated: "#last-updated",
  boardStatus: "#board-status",
  recordings: "#recordings",
  processing: "#processing",
  pending: "#pending",
  waiting: "#waiting",
  pendingCount: "#pending-count",
  processingCount: "#processing-count",
  waitingCount: "#waiting-count",
  pendingColumn: "#pending-column",
  processingColumn: "#processing-column",
  waitingColumn: "#waiting-column",
  projectBoard: "#project-board",
  summary: "#summary",
  decisions: "#decisions",
  questions: "#questions",
  notifications: "#notifications",
  chipRow: "#chip-row",
  taskModal: "#task-modal",
  taskModalTitle: "#task-modal-title",
  taskTitle: "#task-title",
  taskBody: "#task-body",
  taskPriority: "#task-priority",
  taskDueDate: "#task-due-date",
  taskProject: "#task-project",
  projectSelectContainer: "#project-select-container",
  newProject: "#new-project",
  newProjectForm: "#new-project-form",
  newProjectInput: "#new-project-input",
  newProjectSubmit: "#new-project-submit",
  newProjectCancel: "#new-project-cancel",
  modalClose: "#modal-close",
  modalCancel: "#modal-cancel",
  modalSubmit: "#modal-submit"
};

const normalPollMs = 30_000;
const activePollMs = 5_000;
const state = {
  data: null,
  isRefreshing: false,
  isUploading: false,
  isRecording: false,
  recorder: null,
  recordingChunks: [],
  recordingStream: null,
  recordingStartedAt: 0,
  recordingTimer: null,
  pollTimer: null,
  activeFilter: "today",
  projects: [],
  editingTaskId: null
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
    state.projects = normalizeProjects(data.projects);
    renderProjectOptions();
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
  const inProgressTasks = tasks.filter((task) => task.status === "in_progress");
  const waitingTasks = tasks.filter((task) => task.status === "waiting");
  const processingRecordings = recordings.filter((recording) => recording.status === "processing");

  setText(selectors.recordings, stats.recordings ?? recordings.length);
  setText(selectors.pending, stats.pendingTasks ?? pendingTasks.length);
  setText(selectors.processing, inProgressTasks.length + processingRecordings.length);
  setText(selectors.waiting, stats.waitingTasks ?? waitingTasks.length);

  renderBoard(data, state.activeFilter);
  renderProjects(data);

  setText(selectors.summary, latest?.summary || "暂无已处理录音。");
  renderInsights(selectors.decisions, latest?.decisions, "暂无决策。");
  renderInsights(selectors.questions, latest?.open_questions, "暂无开放问题。", "question");
  renderNotifications(notifications);

  applyFilter(state.activeFilter);
}

function renderBoard(data, filter) {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const recordings = Array.isArray(data.recordings) ? data.recordings : [];

  const pendingTasks = tasks.filter((task) => task.status === "pending_confirm");
  const inProgressTasks = tasks.filter((task) => task.status === "in_progress");
  const waitingTasks = tasks.filter((task) => task.status === "waiting");
  const processingRecordings = recordings.filter((recording) => recording.status === "processing");

  setText(selectors.pendingCount, pendingTasks.length);
  setText(selectors.processingCount, inProgressTasks.length + processingRecordings.length);
  setText(selectors.waitingCount, waitingTasks.length);

  renderCards(selectors.pendingColumn, pendingTasks.map(createTaskCard), "暂无待确认事项。");
  renderCards(
    selectors.processingColumn,
    [...inProgressTasks.map(createTaskCard), ...processingRecordings.map(createProcessingCard)],
    "暂无进行中的任务。"
  );
  renderCards(
    selectors.waitingColumn,
    waitingTasks.map(createTaskCard),
    "暂无等待他人的任务。"
  );
}

function renderProjects(data) {
  const projectBoard = document.querySelector(selectors.projectBoard);
  const groups = Array.isArray(data.projects) ? data.projects : [];

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent = "暂无项目任务。";
    projectBoard.replaceChildren(empty);
    return;
  }

  projectBoard.replaceChildren(
    ...groups.map((group) => {
      const section = document.createElement("article");
      section.className = "project-group";

      const header = document.createElement("div");
      header.className = "project-group-head";

      const title = document.createElement("h2");
      title.textContent = group.name || "未归属";

      const stats = document.createElement("span");
      stats.textContent = `${group.total ?? group.tasks?.length ?? 0} 条 · 待确认 ${group.pendingTasks ?? 0} · 进行中 ${group.inProgressTasks ?? 0} · 等待 ${group.waitingTasks ?? 0}`;

      const stack = document.createElement("div");
      stack.className = "project-task-stack";
      const cards = Array.isArray(group.tasks) && group.tasks.length
        ? group.tasks.map((task) => renderCard(createTaskCard(task)))
        : [renderEmptyCard("这个项目下暂无任务。")];

      header.append(title, stats);
      stack.replaceChildren(...cards);
      section.append(header, stack);
      return section;
    })
  );
}

function createTaskCard(task) {
  const config = taskCardConfig(task);
  const meta = taskMetaText(task);
  return {
    tag: config.tag,
    tagIcon: config.tagIcon,
    tagClass: config.tagClass,
    title: task.title || "未命名任务",
    body: task.body || "",
    meta: meta,
    avatar: config.avatar,
    points: priorityText(task.priority),
    status: "",
    isNew: task._isNew,
    onEdit: () => openModal(task),
    actions: config.actions.map((action) => ({
      ...action,
      taskId: task.id,
      onClick: () => updateTaskStatus(task.id, action.status)
    }))
  };
}

function taskCardConfig(task) {
  if (task.status === "in_progress") {
    return {
      tag: "进行中",
      tagIcon: "🔄",
      tagClass: "tag-processing",
      avatar: "进",
      actions: [
        { label: "✅ 完成", variant: "primary", status: "done" },
        { label: "↩ 退回待办", variant: "ghost", status: "pending_confirm" }
      ]
    };
  }
  if (task.status === "waiting") {
    return {
      tag: "等待他人",
      tagIcon: "🤝",
      tagClass: "tag-waiting",
      avatar: "等",
      actions: [
        { label: "↩ 收回", variant: "ghost", status: "in_progress" },
        { label: "✅ 完成", variant: "primary", status: "done" }
      ]
    };
  }
  if (task.status === "done") {
    return {
      tag: "已完成",
      tagIcon: "✅",
      tagClass: "tag-done",
      avatar: "完",
      actions: [{ label: "↩ 撤回到进行中", variant: "ghost", status: "in_progress" }]
    };
  }
  return {
    tag: "待确认",
    tagIcon: "⏳",
    tagClass: "tag-pending",
    avatar: "待",
    actions: [
      { label: "✅ 确认", variant: "primary", status: "in_progress" },
      { label: "⏭ 忽略", variant: "ghost", status: "dismissed" }
    ]
  };
}

function createProcessingCard(recording) {
  return {
    tag: "解析中",
    tagIcon: "🔄",
    tagClass: "tag-processing",
    title: recordingTitle(recording, "录音正在转写或解析"),
    meta: `录音 #${recording.id}`,
    avatar: "进",
    points: formatDuration(recording.duration_seconds),
    status: "解析中，请稍候..."
  };
}

function renderCards(selector, cards, emptyText) {
  const container = document.querySelector(selector);
  container.replaceChildren(...(cards.length ? cards.map(renderCard) : [renderEmptyCard(emptyText)]));
}

function renderCard(card) {
  const article = document.createElement("article");
  article.className = "kanban-card";
  if (card.isNew) article.classList.add("pulse-new");

  const tag = document.createElement("span");
  tag.className = `card-tag ${card.tagClass}`;
  tag.textContent = card.tagIcon ? `${card.tagIcon} ${card.tag}` : card.tag;

  if (card.onEdit) {
    const editBtn = document.createElement("button");
    editBtn.className = "card-edit mini-btn";
    editBtn.textContent = "✎";
    editBtn.type = "button";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      card.onEdit();
    });
    article.append(editBtn);
  }

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = card.title;

  const body = document.createElement("p");
  body.className = "card-body";
  body.textContent = card.body;

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

  if (card.body) {
    article.append(body);
  }

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
  setText(selectors.waiting, 0);
  setText(selectors.pendingCount, 0);
  setText(selectors.processingCount, 0);
  setText(selectors.waitingCount, 0);
  setText(selectors.summary, message);
  renderCards(selectors.pendingColumn, [], "暂无待确认事项。");
  renderCards(selectors.processingColumn, [], "暂无进行中的任务。");
  renderCards(selectors.waitingColumn, [], "暂无等待他人的任务。");
  renderInsights(selectors.decisions, [], "暂无决策。");
  renderInsights(selectors.questions, [], "暂无开放问题。", "question");
  renderNotifications([]);
  document.querySelector(selectors.projectBoard).replaceChildren(renderEmptyCard("暂无项目任务。"));
  document.querySelector(selectors.completionBar).style.width = "0%";
}

async function uploadRecording(file, name = "browser-recording.webm") {
  const formData = new FormData();
  formData.append("recording", file, name);
  state.isUploading = true;
  setUploadState(true, `正在上传并解析：${name}`);
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
    const taskCount = payload.taskCount ?? 0;
    sendTauriNotification("解析完成", `识别出 ${taskCount} 条待确认事项`);
    setUploadStatus(`处理完成：录音 #${payload.recordingId}`);
    await refresh();
  } catch (error) {
    setUploadStatus(error.message || "上传失败，请重试。", true);
    console.error(error);
  } finally {
    state.isUploading = false;
    setUploadState(false);
    scheduleAutoRefresh();
  }
}

async function updateTaskStatus(taskId, status) {
  setTaskButtonsDisabled(taskId, true);
  document.querySelector(selectors.boardStatus).textContent = taskStatusMessage(status);

  try {
    const response = await fetch(`/api/tasks/${taskId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
    });
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

async function toggleRecording() {
  if (state.isRecording) {
    stopRecording();
    return;
  }
  await startRecording();
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setUploadStatus("当前浏览器不支持网页录音，请使用新版 Chrome 或 Safari。", true);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = preferredRecordingMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.recordingChunks = [];
    state.recordingStream = stream;
    state.recorder = recorder;
    state.recordingStartedAt = Date.now();

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) state.recordingChunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      uploadRecordedAudio(recorder.mimeType || mimeType || "audio/webm");
    });
    recorder.start();
    state.isRecording = true;
    sendTauriNotification("录音已开始", "正在录音中...");
    setUploadState(false);
    updateRecordingTimer();
    state.recordingTimer = window.setInterval(updateRecordingTimer, 1000);
  } catch (error) {
    setUploadStatus(error.message || "无法访问麦克风。", true);
    cleanupRecording();
    console.error(error);
  }
}

function stopRecording() {
  if (state.recorder && state.recorder.state !== "inactive") {
    setUploadStatus("录音已停止，正在准备上传。");
    sendTauriNotification("录音已结束", "正在解析中...");
    state.recorder.stop();
  }
  cleanupRecording();
}

async function uploadRecordedAudio(mimeType) {
  const blob = new Blob(state.recordingChunks, { type: mimeType });
  if (!blob.size) {
    setUploadStatus("没有录到有效音频。", true);
    return;
  }
  const extension = recordingExtension(mimeType);
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const filename = `recording_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.${extension}`;
  await uploadRecording(blob, filename);
}

function cleanupRecording() {
  window.clearInterval(state.recordingTimer);
  state.recordingTimer = null;
  state.isRecording = false;
  if (state.recordingStream) {
    state.recordingStream.getTracks().forEach((track) => track.stop());
  }
  state.recordingStream = null;
  state.recorder = null;
  setUploadState(state.isUploading);
}

function preferredRecordingMimeType() {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"].find((type) =>
    MediaRecorder.isTypeSupported(type)
  );
}

function recordingExtension(mimeType) {
  return mimeType.includes("ogg") ? "ogg" : "webm";
}

function updateRecordingTimer() {
  const seconds = Math.max(0, Math.floor((Date.now() - state.recordingStartedAt) / 1000));
  setUploadStatus(`录制中 ${formatDuration(seconds)}，点击停止后自动上传解析。`);
}

function setUploadState(isUploading, message = "点击开始录音，停止后自动上传并解析。") {
  const uploadButton = document.querySelector(selectors.uploadButton);
  uploadButton.disabled = isUploading && !state.isRecording;
  uploadButton.textContent = state.isRecording ? "停止录音" : isUploading ? "解析中" : "开始录音";
  uploadButton.classList.toggle("recording", state.isRecording);
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

function normalizeProjects(projectGroups = []) {
  const names = new Set();
  for (const project of projectGroups) {
    const name = typeof project === "string" ? project : project?.name;
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function renderProjectOptions(selected = document.querySelector(selectors.taskProject)?.value ?? "") {
  const select = document.querySelector(selectors.taskProject);
  if (!select) return;

  const options = [
    optionElement("", "未归属"),
    ...state.projects.map((name) => optionElement(name, name))
  ];
  select.replaceChildren(...options);
  select.value = state.projects.includes(selected) ? selected : "";
}

function optionElement(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

async function loadProjects(selected = "") {
  try {
    const response = await fetch("/api/projects");
    if (!response.ok) throw new Error(`项目列表请求失败：${response.status}`);
    const projects = await response.json();
    state.projects = normalizeProjects(projects);
    renderProjectOptions(selected);
  } catch (error) {
    renderProjectOptions(selected);
    console.error(error);
  }
}

function showNewProjectForm() {
  document.querySelector(selectors.projectSelectContainer).hidden = true;
  document.querySelector(selectors.newProjectForm).hidden = false;
  document.querySelector(selectors.newProjectInput).focus();
}

function hideNewProjectForm() {
  document.querySelector(selectors.newProjectForm).hidden = true;
  document.querySelector(selectors.projectSelectContainer).hidden = false;
  document.querySelector(selectors.newProjectInput).value = "";
}

async function submitNewProject() {
  const input = document.querySelector(selectors.newProjectInput);
  const name = input.value.trim();
  if (!name) return;

  const btn = document.querySelector(selectors.newProjectSubmit);
  btn.disabled = true;

  try {
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw new Error(payload.error || "新建项目失败");
    if (!state.projects.includes(payload.name)) state.projects.push(payload.name);
    state.projects.sort((a, b) => a.localeCompare(b, "zh-CN"));
    renderProjectOptions(payload.name);
    hideNewProjectForm();
  } catch (error) {
    document.querySelector(selectors.boardStatus).textContent = error.message || "新建项目失败";
    console.error(error);
  } finally {
    btn.disabled = false;
  }
}

function recordingTitle(recording, fallback) {
  return recording?.id ? `第 ${recording.id} 条录音 · ${fallback}` : fallback;
}

function priorityText(priority) {
  const labels = { high: "🔴 高优先级", medium: "🟡 中优先级", low: "🟢 低优先级" };
  return labels[priority] ?? labels.medium;
}

function taskMetaText(task) {
  const parts = [];
  if (task.project) parts.push(task.project);
  if (task.recording_id && task.recording_id !== "manual") {
    // Note: in practice recording_id might be an integer, 
    // so we check if it's not a manual flag if the API returns one, 
    // but getTodayDashboard returns the raw recording_id from DB.
    // For manual tasks, recording_id points to a recording with source_type='manual'.
    // Here we just check if it's a number and not null.
    parts.push(`录音 #${task.recording_id}`);
  }
  if (task.due_date) parts.push(`截止 ${task.due_date}`);
  parts.push(`任务 #${task.id}`);
  return parts.join(" · ");
}

function taskStatusMessage(status) {
  const messages = {
    pending_confirm: "正在撤回到待确认...",
    in_progress: "正在确认任务...",
    waiting: "正在标记为等待他人...",
    done: "正在标记为已完成...",
    dismissed: "正在忽略任务..."
  };
  return messages[status] ?? "正在更新任务...";
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

function applyFilter(filter) {
  state.activeFilter = filter;
  if (state.data) renderBoard(state.data, filter);
  document.querySelectorAll(`${selectors.chipRow} .chip`).forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.filter === filter);
  });

  const kpiGrid = document.querySelector(".kpi-grid");
  const board = document.querySelector(".board");
  const projectBoard = document.querySelector(selectors.projectBoard);
  const sidebar = document.querySelector(".sidebar");

  // Reset all
  kpiGrid.style.display = "";
  board.style.display = "";
  projectBoard.hidden = true;
  sidebar.style.display = "";

  if (filter === "projects") {
    board.style.display = "none";
    projectBoard.hidden = false;
    sidebar.style.display = "none";
  }
}

async function submitManualTask() {
  const titleInput = document.querySelector(selectors.taskTitle);
  const title = titleInput.value.trim();
  if (!title) return;

  const submitBtn = document.querySelector(selectors.modalSubmit);
  submitBtn.disabled = true;
  submitBtn.textContent = state.editingTaskId ? "保存中" : "添加中";
  const payload = {
    title,
    body: document.querySelector(selectors.taskBody).value,
    priority: document.querySelector(selectors.taskPriority).value,
    due_date: document.querySelector(selectors.taskDueDate).value,
    project: document.querySelector(selectors.taskProject).value
  };
  const url = state.editingTaskId ? `/api/tasks/${state.editingTaskId}` : "/api/tasks";

  try {
    const response = await fetch(url, {
      method: state.editingTaskId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const payload = await readJsonResponse(response);
      throw new Error(payload.error || (state.editingTaskId ? "保存失败" : "添加失败"));
    }
    closeModal();
    await refresh();
  } catch (error) {
    document.querySelector(selectors.boardStatus).textContent = error.message || "添加待办失败";
    console.error(error);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = state.editingTaskId ? "保存" : "添加";
  }
}

async function openModal(task = null) {
  const modal = document.querySelector(selectors.taskModal);
  const isEditing = Boolean(task?.id);
  state.editingTaskId = isEditing ? task.id : null;
  modal.hidden = false;
  document.querySelector(selectors.taskModalTitle).textContent = isEditing ? "编辑待办" : "手动记录待办";
  document.querySelector(selectors.taskTitle).value = task?.title || "";
  document.querySelector(selectors.taskBody).value = task?.body || "";
  document.querySelector(selectors.taskPriority).value = task?.priority || "medium";
  document.querySelector(selectors.taskDueDate).value = task?.due_date || "";
  renderProjectOptions(task?.project || "");
  document.querySelector(selectors.modalSubmit).textContent = isEditing ? "保存" : "添加";
  document.querySelector(selectors.taskTitle).focus();
  if (!state.projects.length) {
    await loadProjects(task?.project || "");
  } else {
    loadProjects(task?.project || ""); // fetch in background
  }
}

function closeModal() {
  document.querySelector(selectors.taskModal).hidden = true;
  state.editingTaskId = null;
  hideNewProjectForm();
}

document.querySelector(selectors.refresh).addEventListener("click", () => {
  window.clearTimeout(state.pollTimer);
  refresh();
});
document.querySelector(selectors.uploadButton).addEventListener("click", () => {
  toggleRecording();
});
document.querySelector(selectors.autoRefresh).addEventListener("change", () => {
  scheduleAutoRefresh();
  document.querySelector(selectors.boardStatus).textContent = document.querySelector(selectors.autoRefresh).checked
    ? statusTextForPolling(state.data)
    : "自动刷新已关闭";
});
document.querySelector(selectors.addTaskButton).addEventListener("click", () => openModal());
document.querySelector(selectors.newProject).addEventListener("click", showNewProjectForm);
document.querySelector(selectors.newProjectCancel).addEventListener("click", hideNewProjectForm);
document.querySelector(selectors.newProjectSubmit).addEventListener("click", submitNewProject);
document.querySelector(selectors.newProjectInput).addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitNewProject();
  if (e.key === "Escape") hideNewProjectForm();
});
document.querySelector(selectors.modalClose).addEventListener("click", closeModal);
document.querySelector(selectors.modalCancel).addEventListener("click", closeModal);
document.querySelector(selectors.modalSubmit).addEventListener("click", submitManualTask);
document.querySelector(selectors.taskModal).addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeModal();
});
document.querySelector(selectors.taskTitle).addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitManualTask();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

document.querySelector(selectors.chipRow).addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip?.dataset.filter) applyFilter(chip.dataset.filter);
});

function setupTauriListeners() {
  if (!window.__TAURI__) return;
  window.__TAURI__.event.listen("toggle-recording", () => {
    toggleRecording();
  });
  window.__TAURI__.event.listen("open-dashboard", () => {
    window.focus();
  });
}

async function sendTauriNotification(title, body) {
  if (!window.__TAURI__) return;
  try {
    await window.__TAURI__.core.invoke("send_notification", { title, body });
  } catch {
    // notifications are best-effort
  }
}

refresh();
setupTauriListeners();
