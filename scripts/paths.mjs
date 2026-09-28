// scripts/paths.mjs —— ffmpeg/ffprobe 自动探测 + 异步执行封装
// 不硬编码任何本机路径：环境变量 → PATH → winget 安装目录 → 常见 Unix 路径
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileP = promisify(execFile);
const IS_WIN = process.platform === "win32";

// 纯 fs 扫 PATH，不用 spawnSync（本机 spawnSync 偶发 EBUSY）
function which(cmd) {
  const exts = IS_WIN ? [".exe", ".cmd", ".bat"] : [""];
  const dirs = (process.env.PATH || "").split(IS_WIN ? ";" : ":").filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}

// winget 装的 Gyan.FFmpeg 真身（可能多个版本目录）
function wingetCandidates() {
  if (!IS_WIN) return [];
  const base = path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const d of fs.readdirSync(base)) {
    if (!/^Gyan\.FFmpeg/i.test(d)) continue;
    for (const sub of fs.readdirSync(path.join(base, d))) {
      const p = path.join(base, d, sub, "bin", "ffmpeg.exe");
      try { if (fs.statSync(p).isFile()) out.push(p); } catch {}
    }
  }
  return out;
}

function resolveFfmpeg() {
  const cand = [
    process.env.FFMPEG,
    which("ffmpeg"),
    ...wingetCandidates(),
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
  ].filter(Boolean);
  for (const c of cand) {
    try { if (fs.statSync(c).isFile()) return path.resolve(c); } catch {}
  }
  return null;
}

export const FFMPEG = resolveFfmpeg();
export const FFPROBE =
  (() => {
    if (process.env.FFPROBE) return process.env.FFPROBE;
    const p = which("ffprobe");
    if (p) return p;
    // 与 ffmpeg 同目录
    if (FFMPEG) {
      const sib = path.join(path.dirname(FFMPEG), IS_WIN ? "ffprobe.exe" : "ffprobe");
      try { if (fs.statSync(sib).isFile()) return sib; } catch {}
    }
    return null;
  })();

export function assertFfmpeg() {
  if (!FFMPEG) throw new Error("未找到 ffmpeg：请安装后加入 PATH，或设置环境变量 FFMPEG=<ffmpeg 绝对路径>");
}

// 异步 spawn（本机 spawnSync 会 EBUSY，必须用异步）。cwd 默认调用方目录。
export async function runFfmpeg(args, { cwd, timeout = 600000 } = {}) {
  assertFfmpeg();
  await execFileP(FFMPEG, args, { cwd, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024 });
}

export async function probeDuration(file, cwd) {
  const { stdout } = await execFileP(
    FFPROBE || FFMPEG,
    ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { cwd, windowsHide: true, timeout: 60000, maxBuffer: 1 * 1024 * 1024 }
  );
  return parseFloat(stdout.trim()) || 0;
}

// 画幅 → 分辨率
export function resolutionOf(aspect) {
  return aspect === "16:9" ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
}
