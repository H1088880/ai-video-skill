---
name: ai-video-skill
description: 把「AI 文生视频 + 火山引擎旁白 + 排版卡片」自动拼成一条成片的流水线 skill（一份 project.json 出一整条片）。支持竖版 9:16 / 横版 16:9、ai 镜头与 card/角标混合编排、逐镜旁白定长、烧录字幕、faststart。当用户说"做一条 AI 视频 / 短视频 / 宣传片 / 用 AI 生成镜头 / 文生视频出片 / ai video pipeline"，或要给某个产品、研学、文旅、家居等题材做竖版获客短片时使用。
version: "2026-09-28"
origin: github
display_name: "AI 视频生产线"
display_name_en: "AI Video Pipeline"
description_zh: "AI 文生视频 + 火山旁白 + 排版卡片自动拼装成片：一份 project.json 出一整条竖版/横版短视频。"
description_en: "Assemble AI-generated clips, TTS voiceover and排版 cards into a finished vertical/horizontal video from one project.json."
visibility: "public"
---
> 中文触发词：AI 视频、文生视频出片、短视频流水线、宣传片短片、ai video、video pipeline。

# ai-video-skill：AI 视频生产线

一份 `project.json` 出一整条成片。三类素材自动拼装：

- **ai 镜头**：VideoGen 文生视频（5s/段，消耗积分，由 Agent 调用）
- **卡片**：Playwright 渲染的全屏卡 / 透明角标（本地零成本）
- **旁白**：火山引擎豆包 TTS 逐镜配音 + 按标点断句的字幕（本地零成本）

## 目录

```
scripts/make.mjs     总编排：vo → cards → 检查缺料 → assemble
scripts/vo.mjs       火山 TTS（自带实现，不依赖其它 skill）+ 字幕 ASS
scripts/cards.mjs    Playwright 卡片/角标（4 主题）
scripts/assemble.mjs ffmpeg 逐镜拼装 + 烧字幕 + faststart
scripts/paths.mjs    ffmpeg/ffprobe 自动探测
examples/研学获客/    完整示例配置与成片
```

## 用法

```bash
# 1) 复制示例配置，改 project.json（分镜 + 旁白 + 卡片）
cp -r examples/研学获客 projects/我的短片

# 2) 跑本地阶段：生成旁白与卡片（零成本），并打印缺哪些 AI 镜头
node scripts/make.mjs projects/我的短片

# 3) 对打印出的每个 shot 调 VideoGen（aspect 9:16 / 1080P / enable_audio=false），
#    产物重命名为 clips/shotN.mp4 放进项目目录
# 4) 素材齐后重跑，自动拼装成片
node scripts/make.mjs projects/我的短片
```

## project.json schema

```jsonc
{
  "title": "研学获客",
  "aspect": "9:16",          // 9:16 竖版 | 16:9 横版
  "theme": "ocean",          // ocean | warm | forest | minimal
  "voice": "",               // 可选，覆盖 VOLC_TTS_VOICE（须含下划线）
  "pad": 0.4,                // AI 镜头旁白结束后定格补长（秒）
  "cardDur": 3,              // 无旁白卡片默认停留（秒）
  "tagPos": "80:80",         // 角标叠加坐标 x:y
  "shots": [
    { "type": "ai", "prompt": "VideoGen 提示词", "vo": "旁白文案" },
    { "type": "ai", "prompt": "...", "vo": "...", "tag": "角标文字" },
    { "type": "card", "card": "title", "title": "远方研学", "subtitle": "把课堂搬到天地之间" },
    { "type": "card", "card": "data", "caption": "用数据说话", "stats": [{"n":"12","l":"期营"}] },
    { "type": "card", "card": "end", "brand": "远方研学", "cta": "扫码预约试听", "note": "名额有限" }
  ]
}
```

## 环境

| 依赖 | 必需 | 说明 |
|---|---|---|
| ffmpeg/ffprobe | ✅ | 自动探测：环境变量 `FFMPEG` → PATH → winget 目录 |
| 火山 TTS 凭证 | ✅ | `VOLC_TTS_API_KEY`（新版）或 `VOLC_TTS_APP_ID` + `VOLC_TTS_ACCESS_TOKEN`（旧版），写在项目或 skill 根目录 `.env` |
| Playwright | 卡片时 | `npm i playwright && npx playwright install chromium`，或设 `PLAYWRIGHT_MODULE` |
| VideoGen | AI 镜头 | Agent 侧工具，按提示词渲染后放入 `clips/` |

## 已知坑（改代码前务必读）

1. **卡片元素必须走正常文档流**：全部 `position:absolute` 叠在 0,0 时，Playwright 元素截图抓到的是该区域**最上层像素**（最后一张卡），会让所有卡片都变成片尾卡。
2. **角标 PNG 必须 `-loop 1`**：单帧静图 + overlay `shortest=1` 会把整段截成 0.03s。
3. **filter 图收尾不能是裸 label**：`[vsub][v]` 报 `No such filter: ''`，要写 `copy[v]`。
4. **ffmpeg 输入计数别用 `inputs.length/2`**：`-loop 1` 占两个 token，要显式维护 `inputCount`。
5. **VideoGen 并行时 `output_dir` 不可靠**：多个并行调用可能全落进最后一个目录，按文件名（含 prompt 前缀）映射回各 shot。
