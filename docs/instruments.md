# 乐器声部与 melody-design 接入

## 使用

1. 用「打开工程」打开 `examples/instruments/flute/phrase.soundforge`，即可试听、修改五个音符。
2. 从零开始：在「声音资源库」选择内置乐器，或从「管理资源 → 导入资源文件…」导入 `instrument.sfinstrument`。点「使用乐器写音符」创建空谱，再添加音符或导入 `notes.json`。
3. 表格直接编辑 MIDI 音高（C4=60）、起点、时值、力度、乐器、演奏法。起点和时值使用拍，旁边显示秒；可选 1/8、1/4、1/2、1 拍吸附或关闭。BPM 改变实际时间，不改变 MIDI 音高；片段外框缩放沿用既有重采样，会同时改变速度和音高。
4. 「实际采样」显示本音符选中的录音、力度分区与轮替顺序。没有匹配的音域、力度或演奏法时静音并提示，不擅自使用其他演奏法。乐器下拉框决定新增音符的默认乐器；已存在的音符在各自行内切换。
5. 「采样映射」可以将已导入的音频创建为乐器，新增或修改区域、根音、音域、力度、调音、采样增益、演奏法和释放。新区域默认仅覆盖 MIDI 60，需按真实录音设置根音与范围。所有映射修改点击「应用映射」后生效。
6. 「适应音符与尾音」调整声部窗口并在必要时延长作品。保存工程、声音库、组合嵌套与右上角导出使用既有流程；保存文件内嵌采样。导入音符替换所选声部的音符，可撤销。新增的声部也可单独试听。

制作可复用乐器时，使用「声音资源库 → 新建乐器」的音符与音源对应表：左侧每行一个音符，右侧点击音源名切换，空行点击「添加音源」。选择和快捷添加共用声音库；新建音源保存后自动绑定到指定音符。此处编辑乐器定义，谱面编辑仍用于编写旋律。音域共用和精细设置保留在折叠区，原有映射不会因切换界面被重置。

支持音符事件表与钢琴卷帘编辑。乐器轨道默认显示紧凑音符缩略图，点击「音符」或双击片段展开；可拖动音符调整时间和音高，拖动末端调整时值，也可进入音符工作区。没有实时 MIDI 输入、连奏过渡采样或独立时间拉伸。可编辑多声部与和弦，主要面向短旋律和游戏音效。

## 区域选择与真实录音能力

`Instrument.regions` 按 `articulation`、包含端点的 MIDI 音域和力度区间过滤；重叠区域优先选择当前音符的单音绑定，再选择最近根音，然后较窄的音域、力度区间，再以 ID 确定稳定顺序。同一根音、音域、力度区间内的候选按 `roundRobin`、ID 排序，依固定种子选择起始项，然后循环轮替。事件按起点、ID 排序，同组发生次数控制轮替。因此重排 JSON 数组不改变有稳定 ID 的事件结果。相同工程/种子/音符序列可复现。新增或更改同组事件会影响之后的轮替，这是有意的。

力度首先选择真实录音区域，再乘 `velocity / 127`；区域 `gainDb` 用于保留作者采样增益。仅有一个录音的乐器不具备真实多力度层。演奏法是采样区域的标签，不会把一段 sustain 自动转换为录制的 pizzicato、legato 或 portamento。

根音表示录音原始音高，可以在绑定音域之外。普通录音的变调速率为 `2 ** ((midi - rootMidi + tuneCents / 100) / 12)`；未标记音高的录音使用 `fixedPitch:true`，速率为 `2 ** (tuneCents / 1200)`，结合源采样率重采样。音符松键时刻独立于变调速率；原录音的物理长度随变调速率变化，这是普通采样器行为。

## 持续与释放

区域可选 `loop: {start, end, crossfade, verified:true}`。单位为该资产采样率下的**源 PCM 帧**，`start` 含、`end` 不含，左右声道共用。范围必须在资产内，循环至少 32 帧，交叉淡化至少 16 帧且不超过循环一半。循环尾部混合头部，回绕跳过已混合头部，避免双重播放。较高音高一次跨过多个循环时仍按有效周期取模。

启用表示作者已验证该持续段适合循环；数值合法不代表录音一定适合循环。编辑器不凭文件名猜循环点，不把未经验证的作者标记自动启用。来源没有循环时，录音自然播完；音符更长会提示，剩余时间静音。

`releaseSeconds` 是松键后淡出时间（0.005–3 秒）。循环继续平滑运行至淡出结束，避免松键瞬间跳回原始录音位置。有 `releaseAssetId` 时，在松键时启动录制的释放采样，并以最多 30 ms 交叉淡出主录音；释放采样使用相同根音/调音并有边缘防点击淡化。没有释放素材时只有包络淡出，不声称生成了真实释放录音。起音有 3 ms 防点击斜坡，非循环录音结束前有 5 ms 防点击淡化。

## 机器可读格式

工程采用 `momo.soundforge/v4`，乐器演奏为 `Player.type = "instrument"`，谱面保存在 `Player.score`。父输入的 speed/crop/loop 控制本次使用，player.duration 控制源主体。乐器映射使用 momo.score/v1 区域，可绑定录音或完整合成器定义；不支持旧工程格式。普通构造由 makeLayer() 创建使用记录，乐器通常设 gain=1、attack=0、release=0、decay=0、cutoff=22000。

`Score`：

