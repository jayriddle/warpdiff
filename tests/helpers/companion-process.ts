import path from 'node:path';
import {spawn} from 'node:child_process';

export async function launchCompanion(mode=''):Promise<any> {
  const child=spawn(process.execPath,[path.join(__dirname,'local-companion-launch.mjs'),...(mode?['--'+mode]:[])],{stdio:['ignore','pipe','pipe','ipc']});
  let diagnostics='',started=false,retired=false;
  child.stdout.resume();child.stderr.on('data',data=>{diagnostics+=data.toString();});
  const closed=new Promise(resolve=>child.once('close',resolve));
  const origin=await new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('Local tool did not start: '+diagnostics));},20000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('Local tool exited: '+diagnostics));});
    child.on('message',(message:any)=>{if(message.started)started=true;if(message.retired)retired=true;if(message.origin){clearTimeout(timer);resolve(message.origin);}});
  });
  return {origin,state:()=>({started,retired}),async close(){
    if(child.exitCode!==null)return closed;
    const kill=setTimeout(()=>child.kill('SIGKILL'),10000);child.send('close',()=>{});await closed;clearTimeout(kill);
  }};
}
