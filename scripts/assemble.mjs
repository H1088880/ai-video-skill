// scripts/assemble.mjs —— 逐镜 ffmpeg 拼装 + 烧字幕 + 可选角标 + concat + faststart
import fs from "node:fs";
import path from "node:path";
import { runFfmpeg, probeDuration, resolutionOf } from "./paths.mjs";

async function buildShot(shot, i, project, dir) {
  const idx = i + 1;
  const { w: W, h: H } = resolutionOf(project.aspect || "9:16");
  const pad = project.pad ?? 0.4;
  const dur = shot._dur || project.cardDur || 3;
  const out = `seg_${idx}.mp4`;
  const inputs = [];
  let inputCount = 0;
  const graphs = [];

  if (shot.type === "card") {
    inputs.push("-loop", "1", "-i", `cards/card-${idx}.png`);
    inputCount++;
    graphs.push(`[0:v]scale=${W}:${H},setsar=1,format=yuv420p,fps=30,trim=duration=${dur.toFixed(2)},setpts=PTS-STARTPTS[v0]`);
  } else {
    inputs.push("-i", `clips/shot${idx}.mp4`);
    inputCount++;
    const clipDur = await probeDuration(`clips/shot${idx}.mp4`, dir);
    const stop = Math.max(pad, dur - clipDur + 0.15);
    graphs.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${stop.toFixed(2)},trim=duration=${dur.toFixed(2)},setpts=PTS-STARTPTS[v0]`);
  }

  // 字幕
  let vcur = "[v0]";
  if (shot._ass) {
    const next = "[vsub]";
    graphs.push(`${vcur}subtitles=audio/shot${idx}.ass${next}`);
    vcur = next;
  }
  // 角标叠加：PNG 必须 -loop 1，否则单帧静图 + shortest 会把整段截成 0.03s
  if (shot._tag) {
    const tagInIdx = inputCount;
    const [ox, oy] = (project.tagPos || "80:80").split(":");
    inputs.push("-loop", "1", "-i", `cards/tag-${idx}.png`);
    inputCount++;
    const next = "[vtag]";
    graphs.push(`${vcur}[${tagInIdx}:v]overlay=${ox}:${oy}:shortest=1${next}`);
    vcur = next;
  }
  // filter 图收尾必须是带 filter 名的节点，裸 label（[vsub][v]）会报 No such filter: ''
  graphs.push(`${vcur}copy[v]`);

  // 音频
  const maps = ["-map", "[v]"];
  const audioIdx = inputCount;
  if (shot._wav) inputs.push("-i", `audio/shot${idx}.wav`);
  else inputs.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  inputCount++;
  maps.push("-map", `${audioIdx}:a`, "-t", dur.toFixed(2));

  const args = [
    "-y", "-loglevel", "error",
    ...inputs,
    "-filter_complex", graphs.join(";"),
    ...maps,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", out,
  ];
  await runFfmpeg(args, { cwd: dir });
  console.log(`  [seg] shot${idx} → ${out} (${dur.toFixed(2)}s)`);
}

export async function assemble(project, dir) {
  const list = [];
  for (let i = 0; i < project.shots.length; i++) {
    const shot = project.shots[i];
    if (shot.type !== "card" && !fs.existsSync(path.join(dir, `clips/shot${i + 1}.mp4`))) {
      throw new Error(`缺少 AI 镜头素材 clips/shot${i + 1}.mp4（先用 VideoGen 渲染）`);
    }
    await buildShot(shot, i, project, dir);
    list.push(`file 'seg_${i + 1}.mp4'`);
  }
  fs.writeFileSync(path.join(dir, "concat.txt"), list.join("\n"));
  await runFfmpeg([
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "final_tmp.mp4",
  ], { cwd: dir });
  await runFfmpeg([
    "-y", "-loglevel", "error", "-i", "final_tmp.mp4", "-c", "copy", "-movflags", "+faststart", "final.mp4",
  ], { cwd: dir });
  fs.rmSync(path.join(dir, "final_tmp.mp4"), { force: true });
  if (!process.env.KEEP_SEGS) {
    for (let i = 0; i < project.shots.length; i++) fs.rmSync(path.join(dir, `seg_${i + 1}.mp4`), { force: true });
    fs.rmSync(path.join(dir, "concat.txt"), { force: true });
  }
  console.log(`  [done] ${path.join(dir, "final.mp4")}`);
  return path.join(dir, "final.mp4");
}
