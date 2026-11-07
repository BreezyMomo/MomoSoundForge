# 使用 GitHub 免费分发网站和音库

用户于 2026-11-07 确认继续使用 GitHub，并明确授权完成音库部署、合并主干、主站上线和使用流程验证。**音库和主站均已上线；部署提交 `3430ad6c9fcf6421e3a68114ca85f5551715955c` 已合入并推送 `main`，正式站浏览器验收通过。** 当前验收记录见文末；旧候选目录不能作为发布输入。

## 两个仓库的职责

- `BreezyMomo/MomoSoundForge`：代码及目录；Pages 发布编辑器，当前外置构建约 36.5 MiB。
- `BreezyMomo/MomoSoundForge-assets`：Git 只放说明和工作流；Releases 保留已有原件／构建输入包；另用 Pages 发布当前版本的播放文件，当前约 614.6 MiB（含清单）。

音库地址为 `https://breezymomo.github.io/MomoSoundForge-assets/`，入口是 [manifest.json](https://breezymomo.github.io/MomoSoundForge-assets/manifest.json)，无需在根目录展示网页。两个项目站位于同一 origin 下；本地预览跨域读取也已验证。主仓库 Actions variable `SOUND_LIBRARY_URL` 已设为此地址。

大文件通过 Actions 构建产物上传 Pages，不推回任一仓库的 Git，不创建装满音频的 `gh-pages` 分支，不把 Releases 下载链接当成浏览器音库。

## 历史缩减与当前架构

此前部分乐器音区内嵌录音前 4 秒，同时库里又保存相同录音的完整 WAV。本次 74 个音区改为引用已有完整录音，不再重复存放 PCM，减少 230,477,071 字节（约 219.8 MiB）。

`SampleReference.frameLimit` 表示这个播放器可用的片段帧数；`frames` 仍表示被引用文件的完整帧数，用于校验。未指定 limit 时使用完整文件。构建器在替换前逐帧确认两声道 Float32 PCM 一致，保留原有名称、映射、增益、尾音与片段边界。这个字段服务当前片段语义，不是旧工程兼容机制。

868 份独立录音的文件与目录完全未变；未降低采样率、删力度档、删演奏法或改声道。74 个音区在默认及力度 1、127 下的 WAV 比较均一致；全部 274 份内容的卡片波形和时长未变。当前目录哈希与验证记录见本地 `test-results/github-audio/`。

以上为第一阶段去重记录。之后已完成 [不可变共享资源改造](immutable-resource-architecture.md)：持久化定义和音频使用内容 ID，个人文件夹采用共享对象，工程／资源分享包含完整依赖。工作副本的局部 `assetId` 与内容 ID 职责不同。此次发布同时包含新格式和内置资源转换，不支持旧个人工程。

## 首次部署顺序

1. 审查并在获得授权后提交当前主仓库改动，先推送开发分支，取得完整 40 位提交 SHA。此时不要先把外置配置推上线。
2. 将 [音库工作流模板](../deployment/github-audio-pages.yml) 放到资源仓库的 `.github/workflows/pages.yml`，按授权提交／推送。模板限定只能在资源仓库运行，不会因普通 push 自动发布。
3. 在资源仓库 Settings → Pages 中选择 GitHub Actions，设置 `github-pages` 环境只允许 `main` 发布。
4. 手动运行音库工作流：`app_commit` 填步骤 1 的完整 SHA，第一次保持 `publish=false`。它检出精确代码、恢复输入包、运行测试、要求生成目录与提交一致、导出音库、校验所有文件及 1 GB 预算，最后保留一天的候选产物。
5. 候选成功后，在发布授权范围内，以相同 SHA、`publish=true` 从资源仓库 `main` 运行，发布音库 Pages。工作流不需要跨仓库写权限或额外长期 token；只读公开主仓库，Pages/OIDC 写权限仅给部署任务。
6. 正式音库可读取后，使用目标地址构建主站，并执行真实远端校验：

   ```powershell
   $env:VITE_SOUND_LIBRARY_URL = 'https://breezymomo.github.io/MomoSoundForge-assets/'
   try {
     npm run build
     node tools/check-static-site.mjs --origin https://breezymomo.github.io
   } finally { Remove-Item Env:VITE_SOUND_LIBRARY_URL }
   ```

   还需真实浏览器检查录音、音区、钢琴、保存重开和导出。不能把本地双服务测试说成 GitHub 线上已经通过。
7. 将主仓库 Actions variable `SOUND_LIBRARY_URL` 设置为上述音库 URL，再按授权合入／推送 `main`。主站工作流会验证远端文件后部署小网站。不要在主站流程里使用 `--local-resources` 跳过真实地址检查。

`library:stage` 只写全新的输出目录。`library:check -- --directory <目录>` 会检查清单与当前源码目录一致、所有文件字节及哈希、无多余文件或链接、总体积低于 1,000,000,000 字节。音库与网站各有独立的体积检查，不能扩大阈值来掩盖超限。

## 后续维护

跨平台构建必须保持目录一致：生成的 gzip 统一 OS 头字段，自动音量校准系数固定到小数点后 12 位。否则 Windows／Linux 的 gzip 元数据、数学函数最后一位差异会改变传输哈希或内容 ID。不得通过删除 CI 的目录一致性检查来绕过问题；修改压缩或校准规则后重新生成目录，并检查渲染结果。

代码修改未改变资源文件时，不必重发音库。音源发生变化时，先发布并验证对应音库，再推进网站目录。产品仍在开发期，不要求兼容旧个人工程；仍要避免在切换过程中删除当前正式网站正在用的文件。需要无中断更新时应在两站切换期间临时保留所需文件，并计入同一个 1 GB 预算；容量不足时安排明确的维护窗口，不用拆很多仓库规避限制。

原始素材变化仍按 [内置资源维护流程](builtin-resource-maintenance.md) 更新输入 Release 和锁文件；这次只调整生成文件的存储方式，没有修改源 WAV 或输入包，不需要新发输入 Release。

GitHub Pages 每个发布站点最多 1 GB、每月 100 GB 软流量限制；公开项目站可以免费使用，但不是无限容量的 CDN。以后扩库仍先检查体积和实际需求。官方文档：[Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)、[自定义发布工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 历史本地验收记录（外置分发初版）

- 普通测试 45 个文件、376 项通过；完整音库测试 6 个文件、16 项通过；TypeScript、同源构建和静态检查通过。
- 独立站构建约 35.1 MiB，音库含清单共 730,608,028 字节；上传候选 1,149 个音频与授权文件全部校验通过。
- 74 个受影响音区共 222 次默认／极轻／极重力度的前后 WAV 比较通过；比较报告 `test-results/github-audio/comparison.json`。
- 两个本地端口模拟跨域服务，全库远端大小、SHA-256 与 CORS 检查通过。浏览器和 AI CLI 验证共享长笛录音、原有 4 秒片段边界及保存后离线重开，WAV 哈希均为 `25fe7c0b33b09f1947d0dd09ea1cb3db6cf6049eb47d73cf291dbb0f221ecb75`；完整钢琴同样通过。
- 此阶段只验证过本地候选，不能用来替代下面的正式发布记录。

## 2026-11-07 正式发布与验收

- 应用代码：`ecb0d9145eb540d5f4389c648a573add27cf2430`；主站工作流修复 `3430ad6c9fcf6421e3a68114ca85f5551715955c`；资源仓库工作流 `d63a520`、操作说明 `0a61ea2`。
- 原件／构建输入 Release 与 `sound-assets.lock.json` 未改变，继续使用固定版本 `2026.11.07-1`；此次只发布生成的运行音库，没有把音频提交到两个仓库的 Git 历史。
- [音库发布任务](https://github.com/BreezyMomo/MomoSoundForge-assets/actions/runs/42362250412) 已成功。它重新恢复固定输入、通过测试和目录一致性检查后上传 Pages，发布环境仅允许资源仓库 `main`。
- [主站发布任务](https://github.com/BreezyMomo/MomoSoundForge/actions/runs/42363882867) 构建与部署均成功。正式入口：[MomoSoundForge](https://breezymomo.github.io/MomoSoundForge/)。
- 音库含清单共 644,404,586 字节，1,314 个音频／许可文件；目录 SHA-256 为 `755ad39c9c5aab05313b80b73f1c2c626422c01dc3f620ec09f0527c8ca098e9`。公开清单已一致，本机实际下载全部文件校验大小、SHA-256 和 CORS 通过。
- 常规测试 47 文件、383 项；资源测试 6 文件、16 项；生产构建通过。274 个默认声音加 74 个音区的两个力度，共 422 次 WAV 对比与改造前一致。
- 首次候选被跨平台目录检查拦截（[任务记录](https://github.com/BreezyMomo/MomoSoundForge-assets/actions/runs/42361018070)）：gzip OS 头不同，另有 8 个校准系数相差一个 double 最末位。修复已保留测试，未放松目录／文件校验。
- 首次主站发布被严格 origin 校验拦截：GitHub 保留账号名大小写，生成了 `https://BreezyMomo.github.io`。工作流现在将 origin 转成小写后校验（`3430ad6`），未跳过真实远端检查。
- 新浏览器 origin 的生产构建实际从 GitHub 音库读取长笛录音，创建三个音符绑定；包内仅两份音频。浏览器导出的 WAV 与工程离线渲染完全一致（SHA-256 `eb8087c8af2dab44149574f085bb26ddcd7f3759914e294caf298eda8faeda8b`）。
- 禁用音库服务的独立生产编辑器打开分享工程后，新增此前未演奏的 C5、试听并再次保存成功；该站没有请求音库文件。导入未创建个人库条目。
- 从公开音库收集完整钢琴得到 182,582,740 字节工程包、222 份独立音频。独立离线进程新增 C8／力度 115 和 A0／力度 30 均成功发声；禁用音库服务的生产浏览器也成功打开完整钢琴、新增并试听 C8，刷新后恢复草稿保留该音符。

- 正式网址返回外置分发描述，音库前缀为上文 GitHub Pages 地址；页面 JS／CSS 与验收的生产构建一致。正式浏览器重开自建录音乐器工程、试听、再次保存和导出 WAV 成功；再次保存的工程离线渲染与网页 WAV 逐字节一致。截图 `test-results/github-official-site.png`，报告 `test-results/github-official-export.json`、`test-results/github-official-resave.json`。

本机验证日志、报告及截图在 `test-results/github-*`、`test-results/deployment-*`；不提交这些下载包或生成音频。以上是可用性、完整性和声音一致性验收，不代表其他乐器已完成主观音质审查或整套替换。
