export const PLAYER_MESSAGES: Record<string, [string, string]> = {
  "player.localTimeline": ["内部声音层 · {0}", "Inside · {0}"],
  "player.ownEffects": ["声音自身效果 · 随内容一起更换", "Sound effects · replaced with the content"],
  "player.outputDuration": ["声音完整时长：{0} 秒（含效果尾音）", "Full sound length: {0} s (including effect tails)"],
  "player.readStart": ["读取起点", "Read from"],
  "player.readEnd": ["读取终点", "Read to"],
  "player.loop": ["循环读取这段声音", "Loop this sound range"],
  "player.playLength": ["播放时长", "Playback length"],
  "player.overflow": ["部分范围超出声音长度，超出部分播放静音；循环仍保持原来的周期。", "Part of the range exceeds the sound length and plays silence. The loop period stays unchanged."],
  "player.editGroup": ["这个组合已裁剪、变速或循环；选择后点击“编辑内容”，在内部时间轴编辑。", "This group has playback transforms. Select it and choose Edit content to edit its source timeline."],
  "player.moveTransformed": ["这次移动涉及已裁剪、变速或循环的组合。请先进入组合内部编辑，或恢复播放设置后移动。", "This move crosses a transformed group. Edit inside the group or restore its playback settings first."],
  "player.fit": ["适配新声音长度", "Fit to sound length"],
};
