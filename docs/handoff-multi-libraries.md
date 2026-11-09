# 多音库与下一轮音频补充交接

后续已开始执行音频补充，最新批次、发布状态和下一轮缺口见 [完整管弦乐器交接](handoff-orchestra-complete.md)。本文件保留多音库协议及通用检索流程。

用户目标：面向不懂音频专业知识的游戏开发者；可配置多个音库，官方库和第三方库共用协议，托管服务不限 GitHub。用户授权本轮实现、测试、提交和 push。下一轮继续工作前依次读：

1. [产品目标](product-vision.md)
2. [不可变资源规则](immutable-resource-architecture.md)
3. [多音库协议与规则](remote-sound-libraries.md)
4. [内置资源维护](builtin-resource-maintenance.md)
5. [GitHub 当前发布记录](github-audio-pages.md)

## 实现入口与边界

- `src/remoteLibrary.ts`：HTTPS 目录校验、文件预算和 SHA-256、资源图展开、音频依赖与完整读取。
- `src/remoteSubscriptions.ts`：浏览器订阅设置、音库身份、刷新／停用／移除的并发隔离；不是工程数据。
- `src/RemoteLibrarySettings.tsx`：管理资源中的外部音库设置。`SoundLibrary.tsx` 统一查询，按内容 ID 合并远端卡片、保留来源名称；本地音频按 ID 复用。
- 资源仓库负责生成 `momo.remote-sound-library/v1` 目录。主工程只消费目录，不再携带生成脚本、manifest 或映射。
- `tools/ai-cli.ts`：`remote-catalog --url INDEX_URL` 查询目录；`remote-fetch --url INDEX_URL --id ENTRY_ID --out RESOURCE.sfresource` 收齐完整依赖。编辑器 AI 的资源查询／插入也支持已启用的远程资源。
- 尚不提供账号同步、远程上传 API、服务商控制台、一键 Git 提交发布或共享音频垃圾回收。订阅列表在浏览器；“下载到本地库”才是磁盘持久资源，试听缓存不是备份。

## 发布一个新的分类音库

先在编辑器完成资源和乐器定义，导出完整分享包，再在资源仓库生成目录：

```sh
资源仓库的构建流程 --output <全新输出目录> --id <稳定音库ID> --name <显示名称> --input <资源.sfresource> --input <另一个资源.soundforge>
```

把生成目录完整发布到 HTTPS 静态服务，允许跨域访问，然后在“管理资源 → 外部音库”填写 `index.json` 地址。可以是 GitHub Pages、对象存储、CDN 或内部静态服务。每个库自带完整依赖；不同库的同一音频到本地仍按内容 ID 去重。

服务必须保留生成文件的原始字节及相对路径；`.bin` 是应用自行解压的 gzip 数据，不要设置会让浏览器提前解压这份文件的 `Content-Encoding: gzip`。目录和二进制都需允许编辑器 origin 读取。当前只支持公开、无需凭据且无跳转的地址，不支持签名查询参数或私有账号登录。

更新同一音库保持 `libraryId`，生成全新候选目录，先上传资源文件再切换目录；不能提前删除旧目录引用的文件。发布到 GitHub 时，大型资源继续通过 Actions 产物／Pages 或 Releases 分发，不能塞进 Git 历史。当前生成工具接受完整输入集合，不是增量追加命令；漏传旧资源会使其从新目录中消失。

## 后续去哪里找音频

优先找有完整来源与映射的成熟素材，不让用户承担专业听审，也不要把技术检查说成“保证音准／音色真实”。以下入口在 2026-11-07 核查；每次采集仍固定实际版本、保存许可原文。