```json
{
  "schema": "momo.score/v1",
  "bpm": 120,
  "instruments": [{
    "id": "flute", "name": "长笛", "source": "来源", "license": "CC0-1.0",
    "regions": [{
      "id": "a4-soft-1", "assetId": "sample-a4-soft-1",
      "rootMidi": 69, "keyLow": 65, "keyHigh": 70,
      "velocityLow": 1, "velocityHigh": 41,
      "articulation": "staccato", "roundRobin": 0,
      "tuneCents": 0, "gainDb": 0, "releaseSeconds": 0.15
    }]
  }],
  "notes": [{
    "id": "note-1", "instrumentId": "flute", "midi": 69,
    "start": 0, "duration": 0.5, "velocity": 35, "articulation": "staccato"
  }]
}
```

采样在工程 `assets` 中按 ID 引用，结构仍为 `{id,name,sampleRate,channels}`；`channels` 为小端 float32 PCM 的 Base64，1–2 声道，有限值范围 −1.01…1.01。便携乐器定义文件是 `{schema:"momo.instrument/v1", instrument: Instrument, assets: {...}}`，扩展名 `.sfinstrument`。导入时保留乐器 ID 供事件引用，重映射资产 ID 以避免覆盖同名资产；同一声部重复导入同 ID 乐器被拒绝，需使用另一个 ID。文件不包含机器绝对路径。

只导入音符时使用：

```json
{
  "schema": "momo.note-events/v1",
  "bpm": 120,
  "notes": [
    {"id":"note-1","instrumentId":"flute","midi":69,"start":0,"duration":0.5,"velocity":35,"articulation":"staccato"}
  ]
}
```

也直接接受 melody-design 的 `format:"melody-design/recipe-v1"`：将 `startSeconds`、`durationSeconds` 按当前声部 BPM 转为拍，并使用当前所选乐器及其第一个区域的演奏法。转换只接收明确的音符 MIDI、时间、力度，不根据 scale/tonic 自动重写音符；该技能配方中的 `durationSeconds` 总时长不覆盖作品窗口，请用「适应音符与尾音」并检查余音。

接入技能无需修改完整知识库：先查实际可用区域，再输出以上事件或原配方，导入后检查“实际采样”和静音提示，最终保存 `.soundforge`。库中缺失的音域不要宣称已用真实录音覆盖。

## 远程音库与本地导入

官方与补充音库通过自描述 `index.json` 自动订阅。主工程不包含采集清单、映射或音频副本；需要离线使用时，在声音资源库中下载完整资源到个人库，保存的资源包会携带完整依赖。

如果要从自己的 WAV 创建乐器，使用「管理资源 → 导入音频」或 AI CLI 的 `import-wav`／`instrument` 命令，并把 WAV 与元数据放在个人工作区。采样映射会写入导出的资源包，不会回写主工程。

旧版采集清单转换示例（仅作历史记录，当前主工程不再提供该目录）

```powershell
node scripts/pack-instrument.mjs --collection <external-collection>/manifest.json --instrument flute --articulation staccato --out examples/instruments/flute
```

可选 `--roots 69,76` 缩小素材集合；大乐器（例如整个钢琴集合）可能超出预算，脚本会拒绝，需选择更小集合。脚本只读取采集目录，不修改或下载素材。转换接受 `momo.instrument-collection/v1` 的 PCM16 WAV 工作副本，验证相对路径不越界。保留根音、音域、力度、演奏法、调音及作者建议增益；力度 0 下限转为 1；原随机窗口重复样本转换为明确的确定性循环，不能声称与完整 SFZ 引擎逐项等价。循环点不自动启用；原始字段、来源及转换记录保存在 `conversion.json`。释放采样只在同包确实包含所引用素材时接入。不是通用 SFZ 导入器。

示例使用 VSCO 2 Community Edition 的长笛录音（CC0-1.0），来源和提交号保存在 `examples/instruments/flute/conversion.json`；3 个采样根音 × 3 个力度区域 × 2 个重复采样。采集清单其他演奏法可用同一脚本生成独立定义文件。示例的五音动机为本项目原创；录音音质不等同于已完成主观听审。

## 资源与验证

作品继续限制每级至少 0.1 秒、16 层、嵌套深度 6、总层数 128。每声部最多 8 个乐器、128 个区域、256 个音符；整棵工程最多 1024 个音符。每级资产 ID 数从 16 调整为 64，整棵工程解码 PCM 仍最多 24 MiB，每资产受采样帧数与字节预算约束、8–192 kHz、1–2 声道。BPM 20–300，音符可设置任意有限的非负起点与正时长，MIDI 0–127、力度 1–127。跨窗口的释放尾音可截断，并给出提示。

`tests/instruments.test.ts` 覆盖真实区域选择、轮替、未覆盖音符、循环/释放、资源保存、嵌套、音符转换和坏输入。示例生成器通过原生 `renderProject` / `encodeWav` 生成 WAV，并校验保存重开后左右声道完全一致；浏览器导出的未处理 WAV 另行与生成器 WAV 做逐字节比较。主观音色听感仍由创作者试听决定。

## 合成器乐器与统一资源库

乐器定义现在可以将一段音域绑定到合成器快照，演奏时接收音高与力度。录音映射能力保留，定义不含旋律。新建、文件夹保存、便携资源格式与自定义算法见[声音资源与本地库](sound-resources.md)；旧采样映射表单仍可用于录音区域的精确编辑。
