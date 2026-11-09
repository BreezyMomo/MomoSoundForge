# 2026-11-08 交接：VCSL 音乐会竖琴与次中音萨克斯

本轮已完成 VCSL 竖琴与次中音萨克斯的独立音库发布。主仓库只保留通用音库协议和部署入口，不再保存这套音库的 manifest、SFZ 映射或音频副本。下一位继续处理前先读 [内置资源维护流程](builtin-resource-maintenance.md) 和 [多音库与补充素材交接](handoff-multi-libraries.md)。

## 已完成

- 来源固定为 VCSL 提交 `dfcf4a4918771eee884b96ad4493de82ef84daf6`，许可为 CC0-1.0。
- 新增两个乐器定义：`instrument-vcsl-concert-harp`、`instrument-vcsl-tenor-saxophone`。
- 外部音库目录包含 2 个完整乐器、150 个独立音频及全部资源图和校验信息；目录由资源包自描述，主仓库不复制其内部清单。
- Concert Harp 45 个区域，原 SFZ 使用 `xfin`／`xfout` 交叉淡化。当前引擎没有 SFZ 交叉淡化操作码，因此候选将其显式近似为力度 1–69 与 70–127 的硬切分，不能描述为完整复现作者交叉淡化。
- Tenor Saxophone 含非颤音、断奏、颤音三个演奏法，共 105 个区域。
- 44.1 kHz 原件转换为 48 kHz 双声道 PCM16；转换脚本使用确定性的线性插值，保留原件、原始哈希、映射哈希和转换增益记录。

## 验证与接入

- 外部目录可匿名读取，`libraryId` 为 `momo-vcsl-harp-sax`，包含 2 个条目和 150 个音频描述。
- 每个条目携带完整资源图；资源图声明所有音频依赖，加载器会逐项校验图根、内容 ID、压缩哈希和 PCM 身份。
- 主应用通过部署变量 `VITE_SOUND_LIBRARY_URLS` 自动订阅该目录；订阅状态属于浏览器环境，不进入用户工程。
- 主观听审仍需在真实浏览器中完成；技术目录校验不等同于音色质量验收。

## 独立官方音库发布记录

- 为避免原官方音库 Pages 接近 1 GiB 的体积上限，本批次发布到独立系列仓库 [MomoSoundForge-assets-vcsl-harp-sax](https://github.com/BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax)，没有向 `MomoSoundForge-assets` 写入音频或替换既有附件。
- 固定 Release：[2026.11.08-vcsl-harp-sax](https://github.com/BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax/releases/tag/2026.11.08-vcsl-harp-sax)。附件 `MomoSoundForge-vcsl-harp-sax-2026.11.08.zip` 为 149,993,113 字节，SHA-256 `f2d3cf73b3809c2f5813b3958b2aafc4dcbcdd003a71c57b7ccf8b3505ecdd6e`。
- Pages 已部署：[音库目录](https://breezymomo.github.io/MomoSoundForge-assets-vcsl-harp-sax/index.json)，`index.json` SHA-256 `9f5f9f2dbcfb73a2a111cebadb7ee293fe383028faadc7ede3531879f691c1ce`，CORS `Access-Control-Allow-Origin: *`。
- Pages CI：[成功运行 42490524828](https://github.com/BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax/actions/runs/42490524828)。
- 主应用的默认订阅入口由部署配置提供；资源包本身不依赖主仓库的样本清单或映射文件。
