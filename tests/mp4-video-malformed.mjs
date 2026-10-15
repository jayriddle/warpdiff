// Behavioral malformed-container checks against the shipped video demuxer.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const u32 = (...values) => { const b = Buffer.alloc(values.length * 4); values.forEach((v,i) => b.writeUInt32BE(v,i*4)); return b; };
const box = (name, ...payload) => { const data=Buffer.concat(payload); return Buffer.concat([u32(data.length+8),Buffer.from(name),data]); };
const table = (...rows) => Buffer.concat([u32(0,rows.length),...rows.map(row=>u32(...row))]);
// Complete AVC configuration record from the landscape_a fixture (SPS + PPS).
// Parser tests below still do not establish bitstream/decoder conformance.
const avc = Buffer.from('0164001fffe1001a6764001facd940f0117ef011000003000100000300300f18319601000468ef8fcbfdf8f800','hex');
function description(config = box('avcC',avc), fourcc='avc1') {
  const entry=Buffer.alloc(86); entry.writeUInt32BE(86+config.length); entry.write(fourcc,4); entry.writeUInt16BE(640,32); entry.writeUInt16BE(360,34);
  return Buffer.concat([u32(0,1),entry,config]);
}
function fixture(overrides={}) {
  const build = offset => {
    const defaults={mdhd:u32(0,0,0,1000),hdlr:Buffer.concat([u32(0,0),Buffer.from('vide')]),
      elst:Buffer.concat([u32(0,1,2000,0,0x10000)]),stsd:description(),stss:table([1],[2]),
      stsz:u32(0,0,2,1,1),stsc:table([1,2,1]),stco:table([offset]),stts:table([2,1000]),ctts:table([2,0])};
    const get = name => {
      const value=Object.hasOwn(overrides,name)?overrides[name]:defaults[name];
      return value===null?Buffer.alloc(0):box(name,value);
    };
    return box('moov',box('trak',box('edts',get('elst')),box('mdia',get('mdhd'),get('hdlr'),box('minf',box('stbl',
      get('stsd'),get('stss'),get('stsz'),get('stsc'),get('stco'),...(overrides.co64?[box('co64',overrides.co64)]:[]),get('stts'),get('ctts'))))));
  };
  const moov=build(0);
  return new Uint8Array(Buffer.concat([build(moov.length+8),box('mdat',Buffer.from([1,2]))]));
}

