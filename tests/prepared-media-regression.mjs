import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash, webcrypto} from 'node:crypto';

export async function runPreparedMediaChecks(check, source=readFileSync(new URL('../js/prepared-media.js',import.meta.url),'utf8')) {
  const test=(name,ok)=>check('prepared-package: '+name,!!ok);
  const rejects=async(fn,pattern)=>{try{await fn();return false;}catch(e){return !pattern||pattern.test(String(e.message)+' '+e.name);}};
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const input=new File(['original'],'source.mp4'),output=new File(['rendition'],'review.mp4');
  const manifest={contract:'warpdiff.prepared-media',version:1,recipe:'video-audio-compatibility-v1',
    source:{name:input.name,size:input.size,sha256:hash('original')},rendition:{name:output.name,size:output.size,sha256:hash('rendition')},
    transformation:{video:'copy',audio:'aac-stereo-48000',normalization:'none',downmix:'ffmpeg-default',selectedAudioStream:1}};
  let audioCalls=0,videoCalls=0,summaryMode=false,audioOverride=null,videoOverride=null;
  const api=runInNewContext(source+'\nWarpPreparedMedia',{File,TextEncoder,crypto:webcrypto,
    _demuxMP4Audio(bytes,metadataOnly,selected,validateOnly){audioCalls++;summaryMode=metadataOnly===false&&selected===null&&validateOnly===true;return audioOverride??{codec:'mp4a.40.2',aacSbr:false,channels:2,sampleRate:48000,timelineStart:0,trackCount:2,audioTrackCount:1,videoTrackCount:1};},
    _demuxMP4Video(bytes,summaryOnly){videoCalls++;if(!summaryOnly)throw Error('Inspector must use compact video validation');return videoOverride??{codec:'avc1.42c01e',codedWidth:320,codedHeight:180,sampleCount:1};}});
  const mf=value=>new File([JSON.stringify(value)],'warpdiff-package.json');
  const inspect=(options={})=>api.inspectFiles({manifestFile:mf(manifest),mediaFile:output,sourceFile:input,...options});
  const normalized=api.parseManifest(JSON.stringify({...manifest,ready:true,validated:true,secret:'discard'}));
  test('normalized manifest is deeply immutable',Object.isFrozen(normalized)&&Object.isFrozen(normalized.source)&&Object.isFrozen(normalized.transformation));
  test('provider assertions and extra data are not forwarded',!('ready'in normalized)&&!('validated'in normalized)&&!('secret'in normalized));
  for(const value of [null,{}, {...manifest,version:2},{...manifest,recipe:'future'}, {...manifest,transformation:{...manifest.transformation,selectedAudioStream:1.5}}, {...manifest,transformation:{...manifest.transformation,normalization:'loudnorm'}}]) {
    test('unsupported envelope '+JSON.stringify(value)+' rejects',await rejects(()=>api.parseManifest(JSON.stringify(value))));
  }
  for(const name of ['../source.mp4','/source.mp4','a\\b.mp4','.','..','bad\n.mp4','bad\u001b.mp4']) {
    test('path/control identity '+JSON.stringify(name)+' rejects',await rejects(()=>api.parseManifest(JSON.stringify({...manifest,source:{...manifest.source,name}}))));
  }
  for(const value of [0,-1,NaN,Infinity,64*1024*1024+1])test('invalid file size '+String(value)+' rejects',await rejects(()=>api.parseManifest(JSON.stringify({...manifest,rendition:{...manifest.rendition,size:value}}))));
  test('invalid digest rejects',await rejects(()=>api.parseManifest(JSON.stringify({...manifest,rendition:{...manifest.rendition,sha256:'not-a-digest'}}))));
  test('oversized manifest rejects',await rejects(()=>api.parseManifest(' '.repeat(16385))));
  const good=await inspect();
  test('valid byte-bound control reaches both container readers',good.status==='candidate'&&audioCalls===1&&videoCalls===1&&summaryMode);
  test('selected original and rendition have matched byte bindings',good.sourceBinding==='matched'&&good.renditionBinding==='matched');
  test('output remains a prepared copy requiring normal admission',good.analysisBasis==='prepared-copy'&&good.validation==='normal-load-required');
  test('container inspection never certifies timing/fidelity/decoding',Object.values(good.conformance).every(v=>v==='not-verified'));
  test('report contains no filenames, hashes or byte buffers',!JSON.stringify(good).includes('source.mp4')&&!JSON.stringify(good).includes(manifest.source.sha256)&&!('bytes'in good));
  test('report is deeply immutable',Object.isFrozen(good)&&Object.isFrozen(good.container)&&Object.isFrozen(good.conformance));
  test('missing original remains explicitly unchecked',(await inspect({sourceFile:undefined})).sourceBinding==='not-checked');
  const before=audioCalls;
  test('same-name changed original rejects',await rejects(()=>inspect({sourceFile:new File(['originaX'],input.name)}),/SHA-256/));
  test('same-name changed rendition rejects',await rejects(()=>inspect({mediaFile:new File(['renditioX'],output.name)}),/SHA-256/));
  test('hash mismatches never reach container parsing',audioCalls===before);
  let reads=0;const unread=new File(['rendition'],output.name);unread.arrayBuffer=async()=>{reads++;return output.arrayBuffer();};
  test('wrong source identity rejects before rendition read',await rejects(()=>inspect({mediaFile:unread,sourceFile:new File(['original'],'wrong.mp4')}))&&reads===0);
  test('wrong rendition identity rejects before any media read',await rejects(()=>inspect({mediaFile:new File(['x'],'wrong.mp4')}))&&reads===0);
  const oversized=new File(['x'],'warpdiff-package.json');Object.defineProperty(oversized,'size',{value:16385});oversized.text=async()=>{reads++;return '{}';};
  test('oversized manifest rejects before reading it',await rejects(()=>inspect({manifestFile:oversized}))&&reads===0);
  const advertised=new File(['x'],output.name);Object.defineProperty(advertised,'size',{value:64*1024*1024+1});advertised.arrayBuffer=async()=>{reads++;return new ArrayBuffer(1);};
  test('oversized media rejects before its bytes are read',await rejects(()=>inspect({mediaFile:advertised}))&&reads===0);
  for(const patch of [{audioTrackCount:2},{videoTrackCount:2},{trackCount:3},{sampleRate:44100},{channels:1},{codec:'opus'},{aacSbr:true},{aacSbr:null},{timelineStart:null}]){
    audioOverride={codec:'mp4a.40.2',aacSbr:false,channels:2,sampleRate:48000,timelineStart:0,trackCount:2,audioTrackCount:1,videoTrackCount:1,...patch};
    test('actual audio/inventory mismatch '+JSON.stringify(patch)+' rejects',await rejects(()=>inspect(),/one video/));
  }
  audioOverride=null;
  for(const patch of [{codec:'hvc1.1.6.L93.B0'},{codedWidth:5000},{codedWidth:4096,codedHeight:4096},{sampleCount:0}]){
    videoOverride={codec:'avc1.42c01e',codedWidth:320,codedHeight:180,sampleCount:1,...patch};
    test('actual picture mismatch '+JSON.stringify(patch)+' rejects',await rejects(()=>inspect(),/bounded AVC/));
  }
  videoOverride=null;
  const controller=new AbortController();controller.abort();
  test('pre-aborted inspection rejects without parsing',await rejects(()=>inspect({signal:controller.signal}),/AbortError/));
  let release,entered;const started=new Promise(resolve=>entered=resolve),delayed=new File(['rendition'],output.name);
  delayed.arrayBuffer=()=>{entered();return new Promise(resolve=>release=resolve);};
  const cancel=new AbortController(),pending=inspect({mediaFile:delayed,signal:cancel.signal}).then(()=>false,e=>e.name==='AbortError');await started;cancel.abort();
  test('pending cancelled reads retain the one-inspection reservation',await rejects(()=>inspect(),/still retiring/));
  release(await output.arrayBuffer());test('late read completion cannot publish after cancellation',await pending);
  test('reservation retires after cancelled read settles',(await inspect()).status==='candidate');
  const provider=api.createFileProvider({manifestFile:mf(manifest),mediaFile:output});
  test('file adapter registration shape is versioned and explicit',provider.id==='prepared-package'&&provider.version===1&&provider.mode==='files'&&provider.supports({recipe:manifest.recipe}));
  const result=await provider.prepare({source:{name:input.name}},{input});
  test('file adapter returns an immutable snapshot of inspected bytes',result.kind==='files'&&result.files.length===1&&result.files[0]!==output&&await result.files[0].text()==='rendition'&&!('ready'in result)&&!('validated'in result));
  test('one-shot adapter cannot be reused or retain a discoverable selection',!provider.supports({recipe:manifest.recipe})&&await rejects(()=>provider.prepare({source:{name:input.name}},{input}),/consumed/));
}
