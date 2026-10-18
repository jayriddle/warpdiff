// Keep native ESM loading in Node, outside Playwright's CommonJS transformer.
import {createCompanion} from '../../tools/media-prepare/companion/server.mjs';
const delayed=process.argv.includes('--delayed');
const app=await createCompanion(delayed?{checkTools:false,processor:async({signal})=>{
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