export function runMalformedVideoChecks(check, source=readFileSync(new URL('../js/mp4-demux.js',import.meta.url),'utf8')) {
  const realm={};runInNewContext(source,realm);
  const parse=realm._demuxMP4Video;
  const rejects=(name,data) => {
    let result, error;
    try { result=parse(data); } catch(e) { error=e; }
    check('demux[malformed-video]: '+name, !error && result===null);
  };
  const valid=parse(fixture());
  check('demux[malformed-video]: complete synthetic table produces exact offsets and timing',
    valid?.samples.length===2 && valid.samples[0].pts===0 && valid.samples[1].pts===1 && valid.samples[0].size===1 && valid.samples[1].offset===valid.samples[0].offset+1);
  const padded=Buffer.concat([Buffer.alloc(7),Buffer.from(fixture()),Buffer.alloc(9)]);
  check('demux[malformed-video]: nonzero-byte-offset input retains container-relative ranges',
    JSON.stringify(parse(new Uint8Array(padded.buffer,padded.byteOffset+7,padded.length-16)))===JSON.stringify(valid));

  const minimums={elst:8,mdhd:16,hdlr:12,stsd:8,stss:8,stsz:12,stsc:8,stco:8,co64:8,stts:8,ctts:8};
  for(const [name,min] of Object.entries(minimums)) for(let length=0;length<min;length++) {
    const change=name==='co64'?{stco:null,co64:Buffer.alloc(length)}:{[name]:Buffer.alloc(length)};
    rejects(`${name} payload of ${length} bytes`,fixture(change));
  }
  for(let length=1;length<24;length++) {
    const payload=Buffer.alloc(length);payload[0]=1;
    rejects('version-1 mdhd payload of '+length+' bytes',fixture({mdhd:payload}));
  }
  for(const name of ['elst','stss','stsc','stco','stts','ctts']) rejects(name+' overdeclared table',fixture({[name]:u32(0,0xffffffff)}));
  rejects('stsz truncated per-sample table',fixture({stsz:u32(0,0,2,1)}));
  rejects('stsz enormous uniform count',fixture({stsz:u32(0,1,0xffffffff)}));
  // A count below file length still must not amplify an already impossible
  // table into per-sample allocations. Observe allocation order, not just null.
  const count = 100000;
  const paddedFixture = overrides => new Uint8Array(Buffer.concat([fixture(overrides),box('free',Buffer.alloc(120000))]));
  const earlyRejects = (name, bytes, threshold=count) => {
    const allocations=[];
    const guarded={Array:new Proxy(Array,{construct(target,args) {
      if (typeof args[0] === 'number') allocations.push(args[0]);
      return Reflect.construct(target,args);
    }})};
    runInNewContext(source,guarded);
    let result,error;
    try {result=guarded._demuxMP4Video(bytes);} catch(e) {error=e;}
    check('demux[malformed-video]: '+name+' rejects before count-sized allocations',
      !error && result===null && allocations.every(n=>n<threshold));
  };
  earlyRejects('impossible uniform size below byte-count cap',paddedFixture({stsz:u32(0,0xffffffff,count)}));
  earlyRejects('impossible aggregate uniform bytes',paddedFixture({stsz:u32(0,2,count)}));
  earlyRejects('incomplete chunk coverage',paddedFixture({stsz:u32(0,1,count)}));
  earlyRejects('incomplete timing coverage',paddedFixture({stsz:u32(0,1,count),stsc:table([1,count,1])}));
  earlyRejects('invalid uniform sample range',paddedFixture({stsz:u32(0,1,count),stsc:table([1,count,1]),
    stts:table([count,1]),ctts:null,stco:table([120000])}));
  const variable=Buffer.alloc(12+count*4);
  u32(0,0,count).copy(variable);
  for(let i=0;i<count;i++) variable.writeUInt32BE(1,12+i*4);
  earlyRejects('variable table with incomplete chunk coverage',paddedFixture({stsz:variable}));
  variable.writeUInt32BE(0xffffffff,12);
  earlyRejects('impossible variable sample size',paddedFixture({stsz:variable}));
  earlyRejects('practical sample limit',new Uint8Array(Buffer.concat([fixture({stsz:u32(0,1,1000001),
    stsc:table([1,1000001,1]),stts:table([1000001,1]),ctts:null}),box('free',Buffer.alloc(1100000))])),1000001);
  rejects('missing stsc',fixture({stsc:null}));
  rejects('empty stsc',fixture({stsc:table()}));
  rejects('first chunk zero',fixture({stsc:table([0,2,1])}));
  rejects('first chunk unavailable',fixture({stsc:table([2,2,1])}));
  rejects('zero samples per chunk',fixture({stsc:table([1,0,1])}));
  rejects('too many samples per chunk',fixture({stsc:table([1,3,1])}));
  rejects('incomplete sample map',fixture({stsc:table([1,1,1])}));
  rejects('unsupported sample description',fixture({stsc:table([1,2,2])}));
  rejects('non-increasing chunk map',fixture({stsc:table([1,1,1],[1,1,1])}));
  rejects('sample beyond file bytes',fixture({stco:table([4096])}));
  rejects('empty sample',fixture({stsz:u32(0,0,2,0,1)}));
  rejects('zero timescale',fixture({mdhd:u32(0,0,0,0)}));
  rejects('incomplete timing coverage',fixture({stts:table([1,1000])}));
  rejects('excess composition coverage',fixture({ctts:table([3,0])}));
  rejects('zero timing run',fixture({stts:table([0,1000],[2,1000])}));
  rejects('sync sample outside table',fixture({stss:table([3])}));
  rejects('empty sync sample table',fixture({stss:table()}));
  const co64=Buffer.concat([u32(0,1),Buffer.from('ffffffffffffffff','hex')]);
  rejects('unsafe 64-bit sample offset',fixture({stco:null,co64}));
  for(const name of ['elst','mdhd','ctts']) {const payload=Buffer.alloc(40);payload[0]=2;rejects('unsupported '+name+' version',fixture({[name]:payload}));}
  for(let length=0;length<86;length++) {
    const entry=Buffer.alloc(length);if(length>=4)entry.writeUInt32BE(length);if(length>=8)entry.write('avc1',4);
    rejects('short visual sample entry '+length,fixture({stsd:Buffer.concat([u32(0,1),entry])}));
  }
  for(let length=0;length<7;length++) rejects('short avcC '+length,fixture({stsd:description(box('avcC',avc.subarray(0,length)))}));
  for(let length=0;length<23;length++) rejects('short hvcC '+length,fixture({stsd:description(box('hvcC',Buffer.alloc(length)),'hvc1')}));
  for(let length=0;length<11;length++) {
    const color=Buffer.alloc(length);Buffer.from('nclx').copy(color);
    rejects('short colr '+length,fixture({stsd:description(Buffer.concat([box('avcC',avc),box('colr',color)]))}));
  }
  rejects('truncated extended header',new Uint8Array(Buffer.concat([u32(1),Buffer.from('moov'),u32(0)])));
  rejects('unsafe extended size',new Uint8Array(Buffer.concat([u32(1),Buffer.from('moov'),Buffer.from('ffffffffffffffff','hex')])));
  rejects('box larger than input',new Uint8Array(Buffer.concat([u32(100),Buffer.from('moov')])));
  let nested=Buffer.from(fixture());for(let i=0;i<40;i++)nested=box('moov',nested);
  rejects('excessive nesting',new Uint8Array(nested));
  rejects('nested tracks',new Uint8Array(box('moov',box('trak',box('trak',Buffer.alloc(0))))));
  for(let n=0;n<16;n++) rejects('short arbitrary input '+n,new Uint8Array(n));
}
