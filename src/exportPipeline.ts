import type { Project, RenderResult } from './model';
import { prepareExport, type ExportSettings } from './exportAudio';

// Shared by the export panel and AI. Codec encoding follows this same prepared audio.
export async function renderExport(project: Project, settings: ExportSettings, render: (project: Project) => Promise<RenderResult>) {
  const input = await render(settings.loopOnly ? project : { ...project, duration: project.duration + settings.tail });
  return prepareExport(input, { ...settings, loopOnly: settings.loopOnly && !!project.loopRegion }, project.loopRegion);
}
