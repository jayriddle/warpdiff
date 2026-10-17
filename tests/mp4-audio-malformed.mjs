import {readFileSync,existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {mp4AudioFixture,prependMp4Boxes,box,u32,table} from './helpers/mp4-audio-fixture.mjs';

export function runMalformedAudioChecks(check, source=readFileSync(new URL('../js/mp4-demux.js',import.meta.url),'utf8')) {
  const realm={console:{log(){},warn(){}}};runInNewContext(source,realm);
  const parse=realm._demuxMP4Audio;
  const rejected=(name,bytes)=>{let result,error;try{result=parse(bytes);}catch(e){error=e;}check('demux[malformed-audio]: '+name,!error&&result===null);};
  const one=mp4AudioFixture();const valid=parse(one);
  check('demux[malformed-audio]: single audio track preserves packet bytes and timestamps',valid?.chunks.length===2&&valid.chunks[0].data[0]===1&&valid.chunks[1].data[0]===11&&valid.chunks[1].timestamp===20000);
  const extendedPadding=Buffer.concat([u32(1),Buffer.from('free'),Buffer.from('0000000000000010','hex')]);
  const paddedOne=prependMp4Boxes(one,box('free',Buffer.alloc(8)));
  const paddedView=Buffer.concat([Buffer.alloc(3),Buffer.from(paddedOne)]);
  const recognitionCases=[
    ['ordinary MP4',one,true],
    ['leading free box',paddedOne,true],
    ['mixed leading padding',prependMp4Boxes(one,Buffer.concat([box('skip'),box('wide'),box('free')])),true],
    ['extended-size padding',prependMp4Boxes(one,extendedPadding),true],
    ['unknown top-level box before ftyp',prependMp4Boxes(one,box('uuid',Buffer.alloc(16))),true],
    ['legacy movie-first candidate',box('moov'),true],
    ['media-first candidate',box('mdat'),true],
    ['truncated ftyp candidate',Buffer.concat([u32(0xffffffff),Buffer.from('ftyp')]),true],
    ['invalid padding stays unverified MP4',Buffer.concat([u32(4),Buffer.from('free')]),true],
    ['unsafe extended padding stays unverified MP4',Buffer.concat([u32(1),Buffer.from('free'),Buffer.alloc(8,255)]),true],
    ['final zero-size padding stays unverified MP4',Buffer.concat([u32(0),Buffer.from('free')]),true],
    ['nonzero byteOffset',new Uint8Array(paddedView.buffer,paddedView.byteOffset+3,paddedOne.length),true],
    ['ftyp text inside a payload is not a top-level box',box('junk',box('ftyp')),false],
    ['invalid unknown header cannot authorize a payload scan',Buffer.concat([u32(4),Buffer.from('junk'),box('ftyp')]),false],
    ['WAVE signature',Buffer.from('RIFF0000WAVEfmt '),false],
    ['WebM signature',Buffer.from('1a45dfa300000000','hex'),false],
    ['empty bytes',new Uint8Array(),false],
    ['non-byte view',new Uint16Array(8),false],
  ];
  for(const [name,input,wanted]of recognitionCases)check('mp4-recognition: '+name,
    typeof realm._isMP4AudioContainer==='function'&&realm._isMP4AudioContainer(input)===wanted);
  check('demux[malformed-audio]: leading padding retains the sole track packet map',JSON.stringify(parse(paddedOne))===JSON.stringify(valid));
  const bounded={input:Buffer.concat([...Array.from({length:1000},()=>box('junk')),Buffer.from(one)])};
  runInNewContext(source+`;globalThis.reads=0;globalThis.result=false;
    if(typeof _isMP4AudioContainer==='function') {
      const read=DataView.prototype.getUint32;
      DataView.prototype.getUint32=function(...args){if(++reads>64)throw Error('Recognizer exceeded its header budget');return read.apply(this,args);};
      globalThis.result=_isMP4AudioContainer(new Uint8Array(input));
    }`,bounded);
  check('mp4-recognition: a bounded inconclusive prefix stays unverified instead of bypassing policy',bounded.result===true&&bounded.reads<=64);
  const multi=mp4AudioFixture([{id:10,timescale:48000},{id:20,timescale:24000}]);
  rejected('multiple audio tracks require an explicit selection',multi);
  for(const id of[10,20]){
    const got=parse(multi,false,id);
    check('demux[malformed-audio]: explicit track '+id+' owns its bytes, codec and clock',got?.trackId===id&&got.chunks.length===2&&got.chunks[0].data[0]===(id===10?1:2)&&got.chunks[1].timestamp===(id===10?20000:40000));
  }
  const metadata=parse(multi,true);
  check('demux[malformed-audio]: ambiguous metadata identifies both tracks without packet copies',metadata?.selection==='ambiguous'&&metadata.audioTracks.length===2&&metadata.audioTracks[0].trackId===10&&metadata.audioTracks[1].trackId===20&&!('chunks'in metadata));
  const follow=mp4AudioFixture([{}, {handler:'vide',timescale:1000}]);
  check('demux[malformed-audio]: a later video track cannot overwrite the audio clock',parse(follow)?.chunks[1]?.timestamp===20000);
  rejected('truncated stsz does not publish a partial packet list',mp4AudioFixture([{stsz:u32(0,0,2,1)}]));
  rejected('missing chunk map is not fabricated',mp4AudioFixture([{stsc:null}]));
  rejected('incomplete timing coverage does not publish partial audio',mp4AudioFixture([{stts:table([1,960])}]));
  rejected('zero sample size is not a packet',mp4AudioFixture([{stsz:u32(0,0,2,0,1)}]));
  rejected('sample points outside mdat',mp4AudioFixture([{stco:table([8])}]));
  const count=100000,malicious=mp4AudioFixture([{stsz:u32(0,0xffffffff,count)}],{padding:120000});
  const measured={input:malicious,console:{log(){},warn(){}}};
  runInNewContext(source+`;globalThis.bytes=new Uint8Array(input);globalThis.largePush=false;globalThis.largeArray=false;globalThis.packetCopies=0;
    const push=Array.prototype.push;Array.prototype.push=function(...a){if(this.length+a.length>=${count})largePush=true;return push.apply(this,a);};
    const array=Array;globalThis.Array=new Proxy(array,{construct(t,a){if(typeof a[0]==='number'&&a[0]>=${count})largeArray=true;return Reflect.construct(t,a);}});
    const slice=Uint8Array.prototype.slice;Uint8Array.prototype.slice=function(...a){packetCopies++;return slice.apply(this,a);};
    globalThis.result=_demuxMP4Audio(bytes);`,measured);
  check('demux[malformed-audio]: impossible uniform bytes reject before packet/count allocations',measured.result===null&&!measured.largePush&&!measured.largeArray&&measured.packetCopies===0);

  for (const ordered of [
    [{id:10,payload:Buffer.from([1,11])},{id:20,payload:Buffer.from([2,12]),timescale:24000}],
    [{id:20,payload:Buffer.from([2,12]),timescale:24000},{handler:'vide',id:30},{id:10,payload:Buffer.from([1,11])}],
  ]) for(const id of[10,20]) {
    const got=parse(mp4AudioFixture(ordered),false,id);
    check('demux[malformed-audio]: reordered tracks retain selection '+id+' in '+ordered.map(t=>t.id).join(','),
      got?.chunks.length===2&&got.chunks[0].data[0]===(id===10?1:2)&&got.chunks[1].timestamp===(id===10?20000:40000));
  }
  check('demux[malformed-audio]: handler and sample tables may precede mdhd',parse(mp4AudioFixture([{reverseMedia:true}]))?.chunks.length===2);
  const lateEdits=mp4AudioFixture([{lateEdit:true,elst:u32(0,2,166,0xffffffff,0x10000,1000,480,0x10000)}]);
  const late=parse(lateEdits),lateMeta=parse(lateEdits,true);
  check('demux[malformed-audio]: an edit list after mdia retains leading silence and priming on that track',
    late?.timelineStart===.166&&late.preSkip===480&&late.maxSamples===48000&&lateMeta.timelineStart===late.timelineStart);
  rejected('duplicate audio track IDs',mp4AudioFixture([{id:1},{id:1}]));
  // The fixture builder computes absolute offsets from the final movie size.
  // Every duplicate below retains feasible packets; stale offsets cannot pass
  // this regression by causing an unrelated mdat-range failure.
  const clockTrack={elst:u32(0,2,100,0xffffffff,0x10000,1000,0,0x10000)};
  const clockControl=parse(mp4AudioFixture([clockTrack],{movieTimescales:[1000]}));
  check('demux[malformed-audio]: single movie clock retains edit timing and valid packets',
    clockControl?.timelineStart===.1&&clockControl.maxSamples===48000&&clockControl.chunks.length===2
      &&clockControl.chunks[0].data[0]===1&&clockControl.chunks[1].timestamp===20000);
  for(const clocks of[[1000,2000],[2000,1000],[1000,1000]]) {
    const duplicate=mp4AudioFixture([clockTrack],{movieTimescales:clocks});
    rejected('duplicate movie clocks '+clocks.join('/')+' reject with valid sample offsets',duplicate);
    check('demux[malformed-audio]: duplicate movie clocks '+clocks.join('/')+' also reject metadata',parse(duplicate,true)===null);
  }
  check('demux[malformed-audio]: unavailable explicit selection does not pick another track',parse(multi,false,999)===null);
  const padded=Buffer.concat([Buffer.alloc(7),Buffer.from(one),Buffer.alloc(9)]);
  const offset=parse(new Uint8Array(padded.buffer,padded.byteOffset+7,one.length));
  check('demux[malformed-audio]: nonzero byteOffset retains container-relative ranges',JSON.stringify(offset)===JSON.stringify(valid));
  const packetMap=parse(mp4AudioFixture([{payload:Buffer.from([10,11,12,13]),stsz:u32(0,0,4,1,1,1,1),
    stco:b=>table([b.readUInt32BE(8)],[b.readUInt32BE(8)+1]),stsc:table([1,1,1],[2,3,1]),stts:table([1,240],[3,480])}]));
  check('demux[malformed-audio]: multiple chunk and timing runs retain exact packet order',
    JSON.stringify(packetMap?.chunks.map(c=>[c.timestamp,c.data[0]]))===JSON.stringify([[0,10],[5000,11],[15000,12],[25000,13]]));
  const minimums={tkhd:16,mdhd:16,hdlr:12,stsd:8,stsz:12,stco:8,stsc:8,stts:8};
  for(const[name,min]of Object.entries(minimums))for(let n=0;n<min;n++)rejected(name+' with '+n+' bytes',mp4AudioFixture([{[name]:Buffer.alloc(n)}]));
  for(const name of['tkhd','mdhd'])for(let n=1;n<24;n++){const b=Buffer.alloc(n);b[0]=1;rejected('v1 '+name+' with '+n+' bytes',mp4AudioFixture([{[name]:b}]));}
  for(const name of['stco','stsc','stts']){
    rejected(name+' truncated row count',mp4AudioFixture([{[name]:u32(0,0xffffffff)}]));
    rejected(name+' empty table',mp4AudioFixture([{[name]:table()}]));
    const bad=Buffer.alloc(32);bad[0]=1;rejected(name+' unknown version',mp4AudioFixture([{[name]:bad}]));
  }
  for(const [name,changes]of Object.entries({
    'zero timescale':{mdhd:u32(0,0,0,0)},'missing timing':{stts:null},'missing offsets':{stco:null},
    'zero default samples':{stsz:u32(0,1,0)},'excess default samples':{stsz:u32(0,1,0xffffffff)},
    'excess timing':{stts:table([3,960])},'zero duration':{stts:table([2,0])},
    'zero timing run':{stts:table([0,960],[2,960])},'zero first chunk':{stsc:table([0,2,1])},
    'missing first chunk':{stsc:table([2,2,1])},'zero samples per chunk':{stsc:table([1,0,1])},
    'excess samples per chunk':{stsc:table([1,3,1])},'unsupported sample description':{stsc:table([1,2,2])},
    'non increasing chunks':{stsc:table([1,1,1],[1,1,1])},'too many chunk offsets':{stco:table([1],[2],[3])},
    'out of file sample':{stco:table([0xffffffff])},'out of file uniform aggregate':{stsz:u32(0,0xffffffff,2)},
    'negative edit time':{elst:u32(0,1,1000,0xfffffffe,0x10000)},'short edit list':{elst:u32(0,1)},
    'ambiguous offsets tables':{co64:Buffer.concat([u32(0,1),Buffer.alloc(8)])},
    'unsafe 64 bit offset':{stco:null,co64:Buffer.concat([u32(0,1),Buffer.from('ffffffffffffffff','hex')])},
  })) rejected(name,mp4AudioFixture([changes]));
  const co64=parse(mp4AudioFixture([{stco:null,co64:Buffer.concat([u32(0,1),Buffer.alloc(8)])}]));
  check('demux[malformed-audio]: a zero co64 offset cannot point into headers',co64===null);
  check('demux[malformed-audio]: valid co64 uses all 64 bits without changing packet positions',
    JSON.stringify(parse(mp4AudioFixture([{stco:null,co64:b=>b}])))===JSON.stringify(valid));
  check('demux[malformed-audio]: padding rebases co64 without changing selected packets',
    JSON.stringify(parse(prependMp4Boxes(mp4AudioFixture([{stco:null,co64:b=>b}]),box('free'))))===JSON.stringify(valid));
  const dops=Buffer.from([0,2,0,0,0,0,187,128,0,0,0]);
  const description=(type,body,children=[])=>Buffer.concat([u32(0,1),box(type,body,...children)]);
  const sound=Buffer.alloc(28);sound.writeUInt16BE(2,16);sound.writeUInt16BE(48000,24);
  const unknown=parse(mp4AudioFixture([{stsd:description('wxyz',sound)}]));
  check('demux[malformed-audio]: unknown codecs are never relabelled Opus',unknown?.codec==='wxyz'&&unknown.description===null);
  const v1=Buffer.concat([sound,Buffer.alloc(16)]);v1.writeUInt16BE(1,8);
  check('demux[malformed-audio]: QuickTime v1 extensions follow the packet fields',parse(mp4AudioFixture([{stsd:description('Opus',v1,[box('dOps',dops)])}]))?.chunks.length===2);
  const v2=Buffer.alloc(64);v2.writeUInt16BE(2,8);
  rejected('QuickTime v2 is not interpreted as v0',mp4AudioFixture([{stsd:description('Opus',v2,[box('dOps',dops)])}]));
  for(let length=0;length<28;length++)rejected('short AudioSampleEntry '+length,mp4AudioFixture([{stsd:description('Opus',Buffer.alloc(length))}]));
  for(let length=0;length<11;length++)rejected('short dOps '+length,mp4AudioFixture([{stsd:description('Opus',sound,[box('dOps',dops.subarray(0,length))])}]));
  for(const sampleCount of[0,2])rejected('stsd description count '+sampleCount,mp4AudioFixture([{stsd:Buffer.concat([u32(0,sampleCount),box('Opus',sound,box('dOps',dops))])}]));
  rejected('duplicate Opus configuration',mp4AudioFixture([{stsd:description('Opus',sound,[box('dOps',dops),box('dOps',dops)])}]));
  rejected('Opus config over 64 KiB',mp4AudioFixture([{stsd:description('Opus',sound,[box('dOps',Buffer.alloc(65537))])}]));
  const invalidOpus=dops.slice();invalidOpus[1]=6;
  rejected('mapping family zero cannot claim surround',mp4AudioFixture([{stsd:description('Opus',sound,[box('dOps',invalidOpus)])}]));
  const zeroMdat=new Uint8Array(one);zeroMdat[one.length-10]=0;zeroMdat[one.length-9]=0;zeroMdat[one.length-8]=0;zeroMdat[one.length-7]=0;
  check('demux[malformed-audio]: zero-sized final mdat extends to EOF',parse(zeroMdat)?.chunks.length===2);
  for(const input of[null,undefined,new Uint16Array(4),new DataView(new ArrayBuffer(8)),new Uint8Array(0)])rejected('non-byte or empty input '+String(input),input);
  rejected('unsafe extended size',new Uint8Array(Buffer.concat([u32(1),Buffer.from('moov'),Buffer.from('ffffffffffffffff','hex')])));
  rejected('short extended header',new Uint8Array(Buffer.concat([u32(1),Buffer.from('moov'),u32(0)])));
  rejected('nested tracks',new Uint8Array(box('moov',box('trak',box('trak')))));
  rejected('track outside movie',new Uint8Array(box('trak')));
  rejected('65 tracks exceed the bounded track inventory',mp4AudioFixture(Array.from({length:65},(_,i)=>({id:i+1}))));

  // Observe both packet copies and dynamic push growth: a length-only array
  // constructor probe would miss the released parser's push-based expansion.
  for(const [name,change]of Object.entries({
    'incomplete chunk coverage':{stsz:u32(0,1,count)},
    'incomplete timing coverage':{stsz:u32(0,1,count),stsc:table([1,count,1])},
    'impossible range':{stsz:u32(0,1,count),stsc:table([1,count,1]),stts:table([count,1]),stco:table([120000])},
  })) {
    const state={input:mp4AudioFixture([change],{padding:120000}),console:{log(){},warn(){}}};
    runInNewContext(source+`;globalThis.bytes=new Uint8Array(input);globalThis.copies=0;globalThis.grew=false;
      const push=Array.prototype.push;Array.prototype.push=function(...a){if(this.length+a.length>=${count})grew=true;return push.apply(this,a);};
      const slice=Uint8Array.prototype.slice;Uint8Array.prototype.slice=function(...a){copies++;return slice.apply(this,a);};
      globalThis.result=_demuxMP4Audio(bytes);`,state);
    check('demux[malformed-audio]: '+name+' rejects before packet copies and count growth',state.result===null&&!state.grew&&state.copies===0);
  }
  const metadataState={input:one,console:{log(){},warn(){}}};
  runInNewContext(source+`;globalThis.bytes=new Uint8Array(input);globalThis.copies=0;
    Uint8Array.prototype.slice=function(){copies++;throw Error('Metadata must not copy packets');};globalThis.result=_demuxMP4Audio(bytes,true);`,metadataState);
  check('demux[malformed-audio]: metadata-only mode makes no byte copies',metadataState.result?.audioTracks.length===1&&metadataState.copies===0);
  const summaryState={input:one,console:{log(){},warn(){}}};
  runInNewContext(source+`;globalThis.bytes=new Uint8Array(input);globalThis.copies=0;
    Uint8Array.prototype.slice=function(){copies++;throw Error('Inspection must not copy packets');};globalThis.result=_demuxMP4Audio(bytes,false,null,true);`,summaryState);
  check('demux[package-summary]: validated tables return compact counts without any packet copy',
    summaryState.result?.packetCount===2&&summaryState.result.trackCount===1&&summaryState.result.audioTrackCount===1&&summaryState.result.videoTrackCount===0&&summaryState.copies===0&&!('chunks'in summaryState.result));
  check('demux[package-summary]: compact timing preserves the extraction clock',summaryState.result?.timelineStart===valid.timelineStart&&summaryState.result.encodedDuration===.04);
  check('demux[package-summary]: incomplete chunk coverage cannot pass as metadata',parse(mp4AudioFixture([{stsz:u32(0,1,2),stsc:table([1,1,1])}]),false,null,true)===null);
  check('demux[package-summary]: invalid media ranges reject before summary publication',parse(mp4AudioFixture([{stco:table([0])}]),false,null,true)===null);
  check('demux[package-summary]: ambiguous tracks require selection even in validation mode',parse(mp4AudioFixture([{}, {id:20}]),false,null,true)===null);
  const noClock=mp4AudioFixture([{}],{movieTimescales:[]});
  check('demux[package-summary]: missing movie clock cannot publish a default timestamp while legacy extraction stays compatible',parse(noClock)?.chunks.length===2&&parse(noClock,false,null,true)===null);
  check('demux[metadata]: a legacy fallback clock is explicitly unverified',parse(noClock,true)?.timelineVerified===false&&parse(one,true)?.timelineVerified===true);
  const aacFile=new URL('fixtures/dialogue_51_aac.mp4',import.meta.url);
  if(existsSync(aacFile)) {
    const aac=parse(new Uint8Array(readFileSync(aacFile)));
    check('demux[malformed-audio]: real 5.1 AAC extraction includes its selected ASC',
      aac?.codec==='mp4a.40.2'&&aac.channels===6&&aac.sampleRate===48000&&aac.description?.length>=2
        &&(aac.description[0]>>3)===2&&((aac.description[1]>>3)&15)===6);
  } else console.log('  ⊘ demux[malformed-audio]: real AAC fixture absent; synthetic codec guards still run');
  const placeholder=Buffer.from(sound);placeholder.writeUInt16BE(2,16);placeholder.writeUInt32BE(22050*65536,24);
  const decoderConfig=Buffer.alloc(13);decoderConfig[0]=64;
  const config=Buffer.concat([decoderConfig,Buffer.from([5,2,0x11,0xb0])]);
  const es=Buffer.concat([Buffer.alloc(3),Buffer.from([4,config.length]),config]);
  const aacPlaceholder=parse(mp4AudioFixture([{stsd:description('mp4a',placeholder,[box('esds',u32(0),Buffer.from([3,es.length]),es)])}]));
  check('demux[malformed-audio]: AAC ASC overrides explicit stereo and rate placeholders',
    aacPlaceholder?.channels===6&&aacPlaceholder.sampleRate===48000&&aacPlaceholder.codec==='mp4a.40.2'
      &&Buffer.from(aacPlaceholder.description).equals(Buffer.from([0x11,0xb0])));
  for(const [name,hex,sbr] of [['LC with absent SBR','119056e500',false],['implicit HE-AAC','131056e598',true],['uninspected large ASC','1190'+'00'.repeat(65),null]]) {
    const asc=Buffer.from(hex,'hex'),dc=Buffer.concat([decoderConfig,Buffer.from([5,asc.length]),asc]);
    const es=Buffer.concat([Buffer.alloc(3),Buffer.from([4,dc.length]),dc]);
    const bytes=mp4AudioFixture([{stsd:description('mp4a',placeholder,[box('esds',u32(0),Buffer.from([3,es.length]),es)])}]);
    const summary=parse(bytes,false,null,true),legacy=parse(bytes);
    check('demux[package-summary]: '+name+' preserves SBR evidence independently of AOT2',
      summary?.codec==='mp4a.40.2'&&summary.sampleRate===48000&&summary.channels===2&&summary.aacSbr===sbr
        &&legacy?.codec==='mp4a.40.2'&&!('aacSbr' in legacy));
  }
  const limited={input:mp4AudioFixture([{payload:Buffer.alloc(1000001),stsz:u32(0,1,1000001),stsc:table([1,1000001,1]),stts:table([1000001,1])}]),console:{log(){},warn(){}}};
  runInNewContext(source+`;globalThis.bytes=new Uint8Array(input);globalThis.copies=0;
    Uint8Array.prototype.slice=function(){copies++;throw Error('Stop before allocating a million packets');};globalThis.result=_demuxMP4Audio(bytes);`,limited);
  check('demux[malformed-audio]: the packet-count ceiling rejects before starting packet copies',limited.result===null&&limited.copies===0);
  // Reserve sparse zero-filled backing stores and stop the first packet copy.
  // This checks the real byte ceiling without copying/decoding a 256 MiB packet.
  for(const packetBytes of[256*1024*1024,256*1024*1024+1]) {
    const prefix=mp4AudioFixture([{payload:Buffer.alloc(1),stsz:u32(0,packetBytes,1),stsc:table([1,1,1]),stts:table([1,960])}]);
    const mdat=prefix.length-9,input=new Uint8Array(mdat+8+packetBytes);input.set(prefix.subarray(0,mdat+8));new DataView(input.buffer).setUint32(mdat,packetBytes+8);
    const state={input,console:{log(){},warn(){}}};
    runInNewContext(source+`;globalThis.bytes=new Uint8Array(input.buffer,input.byteOffset,input.byteLength);globalThis.copies=0;
      Uint8Array.prototype.slice=function(){copies++;throw Error('Stop the large packet copy after admission');};globalThis.result=_demuxMP4Audio(bytes);`,state);
    check('demux[malformed-audio]: '+(packetBytes===256*1024*1024?'exact packet-byte budget reaches the guarded copy':'above packet-byte budget rejects before copying'),
      state.result===null&&state.copies===(packetBytes===256*1024*1024?1:0));
  }
  let fuzzOK=true,seed=0x7149;
  for(let i=0;i<250;i++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const bytes=one.slice(0,i<one.length?i:one.length);if(bytes.length&&i>=one.length/2)bytes[seed%bytes.length]^=1<<((seed>>>8)%8);
    try{for(const meta of[false,true]){const r=parse(bytes,meta);if(r&&!meta)fuzzOK&&=r.chunks.length<=1000000&&r.chunks.every(c=>Number.isSafeInteger(c.timestamp)&&c.data.length>0)&&r.chunks.reduce((n,c)=>n+c.data.length,0)<=bytes.length;}}
    catch(_){fuzzOK=false;}
  }
  check('demux[malformed-audio]: deterministic truncation and mutation corpus stays inside the exception and output budgets',fuzzOK);
}
