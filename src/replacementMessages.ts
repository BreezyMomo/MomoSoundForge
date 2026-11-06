export const REPLACEMENT_MESSAGES: Record<string, [string, string]> = {
  "replace.title": ["更换内容", "Replace content"],
  "replace.intro": [
    "选择录音或组合，在完整作品中试听。确认后只更换所选声层的内容，一次撤销即可恢复。",
    "Preview recordings or combinations in the full work. Confirmation replaces only the selected layer content; one undo restores it.",
  ],
  "replace.candidates": ["候选素材", "Sample candidates"],
  "replace.source": ["素材来源", "Sample sources"],
  "replace.samples": ["录音素材", "Recordings"],
  "replace.compositions": ["声音组合", "Combinations"],
  "content.edit": ["编辑内容", "Edit content"],
  "content.outer": [
    "声层设置 · 更换内容时保留",
    "Layer settings · kept when replacing content",
  ],
  "content.synth": ["合成声音", "Synthesized sound"],
  "content.sample": ["音频片段", "Audio clip"],
  "content.instrument": ["乐器演奏", "Instrument performance"],
  "content.composition": ["声音组合", "Sound combination"],
  "replace.project": ["当前组合素材", "Current group assets"],
  "replace.import": ["本地音频", "Local audio"],
  "replace.search": ["搜索素材…", "Search samples…"],
  "replace.choose": ["试听替换：{0}", "Preview replacement: {0}"],
  "replace.empty": [
    "没有匹配的素材，可换个关键词或导入本地音频。",
    "No matching samples. Try another keyword or import local audio.",
  ],
  "replace.settings": ["替换方式", "Replacement settings"],
  "replace.current": ["当前内容", "Current content"],
  "replace.new": ["新内容", "New content"],
  "replace.loading": ["正在载入…", "Loading…"],
  "replace.select": [
    "从左侧选择，或导入本地音频",
    "Choose a recording or import local audio",
  ],
  "replace.preserveHelp": [
    "保留声层名称、位置、音量、声像、静音／独奏和外部效果；音量与声像曲线随新时长展开。",
    "Keep layer name, position, volume, pan, mute/solo and outer effects. Volume and pan curves follow the new duration.",
  ],
  "replace.detach": [
    "将解除 {0} 处指向旧内容的控件绑定；开始位置、音量和声像绑定保留。",
    "{0} bindings to the old content will be removed. Position, volume and pan bindings stay.",
  ],
  "replace.clearCurve": [
    "旧内容的滤波曲线将移除。",
    "The old content’s filter curve will be removed.",
  ],
  "replace.contentHelp": [
    "用候选内容的完整设置替换旧内容。旧组合的子声层、片段裁切和合成参数不会沿用。",
    "Use the candidate content settings. Old child layers, clip trims and synthesis settings are not carried over.",
  ],
  "replace.timing": [
    "声层时长：{0} s → {1} s",
    "Layer duration: {0} s → {1} s",
  ],
  "replace.window": [
    "作品时长保持 {0} s。超出作品末尾的声音需延长作品后才能完整试听与导出。",
    "Work duration stays {0} s. Extend it to hear and export any sound beyond its end.",
  ],
  "replace.muted": [
    "当前静音或独奏设置可能使这条声层在作品中听不见。",
    "Current mute or solo settings may make this layer inaudible in the work.",
  ],
  "replace.original": ["试听原组合", "Play original mix"],
  "replace.preview": ["试听替换效果", "Play replacement mix"],
  "replace.stop": ["停止试听", "Stop preview"],
  "replace.apply": ["确认替换", "Confirm replacement"],
  "replace.stale": [
    "工程已发生变化，请关闭后重新打开替换面板。",
    "The project has changed. Close and reopen this replacement dialog.",
  ],
  "error.replaceSource": [
    "内容无法用于替换，请选择有效的录音或声音组合。",
    "This content cannot be used. Choose a valid recording or sound combination.",
  ],
  "error.replaceProject": [
    "无法完成替换：工程中的参数或资源未通过校验。原内容未更改。",
    "Replacement failed: project parameters or resources did not pass validation. The original content is unchanged.",
  ],
};
