# ai-video-skill · AI 视频生产线

把 **AI 文生视频 + 火山引擎旁白 + 排版卡片**自动拼成一条成片：**一份 `project.json` 出一整条片**。

- 📱 竖版 9:16 / 横版 16:9 一键切换
- 🎬 `ai` 镜头（VideoGen）与 `card` 卡片、透明角标自由混编
- 🎙 火山豆包 TTS 逐镜配音，镜头时长按旁白自动定长
- 🔤 字幕按标点断句、按字数比例分配时长，ffmpeg 烧录
- ⚡ 本地零成本（除 AI 镜头渲染消耗积分）

示例成片：`examples/研学获客/final.mp4`（26.6s 竖版，4 段 AI 镜头 + 3 张卡片；仓库内为便于下载的 720×1280 压缩版，流水线出片默认是 1080×1920）。

## 快速开始

```bash
# 1) 复制示例配置改你的分镜
cp -r examples/研学获客 projects/我的短片
#   编辑 projects/我的短片/project.json

# 2) 本地阶段：生成旁白与卡片，并打印缺哪些 AI 镜头
node scripts/make.mjs projects/我的短片

# 3) 对打印出的 shot 调 VideoGen
#    aspect_ratio=9:16  resolution=1080P  enable_audio=false
#    产物重命名为 clips/shot{idx}.mp4 放进项目目录

# 4) 素材齐后重跑，自动拼装成片
node scripts/make.mjs projects/我的短片
```

产出：`projects/我的短片/final.mp4`（1080×1920 或 1920×1080，H.264 + AAC，faststart）。

## 目录结构

```
scripts/make.mjs     总编排：vo → cards → 检查缺料 → assemble
scripts/vo.mjs       火山 TTS（自带实现）+ 字幕 ASS 生成
scripts/cards.mjs    Playwright 卡片/角标渲染（ocean/warm/forest/minimal）
scripts/assemble.mjs ffmpeg 逐镜拼装 + 烧字幕 + faststart
scripts/paths.mjs    ffmpeg/ffprobe 自动探测
examples/研学获客/    完整示例配置
SKILL.md             Agent 触发词与工作流
```

## 环境要求

| 依赖 | 必需 | 说明 |
|---|---|---|
| Node.js ≥ 18 | ✅ | 原生 ESM |
| ffmpeg / ffprobe | ✅ | 自动探测：环境变量 `FFMPEG` → PATH → winget 安装目录 |
| 火山 TTS 凭证 | ✅ | `.env` 里写 `VOLC_TTS_API_KEY`（新版）或 `VOLC_TTS_APP_ID` + `VOLC_TTS_ACCESS_TOKEN` |
| Playwright | 用卡片时 | `npm i playwright && npx playwright install chromium`；或设 `PLAYWRIGHT_MODULE` |
| VideoGen | AI 镜头 | Agent 侧工具（约 50–100 积分 / 5 秒） |

## project.json 配置

```jsonc
{
  "title": "研学获客",
  "aspect": "9:16",      // 9:16 | 16:9
  "theme": "ocean",      // ocean | warm | forest | minimal
  "pad": 0.4,            // 旁白结束后定格补长（秒）
  "cardDur": 3,          // 无旁白卡片停留（秒）
  "tagPos": "80:80",     // 角标坐标
  "shots": [
    { "type": "ai", "prompt": "竖屏电影感镜头…", "vo": "同样的暑假，有的孩子刷题。" },
    { "type": "ai", "prompt": "…", "vo": "…", "tag": "暑期营·每期仅20席" },
    { "type": "card", "card": "title", "title": "远方研学", "subtitle": "把课堂搬到天地之间" },
    { "type": "card", "card": "data", "caption": "用数据说话",
      "stats": [{ "n": "12", "l": "期营" }, { "n": "300+", "l": "学员" }] },
    { "type": "card", "card": "end", "brand": "远方研学", "cta": "扫码预约试听", "note": "名额有限" }
  ]
}
```

## 实现要点（改代码前必读）

1. **卡片元素必须走正常文档流**——全部 `position:absolute` 叠在 0,0 时，Playwright 元素截图抓到的是该区域最上层像素，会让所有卡片都变成片尾卡。
2. **角标 PNG 必须 `-loop 1`**——单帧静图 + overlay `shortest=1` 会把整段截成 0.03s。
3. **filter 图收尾不能是裸 label**——`[vsub][v]` 报 `No such filter: ''`，要写 `copy[v]`。
4. **ffmpeg 输入计数别用 `inputs.length/2`**——`-loop 1` 占两个 token，要显式维护 `inputCount`。
5. **VideoGen 并行时 `output_dir` 不可靠**——多个并行调用可能全落进最后一个目录，按文件名（含 prompt 前缀）映射回各 shot。

## 许可

Apache-2.0，见 `LICENSE`。
