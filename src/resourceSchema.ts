import { BASIC_SYNTH } from './synthesizers';
export const RESOURCE_SCHEMA = {
  schema:'momo.sound-resource/v1',
  fields:{id:'stable resource ID (letters, digits and hyphens, <=120)',version:'positive integer',name:'resource name, <=120',
    kind:'recording | synth | instrument | sound',category:'category name or known category key',description:'<=2000 characters',preview:'<=160 waveform values in [-1,1]',payload:'complete portable definition or native project'},
  recording:{schema:'momo.recording/v1',asset:'one portable SampleAsset',rootMidi:'0..127 for original pitch; null keeps original speed',tuneCents:0,gainDb:0,releaseSeconds:0.15,loop:'optional verified source-frame loop'},
  synth:{...BASIC_SYNTH,algorithm:'expression-v1',program:{expression:'sin(2*pi*phase + amount*sin(4*pi*phase))',parameters:[{variable:'amount',name:'Brightness',min:0,max:2,step:0.01,default:0.5}]}},
  expression:{variables:['t','phase','frequency','duration','velocity','pi'],functions:['sin','cos','tanh','abs','exp','sqrt','floor','fract','min','max','pow','clamp','noise'],
    syntax:'Numeric literals, + - * /, parentheses, declared parameters. noise() is seeded. No assignments, loops, properties or JavaScript.',limits:'2048 characters, 256 tokens, 128 operations, depth 16, 16 parameters. Finite output clamped to [-1,1]. Render operations are budgeted.'},
  instrument:{schema:'momo.instrument/v1',instrument:{id:'unique ID',name:'Instrument name',keyRange:'optional {low,high} intended MIDI range, 0..127, containing all mapped keys; gaps allowed',regions:[{
    id:'region ID',assetId:'recording asset ID, or empty string with synth',rootMidi:60,keyLow:48,keyHigh:72,velocityLow:1,velocityHigh:127,
    articulation:'sustain',roundRobin:0,playbackGroup:'optional ID preserving alternating takes across different source pitches; key and velocity ranges must still match',tuneCents:0,gainDb:0,releaseSeconds:0.15,
    synth:'optional complete synth definition snapshot',synthValues:'optional parameter values within declared ranges',
    fixedPitch:'optional boolean; true keeps recording at original speed regardless of note pitch',
    playback:'optional gate (default) or one-shot; one-shot is recording-only and ignores note length, bypassing loop and releaseAssetId without deleting them',
  }]},assets:'portable SampleAsset map; only recordings, never local paths'},
  storage:'Local folder is the source of truth. Resource packages inline required algorithms and recordings. Work instances are independent snapshots. Library operations do not enter work undo history. Remote library transport is not implemented.',
};
