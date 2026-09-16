import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createOnboarding,storeIssuedToken} from '../src/onboarding.js';

test('approval keeps all secrets local, polls conservatively, and activates only an approved session',async t=>{
 const requests=[];let approved=false;
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;requests.push({path:req.url,body:JSON.parse(body)});
  res.setHeader('Content-Type','application/json');
  if(req.url.endsWith('/start'))res.end(JSON.stringify({deviceCode:'d'.repeat(43),userCode:'1234567890ABCDEF'}));
  else res.end(JSON.stringify({status:approved?'approved':'pending',grant:{scopes:['read','trade','manage'],expiresAt:'2027-01-01T00:00:00Z',tokenMaxTtlDays:30,tokenPolicy:{ttlDays:30,maxTtlDays:30}}}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const config={endpoint:new URL(`http://127.0.0.1:${server.address().port}/api/paper/mcp`),timeoutMs:1000};
 const auth=createOnboarding(config);const start=await auth.start();
 assert.match(start.content[0].text,/approval_required/);assert.ok(!JSON.stringify(start).includes('d'.repeat(43)));assert.ok(!JSON.stringify(start).includes('paper_user_'));
 await auth.start();assert.equal(requests.length,1);
 approved=true;const done=await auth.complete();assert.match(done.token,/^paper_user_[A-Za-z0-9_-]{43}$/);assert.ok(!JSON.stringify(done.result).includes(done.token));
 const visible=JSON.parse(done.result.content[0].text);
 assert.equal(visible.tokenMaxTtlDays,30);
 assert.deepEqual(visible.tokenPolicy,{ttlDays:30,maxTtlDays:30});
 assert.equal(requests[0].body.tokenHash,createHash('sha256').update(done.token).digest('hex'));
 assert.equal(requests[1].body.deviceCode,'d'.repeat(43));
});
test('issued token is written once with private permissions and removed from tool content and metadata',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'mcp-issued-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const token='paper_'+'s'.repeat(43);const id='a'.repeat(24);
 const raw={content:[{type:'text',text:JSON.stringify({success:true,data:{token,key:{id,name:'Child'}}})}],structuredContent:{token},_meta:{token}};
 const result=await storeIssuedToken(raw,{credentialDir:directory});assert.ok(!JSON.stringify(result).includes(token));
 const data=JSON.parse(result.content[0].text);assert.equal((await readFile(data.tokenFile,'utf8')).trim(),token);
 assert.equal((await stat(data.tokenFile)).mode&0o077,0);
 await assert.rejects(storeIssuedToken(raw,{credentialDir:directory}),{code:'EEXIST'});
 assert.equal((await readFile(data.tokenFile,'utf8')).trim(),token);
});
