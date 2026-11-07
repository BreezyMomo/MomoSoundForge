# 离线原生工具

Node.js 22+，无需 npm install 或源码仓库。脚本与编辑器来自同一引擎源码。输出文件必须不存在，防止覆盖用户作品；更新时使用新的输出名。

```sh
node scripts/cli.mjs help
node scripts/cli.mjs schema
node scripts/cli.mjs catalog
node scripts/cli.mjs new --name "Pickup" --preset pickup --out pickup.soundforge
node scripts/cli.mjs edit --input pickup.soundforge --operations edits.json --out pickup-v2.soundforge
node scripts/cli.mjs validate --input pickup-v2.soundforge
node scripts/cli.mjs render --input pickup-v2.soundforge --out pickup-v2.wav
```

先查询 catalog 再使用实际 preset ID，上方名称仅用于说明。`edits.json` 是 schema 描述的 operations 数组。支持 add、patch、project、polish、group、move、remove、insert；project 可带 path 编辑子工程的组合控件，离线 insert 使用完整 project。validate 检查工程合法性并列出乐器音符问题。render 返回峰值、RMS、增益压低量、尾音状态和 WAV 哈希；不是主观听感认证。在线 MCP 的候选管理、多格式导出与导出设置不属于离线 render 命令，离线目前只输出原生 WAV。

安装包不重复携带整套音源。可从用户明确给出的编辑器站点下载指定内置声音；下载校验目录中的大小和 SHA256，再解压解析：

```sh
node scripts/cli.mjs fetch-sound --id <catalog中的ID> --site <编辑器URL> --out instrument.soundforge
node scripts/cli.mjs fetch-recording --id <catalog.recordings中的ID> --site <编辑器URL> --out recording.sfresource
```

`fetch-recording` 获取独立完整录音资源，保留原始音高、调音与增益，可继续使用 `resource-project` / `resource-render`。`fetch-sound` 中的部分乐器只内嵌最长 4 秒的演奏片段；不要从这些片段提取音频并称为完整录音。两条路径都按需下载并校验大小与哈希。

完整钢琴 `instrument-vcsl-kawai` 定义覆盖 A0–C8。试听按需解码，正式 `fetch-sound`、保存和分享则收集完整乐器（包括未演奏过的音符、力度和松键声）的依赖。`.soundforge` / `.sfresource` 为 ZIP 格式，不能直接 JSON.parse；通过 CLI 打开和修改。初次收集内置素材需要 `--site <编辑器URL>`，完成后新增琴键或改变力度可以离线工作。单次渲染 24 MiB PCM 预算保持不变，分享包完整依赖与实时解码是不同预算。用户创作的定义 JSON 可交给 `resource-pack` 封存，不能把它直接当分享包。

目录版本不匹配时更新 Skill。离线没有网络时使用用户提供的带采样工程。生成音符后修改原有乐器声部的 player.score，保留实际映射；不要伪造乐器覆盖。

## 导入原始 WAV

支持单/双声道 PCM16/24/32 与 float32 WAV，保留原采样率，不修改原文件。其他格式先通过明确的转换工具转换，原件单独保留。元数据 JSON：

```json
{"name":"Wood hit","source":{"provider":"Publisher","url":"https://example.org/sound","author":"Author","license":"CC0","licenseUrl":"https://creativecommons.org/publicdomain/zero/1.0/","quality":"original","retrievedAt":"2026-11-05T00:00:00Z"}}
```

替换为实际核对信息后运行：

```sh
node scripts/cli.mjs import-wav --audio original.wav --metadata source.json --out wood.soundforge
```

在线已有文件时可通过 `sound_import_audio` 插入对应 base64 与来源信息；无需上传到第三方。

## 多采样乐器

使用 `instrument --manifest instrument.json --out instrument.soundforge`，manifest 格式：

```json
{"schema":"momo.soundforge.instrument-input/v1","name":"Piano","instrumentId":"piano","duration":3,"bpm":120,
 "regions":[{"file":"piano-c4.wav","rootMidi":60,"keyLow":60,"keyHigh":60,"velocityLow":1,"velocityHigh":127,"articulation":"sustain","roundRobin":0,"tuneCents":0,"gainDb":0,"releaseSeconds":0.2,"source":{"provider":"Publisher","url":"https://example.org/piano","author":"Author","license":"CC0","licenseUrl":"https://creativecommons.org/publicdomain/zero/1.0/","quality":"original","retrievedAt":"2026-11-05T00:00:00Z"}}],
 "notes":[{"id":"n1","instrumentId":"piano","midi":60,"start":0,"duration":1,"velocity":80,"articulation":"sustain"}]}
```

路径相对 manifest 文件解析；输出工程包含按内容 ID 去重的完整音频依赖，不依赖原路径。映射必须来自真实录音清单，示例默认只覆盖根音，不虚构音域。工具验证原生资源预算和映射格式，validate 再检查每个音符的覆盖/尾音问题。不要逐录音独立归一化以破坏力度层动态。

## 原创旋律练习

`assets/lesson-recipes.json` 保留 melody-design 的 31 组原创 A/B 音符数据。运行 `lesson --id e01-a --out e01-a.soundforge`，再 render。用于解释音高、节奏和音阶等机制，都是基础合成实验，不冒充真实乐器。

## 创建可导入的音源资源

`resource-validate`、`resource-pack`、`resource-render`、`resource-project` 支持合成器算法、乐器定义和音乐／音效资源。先查 `schema.resources`，步骤和示例见 [音源资源](resources.md)。
