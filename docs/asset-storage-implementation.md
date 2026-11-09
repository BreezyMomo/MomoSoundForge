# 资源外置交接

主工程已经完成“框架与音库分离”：代码仓库只保留编辑器、声音协议、工程格式和远程加载校验；音频、资源图、来源与许可由独立音库仓库维护。

当前音库：

- `BreezyMomo/MomoSoundForge-assets`：官方音库。
- `BreezyMomo/MomoSoundForge-assets-vcsl-harp-sax`：VCSL Harp and Tenor Saxophone 补充音库。

运行目录使用 `momo.remote-sound-library/v1`，入口为 `index.json`。每个音库自描述完整资源闭包，主工程不保存 manifest 副本、映射副本、资源锁、`samples/` 或生成音频。

开发验证：

```sh
npm test
npm run build
```

资源仓库发布后，先用公网地址验证目录和音频哈希、CORS、坏目录拒绝、空缓存恢复，再更新主站目录配置。不要在主仓库恢复或生成本地音库，不要使用 `latest` 覆盖已发布目录，也不要自动提交、推送或发布。
