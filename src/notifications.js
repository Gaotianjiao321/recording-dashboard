import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sqlValue } from "./db.js";
import { findBinary } from "./audio.js";

const execFileAsync = promisify(execFile);
const OSASCRIPT_BIN = findBinary("osascript");

function osascriptEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export async function sendMacNotification({ title, body }) {
  if (process.platform !== "darwin") return { delivered: false, reason: "not-macos" };
  await execFileAsync(OSASCRIPT_BIN, [
    "-e",
    `display notification "${osascriptEscape(body)}" with title "${osascriptEscape(title)}"`
  ]);
  return { delivered: true };
}

export async function notifyAndRecord(db, recordingId, notification, sender = sendMacNotification) {
  await sender(notification);
  await db.run(`
    INSERT INTO notifications (recording_id, title, body)
    VALUES (${sqlValue(recordingId)}, ${sqlValue(notification.title)}, ${sqlValue(notification.body)})
  `);
}
