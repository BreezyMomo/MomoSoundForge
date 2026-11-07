# 使用 GitHub 免费分发网站和音库

用户于 2026-11-07 确认继续使用 GitHub，不新增付费存储服务。这里是选定方案的操作交接；**尚未提交、推送、配置资源 Pages 或切换线上**。

## 两个仓库的职责

- `BreezyMomo/MomoSoundForge`：代码及目录；Pages 发布编辑器，配置外置后约 35 MiB。
- `BreezyMomo/MomoSoundForge-assets`：Git 只放说明和工作流；Releases 保留已有原件／构建输入包；另用 Pages 发布当前版本的播放文件，优化后约 696.8 MiB（含清单）。

目标音库地址为 `https://breezymomo.github.io/MomoSoundForge-assets/`，目前只是计划地址，尚未验证存在。两个项目站位于同一 origin 下，编辑器可直接读取音库；本地开发或其他域名仍需检查 CORS。

大文件通过 Actions 构建产物上传 Pages，不推回任一仓库的 Git，不创建装满音频的 `gh-pages` 分支，不把 Releases 下载链接当成浏览器音库。

## 这轮缩减了什么

此前部分乐器音区内嵌录音前 4 秒，同时库里又保存相同录音的完整 WAV。本次 74 个音区改为引用已有完整录音，不再重复存放 PCM，减少 230,477,071 字节（约 219.8 MiB）。

`SampleReference.frameLimit` 表示这个播放器可用的片段帧数；`frames` 仍表示被引用文件的完整帧数，用于校验。未指定 limit 时使用完整文件。构建器在替换前逐帧确认两声道 Float32 PCM 一致，保留原有名称、映射、增益、尾音与片段边界。这个字段服务当前片段语义，不是旧工程兼容机制。

868 份独立录音的文件与目录完全未变；未降低采样率、删力度档、删演奏法或改声道。74 个音区在默认及力度 1、127 下的 WAV 比较均一致；全部 274 份内容的卡片波形和时长未变。当前目录哈希与验证记录见本地 `test-results/github-audio/`。

范围说明：本轮只去除内置音区的重复 PCM。`InstrumentDefinition` 仍包含 `instrument` 绑定表和 `assets` 依赖字典；绑定的 `assetId` 指向文件内的资产条目，条目可内嵌 PCM 或保存公共录音引用，不是全局资源库的实时链接。个人资源库并未在本轮改成纯引用存储；不要向用户声称所有音源现在都只保存一份。

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

代码修改未改变资源文件时，不必重发音库。音源发生变化时，先发布并验证对应音库，再推进网站目录。当前尚未发布，不要求兼容旧个人工程；仍要避免在切换过程中删除当前正式网站正在用的文件。需要无中断更新时应在两站切换期间临时保留所需文件，并计入同一个 1 GB 预算；容量不足时安排明确的维护窗口，不用拆很多仓库规避限制。

原始素材变化仍按 [内置资源维护流程](builtin-resource-maintenance.md) 更新输入 Release 和锁文件；这次只调整生成文件的存储方式，没有修改源 WAV 或输入包，不需要新发输入 Release。

GitHub Pages 每个发布站点最多 1 GB、每月 100 GB 软流量限制；公开项目站可以免费使用，但不是无限容量的 CDN。以后扩库仍先检查体积和实际需求。官方文档：[Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)、[自定义发布工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 本地验收记录

- 普通测试 45 个文件、376 项通过；完整音库测试 6 个文件、16 项通过；TypeScript、同源构建和静态检查通过。
- 独立站构建约 35.1 MiB，音库含清单共 730,608,028 字节；上传候选 1,149 个音频与授权文件全部校验通过。
- 74 个受影响音区共 222 次默认／极轻／极重力度的前后 WAV 比较通过；比较报告 `test-results/github-audio/comparison.json`。
- 两个本地端口模拟跨域服务，全库远端大小、SHA-256 与 CORS 检查通过。浏览器和 AI CLI 验证共享长笛录音、原有 4 秒片段边界及保存后离线重开，WAV 哈希均为 `25fe7c0b33b09f1947d0dd09ea1cb3db6cf6049eb47d73cf291dbb0f221ecb75`；完整钢琴同样通过。
- 资源工作流已解析检查 YAML，但还未复制进资源仓库或在 GitHub 执行。线上 Pages、网络地区表现和主观音色听审仍未验收。
