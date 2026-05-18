import { readFile } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";

export function createTranscriber(env = process.env, fetchImpl = fetch) {
  if (env.TENCENT_SECRET_ID && env.TENCENT_SECRET_KEY) {
    return createTencentTranscriber(env, fetchImpl);
  }

  return async function transcribeChunk(chunk) {
    const sidecarPath = `${chunk.filePath}.txt`;
    try {
      const text = await readFile(sidecarPath, "utf8");
      return text.trim();
    } catch {
      return `Transcript chunk ${chunk.position + 1}: TODO: review ${chunk.filePath}. Decision: keep local-first MVP.`;
    }
  };
}

export async function transcribeChunks(chunks, transcriber, options = {}) {
  const concurrency = options.concurrency ?? 3;
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  return runLimited(chunks, concurrency, (chunk) =>
    withRetry(() => transcriber(chunk), { attempts, timeoutMs, baseDelayMs: 500 })
  );
}

function createTencentTranscriber(env, fetchImpl) {
  const client = new TencentAsrClient(
    {
      secretId: env.TENCENT_SECRET_ID,
      secretKey: env.TENCENT_SECRET_KEY,
      region: env.TENCENT_REGION ?? "ap-guangzhou",
      engineModelType: env.TENCENT_ASR_ENGINE ?? "16k_zh",
      pollIntervalMs: Number(env.TENCENT_ASR_POLL_INTERVAL_MS ?? 3000),
      timeoutMs: Number(env.TENCENT_ASR_TIMEOUT_MS ?? 15 * 60 * 1000)
    },
    fetchImpl
  );

  return async function transcribeTencentChunk(chunk) {
    return client.transcribeChunk(chunk);
  };
}

export class TencentAsrClient {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.endpoint = "https://asr.tencentcloudapi.com";
    this.host = "asr.tencentcloudapi.com";
    this.service = "asr";
  }

  async transcribeChunk(chunk) {
    const audio = await readFile(chunk.filePath);
    const taskId = await this.createTask(audio);
    return this.waitForTask(taskId);
  }

  async createTask(audio) {
    const response = await this.request("CreateRecTask", {
      EngineModelType: this.config.engineModelType,
      ChannelNum: 1,
      ResTextFormat: 0,
      SourceType: 1,
      Data: audio.toString("base64"),
      DataLen: audio.byteLength
    });
    const taskId = response.Data?.TaskId;
    if (!taskId) throw new Error("Tencent ASR did not return TaskId");
    return taskId;
  }

  async waitForTask(taskId) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.config.timeoutMs) {
      const response = await this.request("DescribeTaskStatus", { TaskId: taskId });
      const data = response.Data;
      if (!data) throw new Error(`Tencent ASR task ${taskId} returned no data`);
      if (data.StatusStr === "success" || data.Status === 2) return data.Result ?? "";
      if (data.StatusStr === "failed" || data.Status === 3) {
        throw new Error(data.ErrorMsg || `Tencent ASR task ${taskId} failed`);
      }
      await sleep(this.config.pollIntervalMs);
    }
    throw new Error(`Tencent ASR task ${taskId} timed out`);
  }

  async request(action, payload) {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: this.sign(action, body, timestamp),
        "Content-Type": "application/json; charset=utf-8",
        Host: this.host,
        "X-TC-Action": action,
        "X-TC-Region": this.config.region,
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Version": "2019-06-14"
      },
      body
    });

    if (!response.ok) throw new Error(`Tencent ASR HTTP ${response.status}: ${await response.text()}`);
    const json = await response.json();
    if (json.Response?.Error) {
      throw new Error(`${json.Response.Error.Code}: ${json.Response.Error.Message}`);
    }
    return json.Response;
  }

  sign(action, payload, timestamp) {
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${this.host}\nx-tc-action:${action.toLowerCase()}\n`;
    const signedHeaders = "content-type;host;x-tc-action";
    const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(payload)].join("\n");
    const credentialScope = `${date}/${this.service}/tc3_request`;
    const stringToSign = ["TC3-HMAC-SHA256", timestamp, credentialScope, sha256(canonicalRequest)].join("\n");
    const secretDate = hmac(`TC3${this.config.secretKey}`, date);
    const secretService = hmac(secretDate, this.service);
    const secretSigning = hmac(secretService, "tc3_request");
    const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
    return `TC3-HMAC-SHA256 Credential=${this.config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }
}

export async function withRetry(operation, options) {
  let lastError;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await withTimeout(operation(), options.timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts) break;
      await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function runLimited(items, limit, worker) {
  const results = [];
  let cursor = 0;
  async function next() {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index], index);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`operation timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}
