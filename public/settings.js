const DEFAULT_SHORTCUT = "CmdOrCtrl+Shift+R";

const shortcutDisplay = document.getElementById("shortcut-display");
const shortcutRecord = document.getElementById("shortcut-record");
const shortcutReset = document.getElementById("shortcut-reset");
const shortcutWarning = document.getElementById("shortcut-warning");

let isRecording = false;
let currentShortcut = DEFAULT_SHORTCUT;

const modifierKeys = new Set(["Meta", "Control", "Shift", "Alt"]);
const keyMap = {
  Meta: "CmdOrCtrl",
  Control: "CmdOrCtrl",
  Shift: "Shift",
  Alt: "Alt",
  " ": "Space",
};

function formatShortcut(shortcut) {
  return shortcut
    .replace(/CmdOrCtrl/g, "⌘")
    .replace(/Shift/g, "⇧")
    .replace(/Alt/g, "⌥")
    .replace(/\+/g, "");
}

function normalizeKey(event) {
  if (modifierKeys.has(event.key)) return keyMap[event.key] || null;
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}

function startRecording() {
  isRecording = true;
  shortcutRecord.textContent = "按下快捷键...";
  shortcutRecord.classList.add("recording");
  shortcutDisplay.value = "";
  shortcutWarning.hidden = true;
}

function stopRecording() {
  isRecording = false;
  shortcutRecord.textContent = "录制";
  shortcutRecord.classList.remove("recording");
}

async function saveShortcut(shortcut) {
  try {
    if (window.__TAURI__) {
      await window.__TAURI__.core.invoke("set_shortcut", { shortcut });
    }
    currentShortcut = shortcut;
    shortcutDisplay.value = formatShortcut(shortcut);
    localStorage.setItem("recording-shortcut", shortcut);
  } catch (error) {
    showWarning(`快捷键设置失败：${error}`);
  }
}

function showWarning(message) {
  shortcutWarning.textContent = message;
  shortcutWarning.hidden = false;
}

function checkConflict(shortcut) {
  const conflicts = {
    "CmdOrCtrl+C": "复制",
    "CmdOrCtrl+V": "粘贴",
    "CmdOrCtrl+X": "剪切",
    "CmdOrCtrl+Z": "撤销",
    "CmdOrCtrl+A": "全选",
    "CmdOrCtrl+S": "保存",
    "CmdOrCtrl+W": "关闭窗口",
    "CmdOrCtrl+Q": "退出应用",
  };
  if (conflicts[shortcut]) {
    showWarning(`⌘⇧${shortcut.split("+").pop()} 可能与系统快捷键「${conflicts[shortcut]}」冲突`);
    return true;
  }
  return false;
}

shortcutRecord.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

document.addEventListener("keydown", (event) => {
  if (!isRecording) return;
  event.preventDefault();

  const parts = [];
  if (event.metaKey || event.ctrlKey) parts.push("CmdOrCtrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");

  const key = normalizeKey(event);
  if (key && !modifierKeys.has(event.key)) {
    parts.push(key);
    const shortcut = parts.join("+");
    stopRecording();
    checkConflict(shortcut);
    saveShortcut(shortcut);
  }
});

shortcutReset.addEventListener("click", () => {
  shortcutWarning.hidden = true;
  saveShortcut(DEFAULT_SHORTCUT);
});

document.querySelectorAll("[data-shortcut]").forEach((chip) => {
  chip.addEventListener("click", () => {
    const shortcut = chip.dataset.shortcut;
    shortcutWarning.hidden = true;
    checkConflict(shortcut);
    saveShortcut(shortcut);
  });
});

const saved = localStorage.getItem("recording-shortcut") || DEFAULT_SHORTCUT;
currentShortcut = saved;
shortcutDisplay.value = formatShortcut(saved);
