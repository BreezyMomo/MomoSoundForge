import { parseProject, projectForSave, varyProject, type Project } from './model';
import { DEFAULT_EXPORT, EXPORT_FORMATS, type ExportSettings } from './exportAudio';

export function generateVariants(project: Project, options: { count?: number; amount?: number; seed?: number } = {}): Project[] {
  const { count = 5, amount = 0.35, seed = project.seed } = options;
  if (!Number.isInteger(count) || count < 1 || count > 5 || !Number.isFinite(amount) || amount < 0 || amount > 1 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
    Object.keys(options).some(k => !['count', 'amount', 'seed'].includes(k))) throw Error('ai.invalidEdit');
  return Array.from({ length: count }, (_, i) => {
    const next = varyProject(project, (seed + 1 + i * 7919) >>> 0, amount);
    next.name = `${project.name.slice(0, 110)} ${String(i + 1).padStart(2, '0')}`;
    return parseProject(projectForSave(next));
  });
}
export function strictExportSettings(raw: unknown = {}, base: ExportSettings = DEFAULT_EXPORT): ExportSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !Object.hasOwn(DEFAULT_EXPORT, k))) throw Error('ai.invalidExport');
  const s = { ...base, ...raw } as ExportSettings;
  if (!EXPORT_FORMATS.includes(s.format) || ![22050, 44100, 48000].includes(s.sampleRate) ||
    ['mono', 'normalize', 'trimSilence', 'loopOnly'].some(k => typeof s[k as keyof ExportSettings] !== 'boolean') ||
    !Number.isFinite(s.targetRms) || s.targetRms < -36 || s.targetRms > -6 ||
    !Number.isFinite(s.tail) || s.tail < 0 || s.tail > 2 || typeof s.prefix !== 'string' || s.prefix.length > 80) throw Error('ai.invalidExport');
  return s;
}

export const EXPORT_SCHEMA = {
  defaults: DEFAULT_EXPORT, formats: EXPORT_FORMATS, sampleRates: [22050, 44100, 48000],
  mono: 'boolean', normalize: 'boolean', targetRms: [-36, -6], trimSilence: 'boolean', tail: [0, 2], loopOnly: 'boolean', prefix: 'string, at most 80 characters',
  behavior: 'Omitted settings use the editor export preferences, without changing them. Loop-only requires an existing loop region; tail and trimSilence are ignored for loops, exactly as in the export panel.',
};
