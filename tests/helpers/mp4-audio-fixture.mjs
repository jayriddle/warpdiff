// Tiny ISO-BMFF containers for parser tests; payload bytes are not codec fixtures.
export const u32=(...values)=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeUInt32BE(v,i*4));return b;};
export const box=(name,...parts)=>{const b=Buffer.concat(parts);return Buffer.concat([u32(b.length+8),Buffer.from(name),b]);};
export const table=(...rows)=>Buffer.concat([u32(0,rows.length),...rows.map(row=>u32(...row))]);
export function mp4AudioFixture(tracks=[{}], options={}) {
  const payloads=tracks.map((t,i)=>t.payload||Buffer.from([i+1,i+11]));
  const build=offsets=>box('moov',box('mvhd',u32(0,0,0,1000)),...tracks.map((t,i)=>{
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
