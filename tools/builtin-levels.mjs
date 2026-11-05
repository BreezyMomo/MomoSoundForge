// Restore the author's balance as a baseline before setting standalone defaults.
// This baseline is shared across pitches/articulations; multisample banks never
// receive per-take loudness normalization.
export function standaloneBoostDb(measured) {
  if (measured.peakDb === null || measured.activeRmsDb === null) throw Error('Silent standalone source');
  // A usable default, not just a non-silence gate. Keep 6 dB peak headroom at
  // velocity 100, including enough room for the user to raise velocity to 127.
  return Math.max(0, Math.min(-20 - measured.activeRmsDb, -6 - measured.peakDb));
}

export function legacyInstrumentLevels(samples) {
  const result = new Map();
  for (const group of Map.groupBy(samples, s => s.instrumentId).values()) {
    const authorDb = s => Number(s.conversion?.suggestedAuthorRegionVolumeDb ?? s.sourceEffectiveOpcodes?.volume ?? 0);
    if (group.some(s => !Number.isFinite(authorDb(s)) || !(s.peak > 0 && s.peak <= 1)))
      throw Error(`Invalid instrument levels: ${group[0].instrumentId}`);
    const peak = Math.max(...group.map(s => s.peak * 10 ** (authorDb(s) / 20)));
    // Leave headroom at velocity 127; the default note at 100 remains softer.
    const calibrationDb = 20 * Math.log10(.65 / (1.3 * peak));
    // Region gain is limited to +24 dB. Store only the shared excess in the
    // generated float assets; the versioned source WAVs remain untouched.
    const assetGainDb = Math.max(0, ...group.map(s => authorDb(s) + calibrationDb - 24));
    for (const s of group) {
      const regionGainDb = authorDb(s) + calibrationDb - assetGainDb;
      if (s.peak * 10 ** (assetGainDb / 20) > 1 || regionGainDb < -60 || regionGainDb > 24.000001)
        throw Error(`Calibration exceeds project limits: ${s.id}`);
      result.set(s.id, { authorGainDb: authorDb(s), calibrationDb, assetGainDb, regionGainDb: Math.min(24, regionGainDb) });
    }
  }
  return result;
}
