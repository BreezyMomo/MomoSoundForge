# 连接与编辑

## 安装和启动

用户从 SoundForge 顶部 AI 工具下载 ZIP，解压后将 `momo-sound-forge` 目录放进其 AI 客户端支持的 Skill 目录，或者使用“选择技能目录并安装”。安装器备份已变更文件。重新加载 Skill 后，准备 Node.js 22+。

从本 Skill 目录运行：

```sh
node scripts/server.mjs --port 8799 --allow-origin http://127.0.0.1:5180
```

`--allow-origin` 必须是用户正在使用的编辑器来源（协议、主机、端口）；可重复指定，不能使用通配符。网页部署在 HTTPS 也可使用本机服务，浏览器可能要求本地网络权限。仅监听 `127.0.0.1`。先 GET `/health` 检查同端口服务；来源需调整时由用户授权的本次服务重启，不能终止不相关进程。在 Windows 后台启动服务用隐藏窗口。

服务启动后让用户点击“连接当前页面”，复制显示的 MCP 配置到支持 Streamable HTTP 的 AI 客户端。配置含本次服务随机令牌，不写进工程、不公开分享。不同客户端的配置格式可能不同，以客户端支持为准，endpoint 和 Authorization 值不变。纯云端执行环境不能直接连接用户电脑的回环地址，使用离线工程交付。

## 一次创作

1. `sound_pages`：确认目标名称与 pageId；多个页面且目标不明确时询问，不选默认第一页。
2. `sound_schema` 与 `sound_catalog`：查询支持的编辑字段和实际声音 ID。默认只查询内置目录；用户要求使用自己的声音时用 personal。目录每页 40 条，通过 nextOffset 继续。
3. `sound_capture`：获取 snapshotId、声音树、乐器区域和视频标记。素材只有元数据，不自动传输 PCM。每页只有一个当前快照，再次捕获使旧 snapshotId 失效。
4. `sound_edit`：传 pageId、snapshotId、operations。默认 edit 保留现有内容；create 清空再创建，只在用户要求新作品时使用。一个批次一个撤销记录；任何操作无效则全批不应用。
5. 修改返回新 capture。用新 snapshotId 调 `sound_render` 获取原生 WAV 和数值。可给 node `{path:[],id:"..."}` 单独试听；完整作品响应过大时指定 start/end 区间，或者 `sound_export` 下载完整音频和工程。

示例：

```json
{"operations":[
  {"op":"add","layer":{"id":"pickup-tone","name":"拾取亮点","content":{"wave":"sine","frequency":880,"endFrequency":1320},"duration":0.3,"gain":0.25}},
  {"op":"project","patch":{"duration":1}}
]}
```

`insert` 使用目录返回的 `soundId`，或者完整 `project`。插入保留必要组合边界，中性单层根直接复用原使用记录；再次 capture 后按实际子节点路径调整，不能猜自动 ID。播放器有自身修饰 player.effects；修改 effects 或 player.score 是整体替换该字段，应保留未修改项。调整乐器音符时先读取原 player.score 的 instruments，然后替换 notes。修改分组内容会重新计算分组时长；作品时长需明确设置，超出作品范围的内容不会默认导出。

`sound_history` 按 fresh snapshot 撤销/重做。`sound_save_library` 保存为新的个人库资源，不覆盖同名旧项，先读回结果避免超时重试产生重复。`sound_project` 显式取得带采样的原生工程，可能较大。

客户端断开、超时或取消后不能推断操作失败。先查询连接页、重新捕获，核对内容或个人目录，再决定是否继续。用户编辑后旧 snapshot 写入会被拒绝；渲染同一 snapshot 始终对应同一作品版本。

## 变体候选

`sound_variants` 接收 fresh snapshot、count（1–5，默认 5）、amount（0–1，默认 0.35）、seed（默认当前种子）和可选 path。返回 setId 与候选摘要，同时展示在编辑器原有变体工作区，尚未修改作品。path 指向分组内部时只生成该子工程的候选；候选中的 node 路径从该子工程开始。

