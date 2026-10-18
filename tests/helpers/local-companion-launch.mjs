// Keep native ESM loading in Node, outside Playwright's CommonJS transformer.
import {createCompanion} from '../../tools/media-prepare/companion/server.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const delayed=process.argv.includes('--delayed');
const corrupt=process.argv.includes('--corrupt');
const app=await createCompanion(corrupt?{checkTools:false,processor:async({directory})=>{
    const file=path.join(directory,'review.mp4');await fs.writeFile(file,'not a real movie');
    return {file,name:'review.mp4',type:'video/mp4',size:(await fs.stat(file)).size};
}}:delayed?{checkTools:false,processor:async({signal})=>{
    process.send({started:true});
    await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});
    await new Promise(resolve=>setTimeout(resolve,50));process.send({retired:true});
    throw Object.assign(Error('Cancelled'),{name:'AbortError'});
}}:{});
process.send({origin:app.origin});
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();process.disconnect();}
process.on('message',message=>{if(message==='close')close();});
process.once('disconnect',()=>{if(!closing)close();});
process.once('SIGTERM',close);