- **整套乐器优先 VCSL**：[作者仓库](https://github.com/sgossner/VCSL)、[README](https://github.com/sgossner/VCSL/blob/master/README.md)。检索乐器英文名及演奏法，如 `flute sustain`、`violin pizzicato`、`trumpet staccato`；选择同一套 WAV 与其配套 SFZ，不混用不同版本。现有 Harp/Sax 补充库已发布到 [独立资源仓库](https://github.com/BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax)，来源提交由该库自描述目录记录。
- **管弦乐备选 VSCO 2 CE**：[作者发布页](https://github.com/sgossner/VSCO-2-CE/releases)。现有弦乐／木管／铜管多数源于此系列，先读采集集合的 manifest 和 mappings，确认是否已经有同一录音。不要仅换下载站就声称换了一套音源。
- **基础游戏音效优先 Kenney**：[素材入口](https://kenney.nl/assets)、[授权说明](https://kenney.nl/support)。筛选 Audio，按 `UI`、`impact`、`interface`、`RPG` 等用途找包；保留包内许可和作者信息。
- **自然环境与拟音补缺用 Freesound**：[检索](https://freesound.org/search/)、[许可说明](https://freesound.org/help/faq/)。按“材质＋动作＋环境”搜索，例如 `wood footstep dry`、`rain window interior`、`forest birds ambience`。优先 CC0，但必须逐条检查来源页；免费试听／能用于作品，不代表允许把原始素材重新分发成音库。
- OpenGameArt 等只能作为补充候选，逐条核验。不要录制在线钢琴网站、游戏或视频的输出来充当可再分发的原始乐器库。现有自动检索工具只提供 Freesound 预览导入，MP3 预览不能冒充原始 WAV；详见 [音源采集说明](../skills/momo-sound-forge/references/sources.md)。

## 补充素材的具体顺序

1. 先检索所有已启用音库目录，列缺口。其他乐器的整套品质替换仍未完成；建议按弦乐、木管、铜管逐套推进，别一次换全部。
2. 保存作者、准确来源页、固定提交／Release、许可、原件哈希和获取日期；确认允许原始采样再分发。需要署名就随音库和资源一起保留。
3. 从作者 SFZ／明确说明读取根音、键域、力度档、技法、轮替、循环、松键、增益、调音和 offset。不能依据文件名猜“轻中重”，不能补造没有录制的音符或宣称所有演奏法都支持。
4. 保留原件，记录转换工具与参数。不要逐音符归一化破坏力度关系；若暂存增益用于量化精度，必须保存反向补偿。技术检查涵盖解码、静音、峰值、尾音、元数据与转换可复现。
5. 建乐器映射并检查低／中／高音、各实际力度和轮替、短按／长按、松键、循环接缝与无录音区域。`tools/diagnose-instruments.mjs`、`tools/review-sound-sources.mjs`、现有 `tests/vcslPiano.test.ts` 可作参考，不可直接声称它们覆盖新增乐器。
6. 按 [维护流程](builtin-resource-maintenance.md) 在资源仓库生成新目录、发布固定版本并验证空缓存恢复；主仓库只更新部署 URL。不能提交大型音频到 Git。
7. 跑 `npm test`、`npm run build`；实际浏览器订阅、试听、绑定乐器、保存重开、导出；断开远端后新增未演奏的音符仍可发声。
8. 记录到底改了什么、技术通过什么、哪些音色尚未主观确认、发布地址和提交 SHA。遵循当轮提交／发布授权，不替用户订阅付费服务。

历史审查报告中保留旧体积和旧格式，是历史事实，不是当前实现。当前测试与发布状态在下节填写。

## 本轮验收

本地验收已通过：`npm test` 最终为 48 个文件、396 项（含 6 项临时网络故障重试测试）；`npm run test:assets` 为 6 个文件、16 项；TypeScript、`npm run build`、构建后再次运行资源测试均通过。线上音库及应用均已成功部署，记录见下节。

- 官方目录生成 1,142 个条目和 1,159 个共享音频对象；保留现有基础合成器与程序预设。
- 真实浏览器同时订阅官方库和本地独立测试库，按来源筛选并使用测试乐器；移除测试库、停止其服务器后仍可新增 C5、试听、保存和刷新恢复草稿。保存的工程包含完整的两份录音，离线渲染与既有参照 WAV 哈希一致。
- AI CLI 通过同一目录下载完整 Kawai 乐器：分享包含 222 份音频，独立进程禁止网络后仍能演奏此前未播放的 A0（力度 30）和 C8（力度 115）。这验证完整依赖，不是音色主观质量结论。
- 单元测试覆盖库身份、坏目录／哈希／预算、完整依赖、共享音频、失败隔离、地址迁移及移除／停用竞态。订阅测试不会写入作品或撤销历史。
- `test-results/` 的日志、截图、验收包只在执行机器保留，不提交大文件。下一位 AI 应以已提交测试和下方 CI 记录复验，不依赖本机临时文件。
- 最终候选音库含 2,583 个清单内文件，共 739,016,297 字节（含清单）；全部文件大小／哈希及目录完整性检查通过。外置编辑器约 36.5 MiB。原始输入 Release 仍为 `2026.11.07-1`；没有新增或替换源录音。

## 本轮发布记录（2026-11-07）

- 实现提交 `a71a33539686f7db8ee258666f410862a2758f43`，网络重试修复 `ecd64c737e79d15fd3232aacde981b411eade2d0`，已推送开发分支并快进到 `main`。资源仓库说明提交 `92e45ba`、`828a389`。
- [音库 CI 与部署](https://github.com/BreezyMomo/MomoSoundForge-assets/actions/runs/42367324846) 成功：固定输入恢复、390 项普通测试、16 项素材测试、生成目录一致性、发布体积及文件哈希全部通过。
- 正式目录：[index.json](https://breezymomo.github.io/MomoSoundForge-assets/index.json)，`libraryId=momo-official-sounds`。Windows 本机候选与 Linux 产物一致；公网目录、资源图和音频依赖的大小、SHA-256、CORS 检查通过。
- 独立 origin 的生产构建从正式音库加载草地脚步、保存工程和导出 WAV 成功；工程的离线渲染与网页 WAV 逐字节一致，SHA-256 `383e093fb03b3a68390929de7c7adf3e28ecde2bee575d4a8c092b5ed07fb8ff`。
- [首次编辑器 CI](https://github.com/BreezyMomo/MomoSoundForge/actions/runs/42368009924) 的构建和测试通过，发布前读取已存在的音库文件时遇到 GitHub HTTP 503，因此停止部署。校验工具随后增加最多 3 次、1／2 秒退避的临时网络及 429／500／502／503／504 重试；404、哈希不符、超大文件和 CORS 错误仍立即失败，没有跳过远端校验。未改变资源内容，无需重新发布音库。
- [最终编辑器 CI 与部署](https://github.com/BreezyMomo/MomoSoundForge/actions/runs/42368897983) 成功，部署代码为 `ecd64c7`：396 项普通测试、16 项素材测试、生产构建、公开音库全部文件与 CORS 检查均通过。正式入口：[MomoSoundForge](https://breezymomo.github.io/MomoSoundForge/)。
- 正式页面实测“管理资源 → 外部音库”显示官方目录与 1,142 项资源，搜索草地脚步并试听正常；页面未出现运行错误。截图为本机 `test-results/multi-library-official-settings.png`。上方“共 995 项”是默认“音源”类型筛选后的数量，不是目录缺项。
- 本轮工作已完成。接手时从 `main` 开始，下一阶段仍是按前述来源和核验流程整理其他乐器；不用重做音库外置、Git 历史清理或本轮多音库改造。
