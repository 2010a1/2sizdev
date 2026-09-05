import { execSync } from 'node:child_process';
const ports=[3000,5173,5174];
function run(cmd){try{return execSync(cmd,{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{return '';}}
if(process.platform==='win32'){
  for(const port of ports){const out=run(`netstat -ano -p tcp | findstr :${port}`);const pids=[...out.matchAll(/LISTENING\s+(\d+)/g)].map(m=>m[1]);for(const pid of new Set(pids)){console.log(`Stopping PID ${pid} on port ${port}`);run(`taskkill /PID ${pid} /F`);}}
}else{for(const port of ports){const out=run(`lsof -ti tcp:${port}`);for(const pid of out.trim().split(/\s+/).filter(Boolean)){console.log(`Stopping PID ${pid} on port ${port}`);run(`kill -9 ${pid}`);}}}
