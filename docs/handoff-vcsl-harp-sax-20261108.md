# 2026-11-08 交接：VCSL 音乐会竖琴与次中音萨克斯

本轮已完成一批完整乐器的本地候选制作，尚未提交、推送或发布。下一位继续处理前先读 [内置资源维护流程](builtin-resource-maintenance.md) 和 [多音库与补充素材交接](handoff-multi-libraries.md)。

## 已完成

- 来源固定为 VCSL 提交 `dfcf4a4918771eee884b96ad4493de82ef84daf6`，许可为 CC0-1.0。
- 新集合：`samples/vcsl-harp-sax-20261108/`。
- 新增两个乐器定义：`instrument-vcsl-concert-harp`、`instrument-vcsl-tenor-saxophone`。
- 清单共 150 个映射和 150 个独立工作录音，转换后约 169 MiB PCM；目录清单 SHA-256 为 `811bd0879504aead63328359c590f37de921d57c59622d292b6b3f1e7478b91e`。
- Concert Harp 45 个区域，原 SFZ 使用 `xfin`／`xfout` 交叉淡化。当前引擎没有 SFZ 交叉淡化操作码，因此候选将其显式近似为力度 1–69 与 70–127 的硬切分，不能描述为完整复现作者交叉淡化。
- Tenor Saxophone 含非颤音、断奏、颤音三个演奏法，共 105 个区域。
- 44.1 kHz 原件转换为 48 kHz 双声道 PCM16；转换脚本使用确定性的线性插值，保留原件、原始哈希、映射哈希和转换增益记录。

## 候选包与验证

- 候选包目录：`E:/MomoSoundForge-vcsl-harp-sax-candidate-20261108`。
- 候选锁文件 SHA-256：`43d4fe81b73d2acbe2a3d10ba5eca7ed9e4f383b79aa80a97b8fcd21b34d3916`。
- 候选包包含旧锁文件的完整输入以及新增集合；候选 build 配置已在独立缓存 `E:/MomoSoundForge-vcsl-harp-sax-cache-20261108` 中恢复并通过校验。
- `npm test`：49 个文件、410 项通过。
- `npm run test:assets`：8 个文件、27 项通过。
- `npm run build`：TypeScript、生产构建和官方目录生成通过。
- `npm run audit:instruments`：236 个资源、1,706,880 个映射单元、268 个代表案例，0 选择失败、0 渲染失败、0 未映射内嵌实例。
- 主观听审尚未完成；技术通过不代表音色质量或交叉淡化听感已经验收。

## 当前限制与下一步

当前主仓库仍使用旧的 `sound-assets.lock.json`，所以新增 WAV 的 `originals/` 和 `wav/` 目录在工作区暂时存在但已加入 `.gitignore`；它们不能提交到 Git。候选锁里的 URL 还是空的本地候选状态，不能直接用于远程恢复。

## 独立官方音库发布记录

- 为避免原官方音库 Pages 接近 1 GiB 的体积上限，本批次发布到独立系列仓库 [MomoSoundForge-assets-vcsl-harp-sax](https://github.com/BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax)，没有向 `MomoSoundForge-assets` 写入音频或替换既有附件。
- 固定 Release：[2026.11.08-vcsl-harp-sax](https://github.com/BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax/releases/tag/2026.11.08-vcsl-harp-sax)。附件 `MomoSoundForge-vcsl-harp-sax-2026.11.08.zip` 为 149,993,113 字节，SHA-256 `f2d3cf73b3809c2f5813b3958b2aafc4dcbcdd003a71c57b7ccf8b3505ecdd6e`。
- Pages 已部署：[音库目录](https://breezymomo.github.io/MomoSoundForge-assets-vcsl-harp-sax/index.json)，`index.json` SHA-256 `9f5f9f2dbcfb73a2a111cebadb7ee293fe383028faadc7ede3531879f691c1ce`，CORS `Access-Control-Allow-Origin: *`。
- Pages CI：[成功运行 42490524828](https://github.com/BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax/actions/runs/42490524828)。
- 当前只完成远端目录、附件哈希和 Pages 传输验证；主应用的 Chrome 订阅、试听、保存后断开远端验收仍待执行。

正式接入需要在用户明确授权发布后：创建新的固定资源 Release、上传候选包、填写固定 HTTPS URL、用空缓存验证远程恢复，再更新主仓库锁文件和运行音库部署。未完成这些步骤前，不应把两套乐器称为线上已发布资源。
