# 资源存储迁移交接

更新：2026-11-07。当前分支 `codex/asset-storage-review`，本轮基于 `bb22572`。用户已授权提交完整 VCSL 钢琴和本次存储迁移代码，本次提交一并收录；尚未推送。用户已明确授权创建公开资源仓库并发布，资源版本已发布；应用网站未部署、Git 历史未改写。

## 已实现的本地流程

- `tools/sound-asset-store.mjs`：清单校验、流式打包/恢复、缓存校验、逻辑路径解析。
- `tools/sound-assets.mjs`：`assets:pack`、`assets:sync`、`assets:verify`、`assets:status`。
- `sound-assets.lock.json`：14 个固定版本包，版本 `2026.11.07-1`，共 2,396 个逻辑文件；URL 已与 GitHub 发布后的实际附件地址核对，不使用 latest。
- 构建器与各音源生成器通过解析器读取缓存；声音 ID、来源记录和工程内的字段继续使用原来的逻辑名称。
- 构建指纹覆盖 src、tools、vendor、依赖锁、构建配置、资源锁和输入内容。缓存命中时再次检查目录、全部声音与授权文件的 SHA-256，不能只靠文件存在或修改时间。
- Python 来源审查接收经过校验的本地路径映射，报告继续使用逻辑来源路径；不把机器路径写回工程或清单。
- `npm test` 不再有全库构建前置步骤；Vitest 显式分为 unit、assets、provenance 三组，不根据文件存在与否跳过测试。
- Pages 工作流保留原有 main 发布条件，添加基于锁文件哈希的缓存、显式同步与完整音库测试。远端 Actions 尚未触发；推送代码仍需后续明确授权。

## 资源与容量

build：5 包，1,010 文件，压缩后 651,302,963 字节（约 621.1 MiB），还原后 1,262,802,674 字节。

audit：额外 8 包，1,384 文件，压缩后 1,111,979,952 字节。包括原始录音、历史工作副本和需要追溯的项目。`--profile audit` 同步 build + audit。

archive：额外 1 包，2 文件，压缩后 15,755,522 字节。`--profile archive` 同步全部三组。

