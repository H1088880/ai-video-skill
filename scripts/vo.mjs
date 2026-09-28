// scripts/vo.mjs —— 火山引擎(豆包) TTS 逐镜旁白 + 字幕 ASS
// 自带实现，不依赖任何外部 skill；凭证走环境变量：
//   VOLC_TTS_API_KEY（新版控制台）或 VOLC_TTS_APP_ID + VOLC_TTS_ACCESS_TOKEN（旧版）
//   VOLC_TTS_VOICE（音色，含下划线）、VOLC_TTS_RESOURCE_ID（默认 seed-tts-1.0）
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG, assertFfmpeg, probeDuration, resolutionOf } from "./paths.mjs";

const execFileP = promisify(execFile);
const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOLC_HTTP_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";

// 尽量加载 .env（项目目录优先，其次 skill 根目录），都已存在则跳过
export function loadEnv(projectDir) {
  const cands = [projectDir && path.join(projectDir, ".env"), path.join(SKILL_ROOT, ".env"), path.join(process.cwd(), ".env")];
  for (const f of cands) {
    if (f && fs.existsSync(f)) { try { process.loadEnvFile(f); } catch {} }
  }
}

function volcConfig(voice) {
  const headers = {
    "Content-Type": "application/json",
    "X-Api-Resource-Id": process.env.VOLC_TTS_RESOURCE_ID || "seed-tts-1.0",
    "X-Api-Connect-Id": randomUUID(),
  };
  if (process.env.VOLC_TTS_API_KEY) headers["X-Api-Key"] = process.env.VOLC_TTS_API_KEY;
  else if (process.env.VOLC_TTS_APP_ID && process.env.VOLC_TTS_ACCESS_TOKEN) {
    headers["X-Api-App-Id"] = process.env.VOLC_TTS_APP_ID;
    headers["X-Api-Access-Key"] = process.env.VOLC_TTS_ACCESS_TOKEN;
  } else {
    throw new Error("缺少火山凭证：设置 VOLC_TTS_API_KEY（新版）或 VOLC_TTS_APP_ID + VOLC_TTS_ACCESS_TOKEN（旧版）");
  }
  const speaker = voice && voice.includes("_") ? voice : process.env.VOLC_TTS_VOICE || "zh_female_shuangkuaisisi_moon_bigtts";
  return { headers, speaker };
}

// 火山响应是一串 JSON（NDJSON 或 SSE），用花括号配平扫出顶层对象，不依赖具体分隔格式
function extractJsonObjects(text) {
  const objs = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") { if (depth++ === 0) start = i; }
    else if (c === "}") { if (--depth === 0 && start >= 0) { objs.push(text.slice(start, i + 1)); start = -1; } }
  }
  return objs;
}

function collectAudio(node, out) {
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if ((k === "data" || k === "audio") && typeof v === "string" && v) out.push(Buffer.from(v, "base64"));
    else if (v && typeof v === "object") collectAudio(v, out);
  }
}

export async function synthesize(text, outWav, { voice } = {}) {
  assertFfmpeg();
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  // 已存在则复用（FORCE_TTS=1 强制重配）
  if (fs.existsSync(outWav) && process.env.FORCE_TTS !== "1") {
    return { path: outWav, duration: await probeDuration(outWav) };
  }
  const { headers, speaker } = volcConfig(voice);
  const audioParams = { format: "mp3", sample_rate: 24000, bit_rate: 128000, enable_timestamp: true, enable_subtitle: true };
  const speed = Number(process.env.VOLC_TTS_SPEED || 0);
  if (speed) audioParams.speech_rate = speed;
  const reqParams = { text, speaker, audio_params: audioParams };
  const style = process.env.VOLC_TTS_STYLE || "";
  if (style) reqParams.additions = JSON.stringify({ context_texts: [style] });

  const resp = await fetch(VOLC_HTTP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ user: { uid: "ai-video-skill" }, req_params: reqParams }),
  });
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`火山 TTS HTTP ${resp.status}: ${raw.slice(0, 300)}`);

  const chunks = [];
  for (const objStr of extractJsonObjects(raw)) {
    let o; try { o = JSON.parse(objStr); } catch { continue; }
    collectAudio(o, chunks);
  }
  if (!chunks.length) throw new Error("火山 TTS 未返回音频: " + raw.slice(0, 300));

  const mp3 = outWav.replace(/\.wav$/, ".mp3");
  fs.writeFileSync(mp3, Buffer.concat(chunks));
  await execFileP(FFMPEG, ["-y", "-i", mp3, "-ar", "44100", "-ac", "2", outWav], { stdio: "ignore", timeout: 120000 });
  fs.rmSync(mp3, { force: true });
  return { path: outWav, duration: await probeDuration(outWav) };
}

function assTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// 按标点断句，按字符数比例分配时长
function splitCaptions(text, dur) {
  const segs = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if ("，。！？；、：".includes(ch)) { segs.push(buf); buf = ""; }
  }
  if (buf) segs.push(buf);
  const total = segs.reduce((n, s) => n + s.length, 0) || 1;
  let t = 0;
  return segs.map((s) => {
    const dt = (s.length / total) * dur;
    const line = { text: s, start: t, end: t + dt };
    t += dt;
    return line;
  });
}

const escapeAss = (t) => t.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");

function buildAss(text, dur, h) {
  const events = splitCaptions(text, dur)
    .map((l) => `Dialogue: 0,${assTime(l.start)},${assTime(l.end)},Sub,,0,0,0,,${escapeAss(l.text)}`)
    .join("\n");
  return `[Script Info]
ScriptType: v4.00
PlayResX: 1080
PlayResY: ${h}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV, BorderStyle, Outline
Style: Sub,Noto Sans SC,52,&H00FFFFFF,&H00000000,0,0,2,60,60,90,1,4

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

// 对 project 里带 vo 的镜头生成 wav + ass；就地给 shot 注入 _wav/_dur/_ass
export async function genVo(project, dir) {
  loadEnv(dir);
  const audioDir = path.join(dir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const { h } = resolutionOf(project.aspect || "9:16");
  let n = 0;
  for (const shot of project.shots) {
    n++;
    if (!shot.vo || !shot.vo.trim()) { shot._dur = shot.cardDur || project.cardDur || 3; continue; }
    const wav = path.join(audioDir, `shot${n}.wav`);
    const ass = path.join(audioDir, `shot${n}.ass`);
    const r = await synthesize(shot.vo, wav, { voice: project.voice });
    shot._wav = wav;
    shot._dur = r.duration;
    fs.writeFileSync(ass, buildAss(shot.vo, r.duration, h));
    shot._ass = ass;
    console.log(`  [vo] shot${n} ${r.duration.toFixed(2)}s  ${shot.vo.slice(0, 18)}…`);
  }
}
