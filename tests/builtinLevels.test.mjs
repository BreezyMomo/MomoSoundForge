import { expect, it } from 'vitest';
import { legacyInstrumentLevels, standaloneBoostDb } from '../tools/builtin-levels.mjs';
import { levels } from '../tools/audit-builtin-library.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseProject } from '../src/model';
import { renderProject } from '../src/engine';


it('restores authored balance, keeps dynamics and leaves headroom without changing the input', () => {
  const samples = [
    { id: 'soft', instrumentId: 'drum', peak: .001220703125, sourceEffectiveOpcodes: { volume: '27' } },
    { id: 'loud', instrumentId: 'drum', peak: .084625244140625, sourceEffectiveOpcodes: { volume: '10' } },
  ];
  const original = structuredClone(samples), result = legacyInstrumentLevels(samples);
  const output = s => {
    const gain = result.get(s.id);
    expect(gain.regionGainDb).toBeLessThanOrEqual(24);
    expect(s.peak * 10 ** (gain.assetGainDb / 20)).toBeLessThan(1);
    return s.peak * 10 ** ((gain.assetGainDb + gain.regionGainDb) / 20) * 1.3;
  };
  expect(output(samples[1])).toBeCloseTo(.65, 6);
  expect(output(samples[0])).toBeGreaterThan(.05);
  expect(output(samples[0]) / output(samples[1])).toBeCloseTo(
    samples[0].peak / samples[1].peak * 10 ** (17 / 20), 6);
  expect(result.get('soft').assetGainDb).toBe(result.get('loud').assetGainDb);
  expect(samples).toEqual(original);
});


it('rejects invalid or silent sources instead of amplifying them blindly', () => {
  for (const peak of [0, NaN, Infinity, 1.5]) expect(() => legacyInstrumentLevels([
    { id: 'bad', instrumentId: 'bad', peak },
  ])).toThrow();
});


it('raises standalone default audibility, while limiting transients and leaving loud sounds alone', () => {
  expect(standaloneBoostDb({ peakDb: -25.64, activeRmsDb: -33.85 })).toBeCloseTo(13.85);
  expect(standaloneBoostDb({ peakDb: -8, activeRmsDb: -35 })).toBe(2);
  expect(standaloneBoostDb({ peakDb: -4, activeRmsDb: -16 })).toBe(0);
  expect(() => standaloneBoostDb({ peakDb: null, activeRmsDb: null })).toThrow();
});


it('audits both channels and distinguishes silent and quiet audio from long tails', () => {
  const signal = new Float32Array(80000);
  signal.fill(.1, 0, 800);
  expect(levels([new Float32Array(80000), signal], 8000).status).toBe('ok');
  expect(levels([new Float32Array(100)], 8000).status).toBe('silent');
  expect(levels([new Float32Array(100).fill(.001)], 8000).status).toBe('quiet');
  expect(() => levels([new Float32Array([NaN])], 8000)).toThrow();
});
