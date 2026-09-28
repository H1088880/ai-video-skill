#!/usr/bin/env node
// scripts/make.mjs —— 总编排
// 用法: node scripts/make.mjs <项目目录> [--force-vo]
//   project 目录下放 project.json；产出 clips/ audio/ cards/ final.mp4
// 流程: 火山旁白(vo) + Playwright卡片(cards) → 若 AI 镜头素材缺失则打印渲染计划并退出
//       → 素材齐后 ffmpeg 拼装(assemble)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genVo } from "./vo.mjs";
import { genCards } from "./cards.mjs";
import { assemble } from "./assemble.mjs";
import { FFMPEG } from "./paths.mjs";

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = path.resolve(process.argv[2] || path.join(SKILL_ROOT, "examples", "研学获客"));
const cfgPath = path.join(projectDir, "project.json");

if (!fs.existsSync(cfgPath)) {
  console.error("未找到 project.json:", cfgPath);
  console.error("用法: node scripts/make.mjs <项目目录>");
  process.exit(2);
}
const project = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const aspect = project.aspect || "9:16";

console.log(`\n=== 项目: ${project.title} (${aspect}, 主题 ${project.theme || "ocean"}) ===`);
console.log(`镜头数: ${project.shots.length}  ffmpeg: ${FFMPEG || "未找到(!)"}`);

if (process.argv.includes("--force-vo")) process.env.FORCE_TTS = "1";

console.log("\n[1/3] 火山旁白 + 字幕…");
await genVo(project, projectDir);

console.log("\n[2/3] 卡片 / 角标渲染…");
await genCards(project, projectDir);

const missing = [];
project.shots.forEach((shot, i) => {
  if (shot.type !== "card" && !fs.existsSync(path.join(projectDir, `clips/shot${i + 1}.mp4`))) {
    missing.push({ idx: i + 1, prompt: shot.prompt, vo: shot.vo });
  }
});

if (missing.length) {
  console.log(`\n[3/3] 缺 ${missing.length} 段 AI 镜头素材，需 VideoGen 渲染:`);
  missing.forEach((m) =>
    console.log(`  shot${m.idx}  aspect=${aspect} resolution=1080P enable_audio=false\n         prompt: ${m.prompt}\n         vo: ${m.vo || "（无）"}`)
  );
  console.log(`\n→ 渲染后重命名为 clips/shot{idx}.mp4 放入项目目录，再重跑本命令即可拼装成片。`);
  process.exit(0);
}

console.log("\n[3/3] 素材齐，拼装成片…");
const final = await assemble(project, projectDir);
console.log(`\n✅ 成片: ${final}`);
