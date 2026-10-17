// Tiny ISO-BMFF containers for parser tests; payload bytes are not codec fixtures.
export const u32=(...values)=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeUInt32BE(v,i*4));return b;};
export const box=(name,...parts)=>{const b=Buffer.concat(parts);return Buffer.concat([u32(b.length+8),Buffer.from(name),b]);};
export const table=(...rows)=>Buffer.concat([u32(0,rows.length),...rows.map(row=>u32(...row))]);
export function mp4AudioFixture(tracks=[{}], options={}) {
  const payloads=tracks.map((t,i)=>t.payload||Buffer.from([i+1,i+11]));
  const build=offsets=>box('moov',...(options.movieTimescales||[1000]).map(clock=>box('mvhd',u32(0,0,0,clock))),...tracks.map((t,i)=>{
    const get=(name,body)=>Object.hasOwn(t,name)?t[name]===null?Buffer.alloc(0):box(name,typeof t[name]==='function'?t[name](body):t[name]):box(name,body);
    const entry=Buffer.alloc(28);entry.writeUInt16BE(t.channels||2,16);entry.writeUInt16BE(48000,24);
    const dops=Buffer.from([0,t.channels||2,0,0,0,0,187,128,0,0,0]);
    const type=t.codec||'Opus';
    const stsd=Buffer.concat([u32(0,1),box(type,entry,...(type==='Opus'?[box('dOps',dops)]:[]))]);
    const mdia=[get('mdhd',u32(0,0,0,t.timescale||48000)),get('hdlr',Buffer.concat([u32(0,0),Buffer.from(t.handler||'soun')]))];
    const offset64=Buffer.alloc(8);offset64.writeBigUInt64BE(BigInt(offsets[i]));
    const tables=[get('stsd',stsd),get('stsz',u32(0,0,2,1,1)),get('stsc',table([1,2,1])),get('stco',table([offsets[i]])),...(t.co64?[get('co64',Buffer.concat([u32(0,1),offset64]))]:[]),get('stts',table([2,960]))];
    mdia.push(box('minf',box('stbl',...tables)));
    if(t.reverseMedia)mdia.reverse();
    const edit=t.elst?[box('edts',box('elst',t.elst))]:[];
    return box('trak',get('tkhd',u32(0,0,0,t.id??i+1,0,0,0,0)),...(!t.lateEdit?edit:[]),box('mdia',...mdia),...(t.lateEdit?edit:[]));
  }));
  const moov=build(tracks.map(()=>0));let pos=moov.length+24+8;const offsets=payloads.map(b=>{const v=pos;pos+=b.length;return v;});
  const value=Buffer.concat([box('ftyp',Buffer.from('isom'),u32(0),Buffer.from('isommp42')),build(offsets),box('mdat',...payloads),...(options.padding?[box('free',Buffer.alloc(options.padding))]:[])]);
  return new Uint8Array(value);
}

// Rebase absolute media offsets structurally, never by searching compressed
// payload bytes for a table name. Used only to construct real-container tests.
export function prependMp4Boxes(bytes,prefix) {
  const value=Buffer.from(bytes),delta=prefix.length;
  function walk(start,end) {
    for(let at=start;at<end;) {
      if(end-at<8)throw Error('Short fixture box');
      let size=value.readUInt32BE(at),header=8;
      if(size===1){if(end-at<16)throw Error('Short extended fixture box');size=Number(value.readBigUInt64BE(at+8));header=16;}
      else if(size===0)size=end-at;
      if(!Number.isSafeInteger(size)||size<header||size>end-at)throw Error('Invalid fixture box');
      const type=value.toString('ascii',at+4,at+8),body=at+header,limit=at+size;
      if(['moov','trak','mdia','minf','stbl'].includes(type))walk(body,limit);
      else if(type==='stco'||type==='co64') {
        if(limit-body<8)throw Error('Short fixture offsets');
        const count=value.readUInt32BE(body+4),width=type==='co64'?8:4;
        if(count>Math.floor((limit-body-8)/width))throw Error('Truncated fixture offsets');
        for(let i=0;i<count;i++) {
          const p=body+8+i*width;
          if(width===8)value.writeBigUInt64BE(value.readBigUInt64BE(p)+BigInt(delta),p);
          else value.writeUInt32BE(value.readUInt32BE(p)+delta,p);
        }
      }
      at=limit;
    }
  }
  walk(0,value.length);
  return new Uint8Array(Buffer.concat([prefix,value]));
}
