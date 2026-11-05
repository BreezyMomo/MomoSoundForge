// Six original short demonstrations. Each note must have real mapped coverage.
import { writeFile } from 'node:fs/promises';
const part = (id,instrumentId,articulation,midis,start=.12,step=.4,velocities=[75],duration=.24) => ({
  id,instrumentId,articulation,gain:.12,pan:0,releaseSeconds:.45,maxSourceSeconds:4,
  notes:midis.map((midi,i)=>({midi,startSeconds:start+i*step,durationSeconds:duration,velocity:velocities[i%velocities.length]})),
});
const piece = (id,name,description,parts,durationSeconds=6.5) => ({id,name,description,parts,durationSeconds,bpm:120,seed:20261105,targetRmsDb:-25,maxPeakDb:-5});
const plan={schema:'melody-design/performance-plan-v1',pieces:[
  piece('expanded-piano','钢琴 · 连续音阶与轻重','跨越旧库音域空白，再比较同音轻中重演奏。',[
    part('piano','upright-piano','single-hit',[60,62,64,65,67,69,71,72,72,72],.12,.42,[75,75,75,75,75,75,75,35,75,115]),
  ]),
  piece('expanded-flute','长笛 · 长音与断奏','持续音、断奏、带颤音的持续音分句比较。',[
    part('sustain','flute','sustain',[69,71],.12,.65,[45,90],.45),
    part('staccato','flute','staccato',[69,71,72,74],1.65,.34,[35,75,110],.16),
    part('vibrato','flute','sustain-vibrato',[72,74],3.45,.65,[75],.48),
  ]),
  piece('expanded-violin','小提琴组 · 弓与拨弦','短弓、拨弦、持续音、震音分句比较。',[
    part('spiccato','violin-section','spiccato',[60,62],.12,.32,[40,100],.14),
    part('pizzicato','violin-section','pizzicato',[64,65],1.1,.38,[40,100],.2),
    part('sustain','violin-section','sustain',[67,69],2.2,.62,[75],.45),
    part('tremolo','violin-section','tremolo',[71,72],3.7,.62,[75],.45),
  ]),
  piece('expanded-cello','大提琴组 · 弓与拨弦','低音区短弓、拨弦、持续音、震音，保留不同力度。',[
    part('spiccato','cello-section','spiccato',[48,50],.12,.32,[40,100],.14),
    part('pizzicato','cello-section','pizzicato',[52,53],1.1,.38,[40,100],.2),
    part('sustain','cello-section','sustain',[55,57],2.2,.62,[75],.45),
    part('tremolo','cello-section','tremolo',[59,60],3.7,.62,[75],.45),
  ]),
  piece('expanded-horn','圆号 · 长短与弱音','持续音、短音和弱音器音色分句比较。',[
    part('sustain','french-horn','sustain',[60,62],.12,.6,[40,100],.42),
    part('staccato','french-horn','staccato',[64,65,67],1.7,.36,[40,75,100],.18),
    part('muted','french-horn','muted-sustain',[67,69],3.3,.6,[75],.42),
  ]),
  piece('expanded-trumpet','小号 · 五种演奏法','持续、断奏、颤音持续、哈蒙弱音和直筒弱音分句比较。',[
    part('sustain','trumpet','sustain',[60,62],.12,.4,[75],.24),
    part('staccato','trumpet','staccato',[64,65],1.1,.36,[40,100],.15),
    part('vibrato','trumpet','sustain-vibrato',[67,69],2.05,.4,[75],.24),
    part('harmon','trumpet','harmon-muted-sustain',[67,69],3.05,.4,[75],.24),
    part('straight','trumpet','straight-muted-sustain',[64,60],4.05,.4,[75],.24),
  ]),
]};
await writeFile('samples/orchestra-expanded-20261105/demo-plan.json',JSON.stringify(plan,null,2)+'\n');
