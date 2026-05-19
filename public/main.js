const selectors = {
  refresh: "#refresh",
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
  completionBar: "#completion-bar"
};

async function refresh() {
  const refreshButton = document.querySelector(selectors.refresh);
  setLoading(true);

  try {
    const response = await fetch("/api/dashboard/today");
    if (!response.ok) {
      throw new Error(`看板数据请求失败：${response.status}`);
    }

    const data = await response.json();
    renderDashboard(data);
    document.querySelector(selectors.boardStatus).textContent = "看板数据已同步";
    document.querySelector(selectors.lastUpdated).textContent = `最近刷新 ${formatTime(new Date())}`;
  } catch (error) {
    document.querySelector(selectors.boardStatus).textContent = "看板数据加载失败";
    renderEmptyState("加载失败，请稍后重试。");
    console.error(error);
  } finally {
    setLoading(false);
    refreshButton.blur();
  }
}

function renderDashboard(data) {
  const stats = data.stats ?? {};
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const recordings = Array.isArray(data.recordings) ? data.recordings : [];
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
    points: "待确认",
    progress: null
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
    progress: 58
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

  if (typeof card.progress === "number") {
    const progress = document.createElement("div");
    progress.className = "progress";
    const bar = document.createElement("span");
    bar.style.width = `${card.progress}%`;
    progress.append(bar);
    article.append(progress);
  }

  article.append(meta);
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
  document.querySelector(selectors.completionBar).style.width = "0%";
}

function setLoading(isLoading) {
  const refreshButton = document.querySelector(selectors.refresh);
  refreshButton.disabled = isLoading;
  refreshButton.textContent = isLoading ? "刷新中" : "刷新";
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

document.querySelector(selectors.refresh).addEventListener("click", refresh);
refresh();