本地包位于 `E:/MomoSoundForge-assets-20261107`，共 1,779,038,437 字节（约 1.66 GiB）。[公开版本](https://github.com/BreezyMomo/MomoSoundForge-assets/releases/tag/2026.11.07-1) 同时附带锁文件、SHA256SUMS、发布说明及 source-metadata.zip（原始来源、许可证、映射和采集说明）。代码、来源元数据、许可证与映射继续留在代码仓库。

公开地址空缓存恢复通过后，已将锁文件列出的 2,396 个大文件（3,353,938,275 字节）移到 `E:/MomoSoundForge-externalized-originals-20261107`，原备份仍完整保留。`.gitignore` 使用清单中的精确路径，其他新素材和元数据仍可见。本次提交移除这些输入的 Git 跟踪；未运行历史清理。去掉这些输入后，代码、元数据与少量示例约 25 MiB，准确数量见本地验证报告 `test-results/storage-migration/externalization.json`。这不是现有 Git 历史或整个开发目录的大小；依赖、缓存、生成网站也不包含在其中。

## 格式与故障处理

`.sfa.gz` 是简单的流式容器：gzip 包裹固定 magic、清单长度、规范 JSON 清单、按清单顺序连接的原始文件字节。不存在压缩包自行指定的路径、链接、权限或嵌套归档解包逻辑。解包前验证压缩包哈希；清单必须逐字节匹配锁文件；逐个校验文件大小与哈希，并限制压缩/解压字节数和文件数量。

解析器拒绝越界路径、重复及大小写冲突、Windows 保留名称、文件与父目录冲突。缓存路径逐级拒绝符号链接/目录联接。内部文件使用短编号，避免长 worktree 路径下 Windows 无法移动目录；用户看到的名称及逻辑来源路径不变。

缓存默认 `.cache/sound-assets/`；可用 `SOUNDFORGE_ASSET_CACHE` 指定独立缓存。已验证的包按完整 SHA-256 隔离。失败下载/解包清理临时文件，替换前完整校验，失败不覆盖旧目录。同步通过 `.sync-lock` 防止并发写入；进程硬中断后可能遗留此锁，确认没有同步进程后才移除它。构建、dev、普通测试均不自动联网下载资源。

## 开发命令

```sh
npm ci
npm test
npm run assets:sync
npm run test:assets
npm run build
node tools/check-static-site.mjs

# 需要来源审查时，再取额外资料
npm run assets:sync -- --profile audit
npm run test:provenance
```

无网络环境可在同步命令后增加 `--from E:/MomoSoundForge-assets-20261107`，走相同的哈希与预算校验。

`assets:pack -- --output DIRECTORY --version VERSION` 从经过 archive 配置校验的缓存及工作区新增/修改的源文件读取数据，输出候选锁文件到包目录，不上传、不直接覆盖代码仓库的锁文件。同名工作区源文件优先，未覆盖的旧文件继续从缓存读取；从零创建首份清单时使用工作区源资料。隔离副本中仅靠缓存重新打出的全部 14 个包，与原包 SHA-256 完全一致。

完整审查仍用 `audit:sources`，需要 Python 依赖 `tools/audio-audit-requirements.txt`，以及 archive 配置用于完整盘点。`test:provenance` 是来源回归测试，不等同于全量独立解码审查。

## 备份与验证证据

- 旧备份：`E:/MomoSoundForge-backup-20261107-assets`，含原 Git bundle 和多工作区对象备份，未动。
- 新补充备份：`E:/MomoSoundForge-backup-20261107-storage-baseline`，2,798 文件，3,378,975,866 字节；逐文件复制后核对 SHA-256。`baseline.json` 冻结目录及 1,142 个生成文件的 SHA-256。
- 真实远程恢复：从已发布的 HTTPS 地址匿名下载至全新 `E:/MomoSoundForge-remote-restore-20261107`，14 包、2,396 文件全部校验通过，不带登录凭据，也无本地包兜底；`remote-restore.json` 记录当前锁文件哈希。
- 移出原件后的最终验收：指定上述远程缓存，358 项 unit、16 项 assets、3 项 provenance 测试、构建与静态检查全部通过。生成目录和 `public`、`dist` 中全部 1,142 个声音文件均与冻结基线相同；2,396 个原件在工作区中均已不存在，外置原件全部再次校验通过。日志为 `test-results/storage-migration/final-*.log`，汇总为 `externalization.json`。
- 本次工作区构建已通过，目录与全部 1,142 个生成声音文件和冻结基线逐字节相同；静态网站检查通过，仍为 951.4 MiB。存储迁移没有减少运行网站体积。
- 通过缓存重新独立解码 2,269 个文件，检查 1,143 条来源映射，0 错误；报告 `test-results/storage-migration/sources.json`。
- 测试分组：unit 358、assets 16、provenance 3。普通测试使用小型真实夹具及合成输入；音库加载、尾音、音符和离线保存的断言被迁到完整资源组，没有删除。
- 隔离副本：`E:/MomoSoundForge-storage-clean-20261107`。使用新安装依赖，无原始 WAV/内嵌资源工程、无生成音库、无资源缓存时，普通测试已全部通过；此时 verify 明确报 5 个 build 包缺失。随后仅同步 build 包，完整构建、358 项普通测试、16 项资源测试、静态检查全部通过，目录及 1,142 个生成文件再次与备份逐字节相同。未同步 audit 时，verify 明确报 8 个 audit 包缺失，没有误用开发机原始文件。
- 隔离副本随后恢复 audit 包，3 项来源测试全部通过。当前工作区和隔离副本共用同一份发布候选锁文件；所有 377 项测试均有执行结果。
- 早期代码快照在补充备份的 `delivery-files/`，发布验收后的代码与验证证据另存于 `publication-delivery-files/`，各自附带文件哈希清单。早期 Windows 路径诊断使用的 `E:/MomoSoundForge-asset-cache` 是额外临时缓存；清理命令被自动审批以策略禁止拦截，未删除，不参与最终验证。
- 代码新增存储测试覆盖损坏重取、保持旧目录、目录联接、路径穿越/别名、清单篡改、解包预算、HTTPS 下载超限与镜像重试。
- 浏览器回归补验：隔离构建完成独立录音试听、完整钢琴选用、6 秒音符编辑、保存工程/重新打开、导出 WAV、导出资源/重新导入/试听。保存的工程和资源均在禁用网络 fetch 的 CLI 环境中再渲染，与浏览器 WAV 的 SHA-256 同为 `59c6ce4248f266aa09798515a027f8359a407cd459d553b8d27516886ad916c2`。证据在 `test-results/storage-migration/browser-*`、`*-network-blocked.wav`；浏览器出现过扩展消息通道关闭日志，未出现音源解析或渲染失败。

## 发布状态与后续权限

用户已授权并完成：创建公开资源仓库 `BreezyMomo/MomoSoundForge-assets`，发布版本 `2026.11.07-1` 的资源附件、来源元数据及锁文件/说明。新资源仓库 Git 只包含说明文件，没有大型音频。

空缓存真实 URL 恢复通过后，已按锁文件精确名单移出并保留全部原件。用户随后单独授权了主代码提交；推送尚未授权或执行，Git 历史重建仍需另行决定。

Git 历史重建、强推、删除远端分支仍是单独步骤，未执行。后续其他乐器整套替换仍按声音内容变更处理，不能混入本次“声音不变”的存储迁移基线。
