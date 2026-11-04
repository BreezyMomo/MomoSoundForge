# Third-party audio encoder

Audio encoding runs locally using the unmodified packages pinned in package-lock.json:

- @ffmpeg/ffmpeg 0.12.15: MIT; https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.15
- @ffmpeg/core 0.12.10: GPL-2.0-or-later; https://github.com/ffmpegwasm/ffmpeg.wasm/tree/core%40v0.12.10

The core includes FFmpeg and enabled codec libraries (including LAME, libogg,
libvorbis and FLAC support). Build recipes, upstream source versions and component
licenses are maintained in the upstream source tree. The WebAssembly binary is
loaded on demand from the application's own assets. No audio is sent to a server.

Redistribution of the bundled encoder must comply with its GPL and included
component licenses, including supplying corresponding source and build scripts.
The npm binary alone does not replace the corresponding-source requirement.
