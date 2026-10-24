import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

export function runMediaAdmissionChecks(check, source = readFileSync(new URL('../js/media-input-contract.js', import.meta.url), 'utf8')) {
  const api = runInNewContext(source + '\nWarpMediaInput');
  const assess = api.assessCapabilities;
  const test = (name, ok) => check('media-admission: ' + name, !!ok);
  const good = {kind:'video', container:'mp4', inventoryKnown:true, audioTrackCount:1,
    pictureDecoded:true, frameAccess:true, nativeDataReady:true, audioDecoded:true,
    analysisReady:true, previewReady:true, loaderDecision:'admitted', durationSeconds:2,
    audioStartKnown:true, audioStartSeconds:0};
  const available = assess(good);
  test('verified native picture control remains available', available.capabilities.picture.state === 'available' && available.capabilities.nativePlayback.state === 'available');
  test('metadata alone cannot establish a picture', assess({kind:'video', durationSeconds:2, width:1920, height:1080, nativeDataReady:true}).capabilities.picture.state === 'unknown');
  test('metadata alone cannot establish playable video', assess({kind:'video', nativeDataReady:true}).capabilities.nativePlayback.state === 'unknown');
  test('provider readiness claims do not authorize admission', assess({kind:'video', ready:true, validated:true, capabilities:{picture:'available'}}).admission.state === 'pending');
  test('provider profile claims never certify a prepared recipe', assess({...good, preparedProfile:'verified', provenance:'original'}).admission.preparedProfile === 'not-validated');
  test('decoded analysis does not certify original fidelity', available.capabilities.originalSourceAnalysis.state === 'unknown');
  test('known start does not certify A/V sync', available.timing.synchronization.state === 'unknown');
  test('an app fps/default does not certify CFR', assess({...good, frameRate:30, constantFrameRate:true}).timing.frameRate.state === 'unknown');
  test('zero with a confidence flag is a known audio start', available.timing.audioStart.state === 'known' && available.timing.audioStart.seconds === 0);
  test('numeric fallback zero without confidence stays unknown', assess({...good, audioStartKnown:false}).timing.audioStart.state === 'unknown');
  test('positive container offset is preserved', assess({...good, audioStartSeconds:.166}).timing.audioStart.seconds === .166);
  for (const value of [null, undefined, NaN, Infinity, -1]) {
    test('invalid audio start '+String(value)+' stays unknown', assess({...good, audioStartSeconds:value}).timing.audioStart.state === 'unknown');
  }
  for (const value of [null, undefined, NaN, Infinity, 0, -1]) {
    test('invalid duration '+String(value)+' stays unknown', assess({...good, durationSeconds:value}).timing.duration.state === 'unknown');
  }
  test('finite duration is explicitly native metadata', available.timing.duration.state === 'known' && available.timing.duration.evidence === 'native-metadata');
  const blocked = assess({...good, audioTrackCount:2});
  for (const key of ['audioDecode','decodedAnalysis','scrubAudio','originalSourceAnalysis']) {
    test('multi-track policy withholds '+key+' despite claimed results', blocked.capabilities[key].state === 'unavailable');
  }
  test('multi-track native picture/playback remain available', blocked.capabilities.picture.state === 'available' && blocked.capabilities.nativePlayback.state === 'available');
  test('multi-track issue is structured', blocked.issues[0].code === 'audio-track-selection-required');
  test('unverified MP4 inventory cannot borrow successful decode claims', assess({...good, inventoryKnown:false}).capabilities.decodedAnalysis.state === 'unavailable');
  const webm = assess({...good,container:'webm',audioTrackCount:2});
  test('multiple WebM tracks withhold decoded tools with the matching container notice',
    webm.capabilities.decodedAnalysis.state === 'unavailable' && webm.capabilities.scrubAudio.state === 'unavailable' && webm.issues[0].message.includes('Multiple WebM'));
  test('unverified WebM inventory cannot borrow successful decode claims',assess({...good,container:'webm',inventoryKnown:false}).capabilities.decodedAnalysis.state === 'unavailable');
  const silent = assess({...good, audioTrackCount:0});
  test('verified absence is not an unsupported codec', silent.capabilities.audioDecode.state === 'not-applicable' && silent.timing.audioStart.state === 'not-applicable');
  test('heuristic no-audio is not verified absence', assess({kind:'video', noAudioDetected:true}).capabilities.audioDecode.state === 'unavailable');
  const picture = assess({kind:'image', pictureDecoded:true, frameAccess:true, loaderDecision:'admitted'});
  test('images have decoded picture but no audio or playback requirement', picture.capabilities.picture.state === 'available' && picture.capabilities.audioDecode.state === 'not-applicable' && picture.capabilities.nativePlayback.state === 'not-applicable');
  test('images have no duration requirement', picture.timing.duration.state === 'not-applicable');
  test('analysis flags without decoded samples do not authorize tools', assess({kind:'audio', analysisReady:true, previewReady:true}).capabilities.decodedAnalysis.state === 'unknown');
  test('terminal decode failure explains unavailable analysis', assess({kind:'audio', audioDecoded:true, audioDecodeFailed:true}).capabilities.decodedAnalysis.state === 'unavailable');
  test('preview limits do not remove completed analysis', assess({...good, previewReady:false, previewUnavailable:true}).capabilities.decodedAnalysis.state === 'available' && assess({...good, previewReady:false, previewUnavailable:true}).capabilities.scrubAudio.state === 'unavailable');
  const bad = assess({...good, mediaFailed:true});
  test('media failure overrides earlier picture and admission flags', bad.admission.state === 'failed' && bad.capabilities.picture.state === 'unavailable' && bad.capabilities.nativePlayback.state === 'unavailable');
  test('pixel access is distinct from source decoding', assess({...good, frameAccess:false}).capabilities.picture.state === 'available' && assess({...good, frameAccess:false}).capabilities.frameAccess.state === 'unknown');
  test('snapshots are deeply immutable', Object.isFrozen(available) && Object.isFrozen(available.admission) && Object.isFrozen(available.capabilities) && Object.isFrozen(available.capabilities.picture) && Object.isFrozen(available.timing) && Object.isFrozen(available.timing.duration) && Object.isFrozen(blocked.issues) && Object.isFrozen(blocked.issues[0]));
  test('reports contain no source bytes, URL or filename', !('src' in available) && !('filename' in available) && !('buffer' in available));
  const store = api.createEvidenceStore(), old = {}, next = {};
  store.begin('editA', old); store.observe('editA', old, {pictureDecoded:true});
  const snapshot = store.read('editA', old);
  test('current owner can publish evidence', snapshot.pictureDecoded === true);
  store.begin('editA', next);
  test('replacement owner rejects old observations', store.observe('editA', old, {mediaFailed:true}) === false);
  test('old owner cannot read replacement evidence', store.read('editA', old) === null);
  test('new owner starts without inherited successes', !store.read('editA', next).pictureDecoded);
  store.observe('editA', next, {pictureDecoded:'yes', frameAccess:{bytes:new Uint8Array(8)}, ready:true,
    audioTrackCount:1000000, metadataAudioStart:Infinity, container:'not-a-container'});
  const filtered = store.read('editA', next);
  test('evidence store refuses truthy non-boolean claims and raw objects', !('pictureDecoded' in filtered) && !('frameAccess' in filtered) && !('ready' in filtered));
  test('count/timeline/container metadata remain bounded', filtered.audioTrackCount === null && filtered.metadataAudioStart === null && filtered.container === 'unknown');
  test('prior snapshots remain immutable after replacement', snapshot.pictureDecoded === true && Object.isFrozen(snapshot));
  store.clear();
  test('clear retires every observation', store.read('editA', next) === null && store.observe('editA', next, {pictureDecoded:true}) === false);
}
