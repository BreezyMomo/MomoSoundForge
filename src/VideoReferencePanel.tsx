import { useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  Checkbox,
  FieldGroup,
  Field,
  FieldLabel,
  WorkbenchNumberInput,
  WorkbenchSlider,
} from "@momo/workbench/react";
import { t } from "./i18n";
import { uid } from "./model";
import {
  frameIndex,
  indexVideo,
  stepFrame,
  type VideoReference,
} from "./videoReference";
import "./video-reference.css";
export function VideoReferencePanel({
  reference,
  cue,
  playing,
  ready,
  loop,
  onLoop,
  onChange,
  onSeek,
  onToggle,
  onStop,
}: {
  reference?: VideoReference;
  cue: number;
  playing: boolean;
  ready: boolean;
  loop: boolean;
  onLoop: (value: boolean) => void;
  onChange: (r?: VideoReference) => void;
  onSeek: (time: number) => void;
  onToggle: () => void;
  onStop: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<{
    url: string;
    name: string;
    size: number;
  }>();
  const [frames, setFrames] = useState<number[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [volume, setVolume] = useState(0),
    [marker, setMarker] = useState("");
  const job = useRef<AbortController | null>(null);
  const latestReference = useRef(reference);
  latestReference.current = reference;
  const linked =
    !!reference &&
    source?.name === reference.name &&
    source?.size === reference.size;
  const active = linked && reference && cue < reference.end - reference.start;
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.url);
    },
    [source],
  );
  useEffect(() => () => job.current?.abort(), []);
  useEffect(() => {
    const v = video.current;
    if (!v || !linked || !reference) return;
    const time = Math.min(reference.end, reference.start + cue);
    v.volume = volume;
    v.muted = volume === 0;
    if (!playing || !active) {
      v.pause();
      if (Math.abs(v.currentTime - time) > 0.001)
        v.currentTime = Math.min(reference.duration, time + 0.00001);
    } else {
      if (Math.abs(v.currentTime - time) > 0.08)
        v.currentTime = Math.min(reference.duration, time + 0.00001);
      if (v.paused)
        void v.play().catch((error) => {
          if (error?.name !== "AbortError") {
            setError("video.playFailed");
            onStop();
          }
        });
    }
  }, [cue, playing, linked, reference, volume, active]);
  useEffect(() => {
    if (!linked) video.current?.pause();
  }, [linked]);
  async function load(file?: File) {
    if (!file) return;
    onStop();
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    setError("");
    setBusy(true);
    setFrames([]);
    let url = "";
    try {
      if (!file.size || file.size > 80 * 1024 * 1024)
        throw Error("video.limit");
      url = URL.createObjectURL(file);
      const probe = document.createElement("video");
      probe.preload = "metadata";
      const duration = await new Promise<number>((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          probe.removeAttribute("src");
          probe.load();
        };
        const timer = setTimeout(() => {
          finish();
          reject(Error("video.failed"));
        }, 15000);
        probe.onloadedmetadata = () => {
          const d = probe.duration;
          const pixels = probe.videoWidth * probe.videoHeight;
          finish();
          if (!Number.isFinite(d) || d < 0.01 || pixels > 3840 * 2160)
            reject(Error("video.limit"));
          else resolve(d);
        };
        probe.onerror = () => {
          finish();
          reject(Error("video.failed"));
        };
        probe.src = url;
      });
      const times = await indexVideo(file, controller.signal);
      if (controller.signal.aborted || latestReference.current !== reference)
        return;
      setSource({ url, name: file.name, size: file.size });
      url = "";
      setFrames(times);
      if (
        !reference ||
        reference.name !== file.name ||
        reference.size !== file.size ||
        Math.abs(reference.duration - duration) > 0.01
      )
        onChange({
          name: file.name,
          size: file.size,
          duration,
          start: 0,
          end: duration,
          markers: [],
        });
      onSeek(0);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error && e.message === "video.limit"
            ? "video.limit"
            : "video.failed",
        );
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (job.current === controller) setBusy(false);
    }
  }
  const seek = (time: number) => {
    onStop();
    onSeek(Math.max(0, Math.min(reference!.end - reference!.start, time)));
  };
  return (
    <section className="video-reference" aria-label={t("video.title")}>
      <div className="video-actions">
        <Button
          variant="outline"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          {t(reference ? "video.relink" : "video.import")}
        </Button>
        {busy && (
          <Button
            variant="outline"
            onClick={() => {
              job.current?.abort();
              setBusy(false);
            }}
          >
            {t("video.cancel")}
          </Button>
        )}
        {reference && (
          <Button
            variant="outline"
            onClick={() => {
              onStop();
              job.current?.abort();
              setSource(undefined);
              setFrames([]);
              onChange(undefined);
            }}
          >
            {t("video.remove")}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            void load(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p role="alert">{t(error)}</p>}
      {busy && <p role="status">{t("video.indexing")}</p>}
      {!reference && <p className="field-help">{t("video.empty")}</p>}
      {reference && (
        <>
          <p className="video-name">{reference.name}</p>
          {linked ? (
            <video
              ref={video}
              src={source!.url}
              playsInline
              preload="auto"
              onError={() => setError("video.failed")}
              onLoadedData={() => {
                if (video.current)
                  video.current.currentTime = reference.start + cue;
              }}
            />
          ) : (
            <p>{t("video.missing")}</p>
          )}
          <div className="video-actions">
            <Button
              variant="outline"
              disabled={!linked || !frames.length || busy}
              onClick={() =>
                seek(
                  stepFrame(frames, reference.start + cue, -1) -
                    reference.start,
                )
              }
            >
              {t("video.previous")}
            </Button>
            <Button disabled={!ready || !linked || busy} onClick={onToggle}>
              {t(playing ? "video.pause" : "video.play")}
            </Button>
            <Button
              variant="outline"
              disabled={!linked || !frames.length || busy}
              onClick={() =>
                seek(
                  stepFrame(frames, reference.start + cue, 1) - reference.start,
                )
              }
            >
              {t("video.next")}
            </Button>
          </div>
          <Field orientation="horizontal">
            <Checkbox id="video-loop" checked={loop} onCheckedChange={onLoop} />
            <FieldLabel htmlFor="video-loop">{t("video.loop")}</FieldLabel>
          </Field>
          <p className="video-position">
            {t(
              "video.position",
              cue.toFixed(3),
              (reference.start + cue).toFixed(3),
              linked && frames.length
                ? frameIndex(frames, reference.start + cue) + 1
                : "—",
            )}
          </p>
          <WorkbenchSlider
            label={t("video.seek")}
            min={0}
            max={reference.end - reference.start}
            step={0.001}
            value={Math.min(cue, reference.end - reference.start)}
            onValueChange={seek}
          />
          <FieldGroup className="sound-video-grid">
            <Field>
              <FieldLabel htmlFor="video-start">{t("video.start")}</FieldLabel>
              <WorkbenchNumberInput
                id="video-start"
                label={t("video.start")}
                min={0}
                max={reference.duration - 0.01}
                step={0.001}
                value={reference.start}
                onValueCommit={(start) => {
                  onStop();
                  onChange({
                    ...reference,
                    start,
                    end: Math.min(
                      reference.duration,
                      start + reference.end - reference.start,
                    ),
                  });
                  onSeek(0);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="video-length">
                {t("video.length")}
              </FieldLabel>
              <WorkbenchNumberInput
                id="video-length"
                label={t("video.length")}
                min={0.01}
                max={reference.duration - reference.start}
                step={0.001}
                value={Number((reference.end - reference.start).toFixed(3))}
                onValueCommit={(length) => {
                  onStop();
                  onChange({ ...reference, end: reference.start + length });
                  onSeek(0);
                }}
              />
            </Field>
            <Field>
              <FieldLabel>{t("video.volume")}</FieldLabel>
              <WorkbenchSlider
                label={t("video.volume")}
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onValueChange={setVolume}
              />
            </Field>
          </FieldGroup>
          <p className="field-help">{t("video.mapping")}</p>
          <div className="video-actions">
            <Input
              className="sound-video-marker"
              aria-label={t("video.markerName")}
              placeholder={t("video.markerName")}
              maxLength={80}
              value={marker}
              onChange={(e) => setMarker(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={
                !marker.trim() ||
                reference.markers.length >= 64 ||
                cue > reference.end - reference.start
              }
              onClick={() => {
                onChange({
                  ...reference,
                  markers: [
                    ...reference.markers,
                    { id: uid(), name: marker.trim(), time: cue },
                  ],
                });
                setMarker("");
              }}
            >
              {t("video.addMarker")}
            </Button>
          </div>
          <ul className="video-markers">
            {reference.markers.map((m) => (
              <li key={m.id}>
                <Button variant="ghost" onClick={() => seek(m.time)}>
                  {m.time.toFixed(3)} s · {m.name}
                </Button>
                <Button
                  variant="ghost"
                  aria-label={t("video.deleteMarker", m.name)}
                  onClick={() =>
                    onChange({
                      ...reference,
                      markers: reference.markers.filter((x) => x.id !== m.id),
                    })
                  }
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
