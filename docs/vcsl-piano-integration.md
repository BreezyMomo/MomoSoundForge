# VCSL 补充音库交接

VCSL Harp and Tenor Saxophone 已作为独立远程音库发布：

- 仓库：[MomoSoundForge-assets-vcsl-harp-sax](https://github.com/BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax)
- 目录：[index.json](https://breezymomo.github.io/MomoSoundForge-assets-vcsl-harp-sax/index.json)
- `libraryId`：`momo-vcsl-harp-sax`

目录自带 Concert Harp、Tenor Saxophone 的完整定义、音频依赖、来源和许可。主工程不保存该音库的采样、映射或 manifest；编辑器通过自动订阅读取目录。

更新音源时只在资源仓库生成新的固定目录并完成公网验证，再调整部署配置。当前工程验证使用 `npm test`、`npm run build` 和真实浏览器试听／保存／离线重开。
