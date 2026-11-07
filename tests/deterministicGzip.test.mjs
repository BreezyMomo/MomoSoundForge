import {expect,it} from 'vitest';
import {gzipSync,gunzipSync} from 'node:zlib';
import {deterministicGzip} from '../tools/deterministic-gzip.mjs';
import {stableCalibrationGain} from '../tools/builtin-levels.mjs';

it('stabilizes observed Windows/Linux calibration differences below PCM precision',()=>{
  for(const [a,b] of [[1.3665745665334053,1.3665745665334055],[.8212398298373197,.8212398298373198],[.7268921928038309,.726892192803831],[.7095287608445461,.709528760844546],[1.3151339959476906,1.3151339959476909],[1.470516846873654,1.4705168468736538],[1.153373594360035,1.1533735943600347],[.7961593504173187,.7961593504173188]]){
    expect(stableCalibrationGain(a)).toBe(stableCalibrationGain(b));
    expect(Math.abs(stableCalibrationGain(a)-a)).toBeLessThan(1e-12);
  }
});

it('matches a fixed transport across operating systems without changing audio bytes',()=>{
  const pcm=Buffer.from(Array.from({length:10000},(_,i)=>(i*17)%256));
  for(const level of [6,9]){
    const expected=gzipSync(pcm,{level});expected[9]=3;
    const actual=deterministicGzip(pcm,{level});
    expect(actual).toEqual(expected);
    expect(gunzipSync(actual)).toEqual(pcm);
  }
});
