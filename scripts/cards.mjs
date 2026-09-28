// scripts/cards.mjs —— Playwright 渲染卡片(全屏)与透明角标
// ⚠️ 关键：所有元素走「正常文档流」纵向排列（不能全部 position:absolute 叠在 0,0），
//    否则 Playwright 元素截图抓到的是该区域最上层像素（最后一张卡），不是元素本身。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 是文件系统路径就转 file:// URL，否则当包名交给 node 解析
function toSpec(c) {
  const isPath = /^[a-zA-Z]:[\\/]/.test(c) || c.includes("/") || c.includes("\\") || c.startsWith(".");
  return isPath ? `file:///${c.replace(/\\/g, "/")}` : c;
}

// Playwright 是可选项：环境变量 → skill 内 node_modules → cwd → 常见技能目录
async function resolvePlaywright() {
  const cands = [
    process.env.PLAYWRIGHT_MODULE,
    "playwright",
    path.join(SKILL_ROOT, "node_modules", "playwright", "index.mjs"),
    path.join(process.cwd(), "node_modules", "playwright", "index.mjs"),
    path.join(os.homedir(), ".workbuddy", "skills", "whiteboard-video", "node_modules", "playwright", "index.mjs"),
  ].filter(Boolean);
  for (const c of cands) {
    try {
      const mod = await import(toSpec(c));
      if (mod && mod.chromium) return mod.chromium;
    } catch {}
  }
  throw new Error(
    "未找到 playwright：在 skill 目录执行 `npm i playwright && npx playwright install chromium`，" +
    "或设置 PLAYWRIGHT_MODULE=<playwright/index.mjs 绝对路径>"
  );
}

const THEMES = {
  ocean:  { bg: "linear-gradient(160deg,#0A2540 0%,#0E4D7A 100%)", accent: "#38BDF8", text: "#FFFFFF", sub: "rgba(255,255,255,.72)", line: "#38BDF8" },
  warm:   { bg: "linear-gradient(160deg,#F3E9DC 0%,#E4C9A8 100%)", accent: "#C2703D", text: "#3A2A1A", sub: "rgba(58,42,26,.66)", line: "#C2703D" },
  forest: { bg: "linear-gradient(160deg,#0F3D2E 0%,#1C6B4C 100%)", accent: "#4ADE80", text: "#FFFFFF", sub: "rgba(255,255,255,.72)", line: "#4ADE80" },
  minimal:{ bg: "linear-gradient(160deg,#FBFBFC 0%,#E9EBEF 100%)", accent: "#111827", text: "#111827", sub: "rgba(17,24,39,.6)", line: "#111827" },
};

function titleCard(t, s) {
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:28px;padding:0 90px;text-align:center">
    <div style="width:90px;height:6px;background:${t.line};border-radius:3px"></div>
    <div style="font-size:104px;font-weight:800;line-height:1.18;color:${t.text};letter-spacing:2px">${s.title}</div>
    <div style="font-size:46px;line-height:1.5;color:${t.sub}">${s.subtitle || ""}</div>
  </div>`;
}
function dataCard(t, s) {
  const stats = (s.stats || []).map((x) =>
    `<div style="display:flex;flex-direction:column;align-items:center;gap:14px;min-width:240px">
       <div style="font-size:130px;font-weight:800;color:${t.accent};line-height:1">${x.n}</div>
       <div style="font-size:42px;color:${t.sub}">${x.l}</div>
     </div>`).join("");
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:50px;padding:0 80px">
    <div style="font-size:44px;color:${t.sub};letter-spacing:3px">${s.caption || ""}</div>
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:60px">${stats}</div>
  </div>`;
}
function endCard(t, s) {
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:40px;padding:0 90px;text-align:center">
    <div style="font-size:96px;font-weight:800;color:${t.text}">${s.brand}</div>
    <div style="font-size:48px;color:${t.text};background:${t.accent};padding:22px 54px;border-radius:60px;font-weight:700">${s.cta}</div>
    <div style="font-size:38px;color:${t.sub}">${s.note || ""}</div>
  </div>`;
}
// 透明角标（pill 尺寸小元素，叠加在 AI 镜头上）
function tagEl(t, s) {
  return `<div id="TAGID" style="display:inline-block;background:rgba(10,37,64,.62);border:2px solid ${t.line};color:#fff;
    font-size:42px;font-weight:700;padding:16px 40px;border-radius:50px;white-space:nowrap">${s}</div>`;
}

export async function genCards(project, dir) {
  const hasCard = project.shots.some((s) => s.type === "card" || s.tag);
  if (!hasCard) return;
  const chromium = await resolvePlaywright();
  const cardsDir = path.join(dir, "cards");
  fs.mkdirSync(cardsDir, { recursive: true });
  const theme = THEMES[project.theme] || THEMES.ocean;
  const W = project.aspect === "16:9" ? 1920 : 1080;
  const H = project.aspect === "16:9" ? 1080 : 1920;
  const FONT = "'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif";

  const bodies = [];
  project.shots.forEach((shot, i) => {
    const idx = i + 1;
    if (shot.type === "card") {
      let inner = "";
      if (shot.card === "title") inner = titleCard(theme, shot);
      else if (shot.card === "data") inner = dataCard(theme, shot);
      else if (shot.card === "end") inner = endCard(theme, shot);
      bodies.push(`<div id="card-${idx}" style="width:${W}px;height:${H}px;background:${theme.bg};font-family:${FONT};overflow:hidden">${inner}</div>`);
    }
    if (shot.tag) {
      bodies.push(`<div style="margin:20px 0 20px 40px;font-family:${FONT}">` + tagEl(theme, shot.tag).replace("TAGID", `tag-${idx}`) + `</div>`);
    }
  });

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:transparent; }
  </style></head><body>${bodies.join("\n")}</body></html>`;
  const htmlPath = path.join(cardsDir, "cards.html");
  fs.writeFileSync(htmlPath, html);

  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(500);

  for (let i = 0; i < project.shots.length; i++) {
    const idx = i + 1;
    const shot = project.shots[i];
    if (shot.type === "card") {
      const el = page.locator(`#card-${idx}`);
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path: path.join(cardsDir, `card-${idx}.png`) });
      shot._card = path.join(cardsDir, `card-${idx}.png`);
      console.log(`  [card] card-${idx} (${shot.card})`);
    }
    if (shot.tag) {
      const el = page.locator(`#tag-${idx}`);
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path: path.join(cardsDir, `tag-${idx}.png`), omitBackground: true });
      shot._tag = path.join(cardsDir, `tag-${idx}.png`);
      console.log(`  [tag] tag-${idx} 「${shot.tag}」`);
    }
  }
  await browser.close();
}