用 `sound_render` 的 `variant:{setId,index}` 试听（index 从 0 开始），同样可传给 `sound_project`、`sound_save_library` 和 `sound_export`。确定选择后，`sound_apply_variant` 传 fresh snapshot、setId、index，应用形成一次撤销。用户修改作品后旧候选不能再直接应用；重新捕获并生成候选。每页仅保留一组 MCP 候选，下一次生成会替换；不要把 setId 当成持久资源 ID。锁定节点保留声音，amount 为 0 时声音不变。

## 声音修饰与嵌套组合控件

`sound_edit` 支持 `polish` 操作，与界面的听感滑杆共用换算，不必整体替换 effects：

```json
{"op":"polish","path":[],"id":"实际节点ID","action":"adjust","values":{"low":30,"high":15,"reverb":12}}
```

low/mid/high 为 -100–100；feedback/wet/reverb 为 0–100；delayTime 仍是秒（0.01–1）。`action:"reset"` 可重置全部，或指定 group 为 tone/delay/space；`action:"toggle",group:"space",enabled:false` 临时关闭该组并保留数值。adjust 不自动开启已关闭的效果组。没有独立的修饰预设库，不要声称某个预设已存在。`sound_render` 的 beforePolish `{path,id}` 只在本次渲染中旁路该节点效果，可与正常渲染对比，不修改工程。

通过 `op:"project",path:["分组ID"],patch:{controls:[...]}` 定义任意一级子工程的组合控件。父控件绑定子控件时用 `{layerId:"分组ID",parameter:"control",controlId:"子控件ID",low:0,high:1}`；范围必须落在子控件范围内。先定义子控件，再绑定父控件。同批操作整体校验，错误不会部分提交；更改范围时，已有值和父绑定范围按编辑器规则同步收敛。显式传入的新值越界会报错。自动化点的 time 是源片段内的 0–1 归一化位置，不是秒；当前参数已由组合控件控制时不能再绑定自动化。

## 导出与成品试听

`sound_schema` 返回 export 字段范围和 currentExportSettings。`sound_export` 支持 WAV、OGG、MP3、FLAC，settings 可覆盖 format、sampleRate（22050/44100/48000）、mono、normalize、targetRms、trimSilence、preserveTail、tail、loopOnly、prefix。未提供的值沿用当前导出面板；本次覆盖不会修改用户偏好。preserveTail 保留完整内容与自然尾音，不恢复片段内部裁切；tail 是处理完成后追加的纯静音秒数。loopOnly 要求目标有实际循环区间，忽略 preserveTail、trimSilence 和 tail。includeProject 默认 true。

传 `variantSetId` 可批量下载候选 ZIP，包含音频、可编辑工程和 manifest；不能同时传 node 或 variant。单个导出可选 node 或 variant。与右上角导出共用尾音渲染、循环处理、静音裁剪、响度调整、重采样与编码流程。

需要取得实际成品音频供客户端试听时，使用 `sound_render` 的 `output:"export",settings:{...}`；返回实际编码的文件，metrics 标注为编码前的处理结果。此模式不能同时使用 start/end 或 beforePolish。原生试听仍默认 WAV；成品响应上限 8 MiB，过大时直接下载。OGG/MP3/FLAC 首次使用会加载本地编码器。离线 CLI 的 render 目前仍只输出原生 WAV。

原生工程为 momo.soundforge/v4，文档持有 root 播放器；capture 返回根混音视图 inputs。输入的发声参数位于 player，例如 patch: {player: {frequency: 880}}。player 浅合并，score/effects 等字段整体传入。位置、读取起止（秒）、速度、循环、播放占用、音量、声像留在输入；effects 属于 player。嵌套组合为 input.player.mix.inputs，音符为 input.player.score，组合控件值为 input.player.controlValues。duration 是播放占用，player.duration 是源主体时长。普通 patch 不能改变 type、assetId 或 mix。替换时保留输入使用设置，超出新声音范围补静音。

## 统一声音资源与本地库

`sound_resources` 与 `sound_import_resource` 的类型、个人库访问范围和保存流程见 [音源资源](resources.md)。个人资源使用用户已连接的文件夹；资源保存不进入作品撤销，新增定义与保存完整音乐／音效是不同类型。
