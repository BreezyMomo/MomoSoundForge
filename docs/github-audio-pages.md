# GitHub Pages 音库部署

编辑器与音库分别发布在以下仓库：

- [MomoSoundForge](https://github.com/BreezyMomo/MomoSoundForge)：框架、协议和工程逻辑。
- [MomoSoundForge-assets](https://github.com/BreezyMomo/MomoSoundForge-assets)：官方自描述音库。
- [MomoSoundForge-assets-vcsl-harp-sax](https://github.com/BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax)：补充音库。

官方目录为 `https://breezymomo.github.io/MomoSoundForge-assets/index.json`，补充目录为 `https://breezymomo.github.io/MomoSoundForge-assets-vcsl-harp-sax/index.json`。编辑器通过 `VITE_SOUND_LIBRARY_URL` 和 `VITE_SOUND_LIBRARY_URLS` 订阅它们；资源仓库不需要被克隆到主工程，主工程也不生成音库目录。

发布顺序：先发布不可变资源文件，再发布目录；验证 HTTPS、CORS、目录 schema、依赖闭包、大小和哈希；最后构建并发布编辑器。不要覆盖已发布目录，不使用 `latest`，不要把音频提交到任一 Git 历史。

真实浏览器验收包括资源搜索、试听、完整资源下载、个人库保存、工程保存重开和 WAV 导出。资源包携带完整依赖后，即使音库暂时离线也能继续编辑。

乐器维护规则见 [乐器整理与替换规则](instrument-library-rules.md)。2026-11-09 乐器整理、资源图修复、固定 Release、成功 CI 和目录哈希见 [管弦乐器交接](handoff-orchestra-complete.md)；历史候选状态不能代替该发布记录。
