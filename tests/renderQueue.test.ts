import { afterEach, expect, it, vi } from "vitest";
import { createRenderer } from "../src/audio";
import { makeProject, type RenderResult } from "../src/model";
import * as preparation from '../src/prepareSamples';
class WorkerStub {
  static instances: WorkerStub[] = [];
  messages: { id: number }[] = [];
  terminated = false;
  onmessage?: (e: { data: unknown }) => void;
  constructor() { WorkerStub.instances.push(this); }
  postMessage(message: { id: number }) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  finish(data: { result?: RenderResult; error?: string }) {
    this.onmessage?.({ data: { id: this.messages.at(-1)!.id, ...data } });
  }
}
const result = (): RenderResult => ({ left: new Float32Array(100), right: new Float32Array(100), inputs: {}, sampleRate: 100,
  peak: 0, rms: 0, sourcePeak: 0, gainReduction: 1 });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); WorkerStub.instances = []; });
it("cancels an obsolete preview while keeping a queued export runnable", async () => {
  vi.stubGlobal("Worker", WorkerStub);
  const renderer = createRenderer(), abort = new AbortController();
  const preview = renderer.render(makeProject("preview"), abort.signal);
  const rejected = expect(preview).rejects.toThrow("cancelled");
  const output = renderer.render({ ...makeProject("export"), duration: 120 });
  expect(WorkerStub.instances).toHaveLength(1);
  abort.abort(); await rejected;
  expect(WorkerStub.instances[0].terminated).toBe(true);
  expect(WorkerStub.instances).toHaveLength(2);
  const audio = result(); WorkerStub.instances[1].finish({ result: audio });
  expect(await output).toBe(audio);
  renderer.dispose();
});
it("reuses audio for renamed/video-only edits but preserves asset dictionary identities", async () => {
  vi.stubGlobal("Worker", WorkerStub);
  const renderer = createRenderer(), p = makeProject("first"), audio = result();
  const first = renderer.render(p); WorkerStub.instances[0].finish({ result: audio }); await first;
  expect(await renderer.render({ ...p, name: "second", videoReference: { name: "clip", size: 20, start: 0, end: 20, duration: 20, markers: [] } })).toBe(audio);
  expect(WorkerStub.instances[0].messages).toHaveLength(1);
  const changed = renderer.render({ ...p, assets: { name: { id: "name", name: "valid asset id", sampleRate: 8000, channels: ["AAAA"] } } });
  expect(WorkerStub.instances[0].messages).toHaveLength(2);
  WorkerStub.instances[0].finish({ error: "error.renderBudget" });
  await expect(changed).rejects.toThrow("error.renderBudget");
  renderer.dispose();
});

it('ignores recordings finishing after their preview was cancelled and keeps the next render active', async () => {
  vi.stubGlobal('Worker', WorkerStub);
  let finish!: (p: ReturnType<typeof makeProject>) => void;
  vi.spyOn(preparation, 'projectHasReferences').mockReturnValueOnce(true).mockReturnValue(false);
  vi.spyOn(preparation, 'prepareProjectSamples').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const renderer = createRenderer(), controller = new AbortController(), old = makeProject('old');
  const pending = renderer.render(old, controller.signal), rejected = expect(pending).rejects.toThrow('cancelled');
  expect(WorkerStub.instances[0].messages).toHaveLength(0);
  const next = renderer.render({ ...makeProject('new'), duration: 2 });
  controller.abort(); await rejected;
  finish(old); await Promise.resolve(); await Promise.resolve();
  expect(WorkerStub.instances[0].messages).toHaveLength(0);
  expect(WorkerStub.instances[1].messages).toHaveLength(1);
  const audio = result(); WorkerStub.instances[1].finish({ result: audio });
  expect(await next).toBe(audio); renderer.dispose();
});
