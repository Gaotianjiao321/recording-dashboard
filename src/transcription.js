import { createHmac, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const TENCENT_API_VERSION = "2019-06-14";
const LOCAL_FILE_LIMIT_BYTES = 5 * 1024 * 1024;

function hasTencentConfig() {
  return Boolean(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY);
}

function sha256(value, secret = "", encoding) {
  return createHmac("sha256", secret).update(value).digest(encoding);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function utcDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function tencentAuthorization({ action, payload, timestamp }) {
  const endpoint = process.env.TENCENT_ASR_ENDPOINT ?? "asr.tencentcloudapi.com";
  const service = "asr";
  const algorithm = "TC3-HMAC-SHA256";
  const signedHeaders = "content-type;host";
  const date = utcDate(timestamp);
  const credentialScope = `${date}/${service}/tc3_request`;
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${endpoint}\n`;
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hash(payload)
  ].join("\n");
  const stringToSign = [algorithm, timestamp, credentialScope, hash(canonicalRequest)].join("\n");
  const secretDate = sha256(date, `TC3${process.env.TENCENT_SECRET_KEY}`);
  const secretService = sha256(service, secretDate);
  const secretSigning = sha256("tc3_request", secretService);
  const signature = sha256(stringToSign, secretSigning, "hex");

  return {
    endpoint,
    headers: {
      authorization: `${algorithm} Credential=${process.env.TENCENT_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "content-type": "application/json; charset=utf-8",
      host: endpoint,
      "x-tc-action": action,
      "x-tc-version": TENCENT_API_VERSION,
      "x-tc-region": process.env.TENCENT_REGION ?? "ap-guangzhou",
      "x-tc-timestamp": String(timestamp)
    }
  };
}

async function tencentRequest(action, body) {
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const { endpoint, headers } = tencentAuthorization({ action, payload, timestamp });
  const response = await fetch(`https://${endpoint}/`, {
    method: "POST",
    headers,
    body: payload
  });
  const raw = await response.text();
  const json = raw ? JSON.parse(raw) : {};
  const error = json.Response?.Error;
  if (!response.ok || error) {
    throw new Error(`Tencent ASR ${action} failed: ${error?.Code ?? response.status} ${error?.Message ?? raw}`);
  }
  return json.Response;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function transcribeWithTencent(chunk) {
  const audio = await readFile(chunk.filePath);
  if (audio.byteLength > LOCAL_FILE_LIMIT_BYTES) {
    throw new Error(
      `Tencent ASR local upload limit is 5 MB; ${chunk.filePath} is ${audio.byteLength} bytes. Reduce AUDIO_CHUNK_SECONDS or upload via COS URL.`
    );
  }

  const created = await tencentRequest("CreateRecTask", {
    ChannelNum: Number(process.env.TENCENT_ASR_CHANNEL_NUM ?? 1),
    EngineModelType: process.env.TENCENT_ASR_ENGINE ?? "16k_zh",
    ResTextFormat: Number(process.env.TENCENT_ASR_RES_TEXT_FORMAT ?? 0),
    SourceType: 1,
    Data: audio.toString("base64"),
    DataLen: audio.byteLength
  });
  const taskId = created.Data?.TaskId;
  if (!taskId) throw new Error("Tencent ASR did not return a task id");

  const started = Date.now();
  const timeoutMs = Number(process.env.TENCENT_ASR_TIMEOUT_MS ?? 180000);
  const pollMs = Number(process.env.TENCENT_ASR_POLL_INTERVAL_MS ?? 3000);
  while (Date.now() - started < timeoutMs) {
    const status = await tencentRequest("DescribeTaskStatus", { TaskId: taskId });
    const data = status.Data;
    if (data?.Status === 2 || data?.StatusStr === "success") return data.Result ?? "";
    if (data?.Status === 3 || data?.StatusStr === "failed") {
      throw new Error(`Tencent ASR task failed: ${data.ErrorMsg ?? "unknown error"}`);
    }
    await delay(pollMs);
  }
  throw new Error(`Tencent ASR task ${taskId} timed out after ${timeoutMs}ms`);
}

async function transcribeFromSidecar(chunk) {
  const sidecarPath = `${chunk.filePath}.txt`;
  try {
    const text = await readFile(sidecarPath, "utf8");
    return text.trim();
  } catch {
    return `Transcript chunk ${chunk.position + 1}: TODO: review ${chunk.filePath}. Decision: keep local-first MVP.`;
  }
}

export function createTranscriber() {
  return async function transcribeChunk(chunk) {
    if (hasTencentConfig()) return transcribeWithTencent(chunk);
    return transcribeFromSidecar(chunk);
  };
}
