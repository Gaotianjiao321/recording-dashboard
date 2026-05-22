import { createHmac, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function getVoiceFormat(filePath) {
  const ext = extname(filePath).replace(".", "").toLowerCase();
  if (["wav", "mp3", "m4a", "aac", "ogg", "flac"].includes(ext)) return ext;
  return "mp3";
}

function getTencentConfig(options = {}) {
  return {
    endpoint: options.endpoint ?? process.env.TENCENT_ASR_ENDPOINT ?? "asr.ap-guangzhou.tencentcloudapi.com",
    region: options.region ?? process.env.TENCENT_REGION ?? "ap-guangzhou",
    secretId: options.secretId ?? process.env.TENCENT_SECRET_ID,
    secretKey: options.secretKey ?? process.env.TENCENT_SECRET_KEY,
    engine: options.engine ?? process.env.TENCENT_ASR_ENGINE ?? "16k_zh",
    mode: options.mode ?? process.env.TENCENT_ASR_MODE ?? "auto"
  };
}

function assertTencentConfig(config) {
  const missing = [];
  if (!config.secretId) missing.push("TENCENT_SECRET_ID");
  if (!config.secretKey) missing.push("TENCENT_SECRET_KEY");
  if (!config.endpoint) missing.push("TENCENT_ASR_ENDPOINT");
  if (missing.length) throw new Error(`Tencent ASR is missing ${missing.join(", ")}`);
}

export function buildTencentAsrRequest(chunk, audio, config, now = new Date()) {
  const service = "asr";
  const action = "SentenceRecognition";
  const version = "2019-06-14";
  const algorithm = "TC3-HMAC-SHA256";
  const timestamp = Math.floor(now.getTime() / 1000);
  const date = now.toISOString().slice(0, 10);
  const payload = JSON.stringify({
    EngSerViceType: config.engine,
    SourceType: 1,
    VoiceFormat: getVoiceFormat(chunk.filePath),
    Data: audio.toString("base64"),
    DataLen: audio.length
  });

  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${config.endpoint}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256(payload)
  ].join("\n");
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    algorithm,
    String(timestamp),
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const secretDate = hmac(`TC3${config.secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  const authorization = `${algorithm} Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${config.endpoint}`,
    payload,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: config.endpoint,
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": version,
      "X-TC-Region": config.region
    }
  };
}

async function transcribeWithTencent(chunk, config, fetchImpl = fetch) {
  assertTencentConfig(config);

  const audio = await readFile(chunk.filePath);
  const request = buildTencentAsrRequest(chunk, audio, config);
  const response = await fetchImpl(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.payload
  });

  const body = await response.json();
  if (!response.ok || body.Response?.Error) {
    const message = body.Response?.Error?.Message ?? `Tencent ASR request failed with ${response.status}`;
    throw new Error(message);
  }

  return String(body.Response?.Result ?? "").trim();
}

async function transcribeFromSidecar(chunk) {
  const sidecarPath = `${chunk.filePath}.txt`;
  const text = await readFile(sidecarPath, "utf8");
  return text.trim();
}

function fallbackTranscript(_chunk) {
  return "";
}

export function createTranscriber(options = {}) {
  const config = getTencentConfig(options);
  const fetchImpl = options.fetchImpl ?? fetch;

  return async function transcribeChunk(chunk) {
    if (config.mode === "tencent" || (config.mode === "auto" && config.secretId && config.secretKey)) {
      return transcribeWithTencent(chunk, config, fetchImpl);
    }

    try {
      return await transcribeFromSidecar(chunk);
    } catch {
      return fallbackTranscript(chunk);
    }
  };
}
