#!/usr/bin/env node
// Opt-in loopback prototype. Native processing is never exposed by Pages.
import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pageFiles} from '../../../scripts/stage-pages.mjs';
import {checkExecutables,prepareCompatible,INPUT_LIMIT,OUTPUT_LIMIT,PreparationError} from './processor.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
    '.json':'application/json','.png':'image/png','.txt':'text/plain; charset=utf-8'};
export async function createCompanion({port=0,ffmpeg='ffmpeg',ffprobe='ffprobe',processor=prepareCompatible,checkTools=true}={}) {
    if(checkTools)await checkExecutables({ffmpeg,ffprobe});
    const token=randomBytes(32).toString('hex'),runtime=new Set(pageFiles(root));
    let origin,active=null,closing=false;
    const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    const authorized=req=>{
        const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
        return req.headers.origin===origin&&supplied.length===expected.length&&timingSafeEqual(supplied,expected);
    };
    async function retire(job) {
        if(!job)return;
        job.controller.abort();
        await job.running.catch(()=>{});
        if(job.reading)await job.reading.catch(()=>{});
        if(job.directory)await fs.rm(job.directory,{recursive:true,force:true});
        clearTimeout(job.expiry);
        if(active===job)active=null;
    }
    const server=http.createServer(async(req,res)=>{
        res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
        res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
        if(closing||req.headers.host!==new URL(origin).host||req.socket.remoteAddress!=='127.0.0.1') {
            res.writeHead(403);res.end();return;
        }
        let pathname;
        try{pathname=new URL(req.url,origin).pathname;}catch{res.writeHead(400);res.end();return;}
        try {
            if(pathname.startsWith('/api/')) {
                if(req.method!=='POST'){res.writeHead(405);res.end();return;}
                if(!authorized(req)){res.writeHead(403);res.end();return;}
                const id=req.headers['x-warpdiff-job'];
                if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)){json(res,400,{error:'Invalid preparation request'});return;}
                if(pathname==='/api/cancel'||pathname==='/api/release') {
                    if(active?.id===id)await retire(active);
                    res.writeHead(204);res.end();return;
                }
                if(pathname==='/api/result') {
                    const job=active;
                    if(!job||job.id!==id||!job.result){json(res,404,{error:'Prepared file is no longer available'});return;}
                    if(job.reading){json(res,409,{error:'A file download is already active'});return;}
                    const stopped=()=>{if(!res.writableFinished)job.controller.abort();};res.on('close',stopped);
                    clearTimeout(job.expiry);
                    res.writeHead(200,{'Content-Type':job.result.type,'Content-Length':job.result.size});
                    job.reading=pipeline(createReadStream(job.result.file),res,{signal:job.controller.signal});
                    try{await job.reading;}finally{res.off('close',stopped);job.expiry=setTimeout(()=>retire(job).catch(()=>{}),60000);}
                    return;
                }
                if(pathname!=='/api/prepare'){res.writeHead(404);res.end();return;}
                if(active){json(res,409,{error:'The previous preparation is finishing. Try again shortly.'});return;}
                const length=Number(req.headers['content-length']),kind=req.headers['x-warpdiff-kind'];
                if(!Number.isSafeInteger(length)||length<1||length>INPUT_LIMIT||!['video','audio'].includes(kind)) {
                    res.setHeader('Connection','close');json(res,413,{error:'This prototype accepts video/audio inputs up to 512 MiB'});return;
                }
                // Reserve before the first await: simultaneous requests cannot both enter.
                const controller=new AbortController();
                const job={id,controller,directory:null,running:null,result:null,reading:null,expiry:null};active=job;job.expiry=setTimeout(()=>controller.abort(),10*60*1000);
                let settle;job.running=new Promise(resolve=>{settle=resolve;});
                const disconnected=()=>{if(!res.writableFinished)controller.abort();};res.on('close',disconnected);
                const aborted=()=>controller.abort();req.on('aborted',aborted);
                try {
                    job.directory=await fs.mkdtemp(path.join(os.tmpdir(),'warpdiff-companion-'));
                    if(controller.signal.aborted)throw new Error('Preparation cancelled');
                    const free=await fs.statfs(job.directory);
                    if(free.bavail*free.bsize<length+OUTPUT_LIMIT+64*1024*1024)throw new Error('Not enough temporary disk space');
                    const input=path.join(job.directory,'input.media');let received=0;
                    const bound=new Transform({transform(chunk,encoding,done){
                        received+=chunk.length;
                        done(received>length?new Error('Input exceeds its declared size'):null,chunk);
                    }});
                    await pipeline(req,bound,createWriteStream(input,{flags:'wx',mode:0o600}),{signal:controller.signal});
                    if(received!==length)throw new Error('Input was incomplete');
                    job.result=await processor({input,directory:job.directory,kind,signal:controller.signal,ffmpeg,ffprobe});
                    if(controller.signal.aborted)throw new Error('Preparation cancelled');
                    const {file,...result}=job.result;
                    // Only completed, bounded regular files can become result handles.
                    const stat=await fs.lstat(file);
                    if(!stat.isFile()||stat.size!==result.size||!stat.size||stat.size>OUTPUT_LIMIT||path.dirname(file)!==job.directory)throw new Error('Invalid processor result');
                    json(res,200,{jobId:id,output:result});
                    clearTimeout(job.expiry);job.expiry=setTimeout(()=>retire(job).catch(()=>{}),60000);
                } catch(error) {
                    const cancelled=controller.signal.aborted;
                    job.controller.abort();clearTimeout(job.expiry);
                    if(job.directory)await fs.rm(job.directory,{recursive:true,force:true});
                    if(active===job)active=null;
                    if(!res.destroyed&&!res.headersSent)json(res,422,{error:cancelled?'Preparation was cancelled':error instanceof PreparationError?error.message:'The local tool could not finish this preparation'});
                } finally {
                    res.off('close',disconnected);req.off('aborted',aborted);settle();
                }
                return;
            }
            if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
            let file;
            if(pathname==='/') {
                res.setHeader('X-Frame-Options','DENY');
                res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
                const html=(await fs.readFile(path.join(here,'index.html'),'utf8')).replace('<!-- companion-config -->',
                    '<meta name="companion-token" content="'+token+'">');
                res.writeHead(200,{'Content-Type':mime['.html']});res.end(req.method==='HEAD'?undefined:html);return;
            }
            if(['/client.js','/style.css'].includes(pathname))file=path.join(here,pathname.slice(1));
            else if(pathname.startsWith('/app/')) {
                const name=pathname==='/app/'?'index.html':pathname.slice(5);
                if(!runtime.has(name)){res.writeHead(404);res.end();return;}
                file=path.join(root,name);res.setHeader('X-Frame-Options','SAMEORIGIN');
            }
            if(!file){res.writeHead(404);res.end();return;}
            const stat=await fs.lstat(file);if(!stat.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size});
            if(req.method==='HEAD')res.end();else await pipeline(createReadStream(file),res);
        } catch {
            if(!res.headersSent){res.writeHead(500);res.end('Local helper request failed');}else res.destroy();
        }
    });
    server.requestTimeout=5*60*1000;server.headersTimeout=15000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    origin='http://127.0.0.1:'+server.address().port;
    return {origin,async close(){closing=true;await retire(active);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
        // Test/launcher diagnostics only; secrets and temporary paths are never logged.
        state(){return {active:!!active,processing:!!active&&!active.result};}};
}
async function main() {
    const app=await createCompanion();console.log(JSON.stringify({url:app.origin,prototype:true}));
    let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Could not start the local helper. Install FFmpeg/ffprobe separately and try again.');process.exitCode=1;});
