import { randomBytes, createHash } from 'node:crypto';
import { mkdir, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const signInTools = [
 {name:'paper_sign_in',description:'Start sign-in with an existing KH account. Open the returned browser URL yourself, compare the code, and approve access. Never give the agent your password. The approved session lasts until it expires on the schedule the operator set, or until you revoke it; restarting this local process requires sign-in again.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
 {name:'paper_complete_sign_in',description:'Check browser approval and activate the management session. Call after approval, at least five seconds apart. Credentials are kept inside the local process and never returned to the model.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
];
export const toolResult=(data,isError=false)=>({...(isError?{isError:true}:{}),content:[{type:'text',text:JSON.stringify(data)}]});
export function createOnboarding(config){
 let pending;
 async function request(path,body){
  const base=new URL(config.endpoint);base.pathname=base.pathname.replace(/\/mcp\/?$/,'/onboarding/'+path);
  const r=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(config.timeoutMs)});
  if(!r.ok){void r.body?.cancel().catch(()=>{});throw Object.assign(new Error('Sign-in request failed'),{code:r.status});}
  const text=await r.text();if(text.length>16384)throw new Error('Invalid sign-in response');return JSON.parse(text);
 }
 return {
  async start(){
   if(config.token)return toolResult({success:false,message:'Already configured with a credential. Use a separate MCP configuration without PAPER_TRADING_TOKEN or PAPER_TRADING_TOKEN_FILE to sign in.'},true);
   if(pending && pending.expires>Date.now())return toolResult(pending.public);
   const token='paper_user_'+randomBytes(32).toString('base64url');
   const data=await request('start',{name:'KH local paper trading MCP',tokenHash:createHash('sha256').update(token).digest('hex')});
   if(!/^[A-Za-z0-9_-]{43}$/.test(data.deviceCode)||!/^[A-F0-9]{16}$/.test(data.userCode))throw new Error('Invalid approval response');
   const browser=new URL(config.webUrl || 'https://krh1996.com');browser.hash='/paper-trading/access?approve='+data.userCode;
   pending={token,deviceCode:data.deviceCode,expires:Date.now()+600000,lastPoll:0,public:{success:true,status:'approval_required',url:browser.href,confirmationCode:data.userCode,message:'Open this link yourself, sign in to KH, compare the code, and approve. Then call paper_complete_sign_in. Only approve a request you started.',expiresIn:600}};
   return toolResult(pending.public);
  },
  async complete(){
   if(config.token)return {result:toolResult({success:true,status:'signed_in'})};
   if(!pending||pending.expires<=Date.now()){pending=undefined;return {result:toolResult({success:false,message:'Start sign-in again using paper_sign_in.'},true)};}
   if(Date.now()-pending.lastPoll<5000)return {result:toolResult({success:true,status:'pending',retryAfterSeconds:5})};
   pending.lastPoll=Date.now();const data=await request('poll',{deviceCode:pending.deviceCode});
   if(data.status==='approved'){
    const token=pending.token;pending=undefined;
    return {token,result:toolResult({success:true,status:'signed_in',expiresAt:data.grant?.expiresAt,permissions:data.grant?.scopes,message:'You can now create paper accounts and join competitions. Refresh the tool list.'})};
   }
   if(data.status==='denied'||data.status==='expired')pending=undefined;
   return {result:toolResult({success:true,status:data.status,retryAfterSeconds:5})};
  },
  clear(){pending=undefined;},
 };
}
export async function storeIssuedToken(result,config){
 if(result.isError)return result;
 const payload=JSON.parse(result.content?.find(c=>c.type==='text')?.text || '{}');
 const data=payload.data;
 if(!data?.token)return toolResult({success:!!payload.success,data});
 if(!/^paper_[A-Za-z0-9_-]{43}$/.test(data.token)||!/^[a-f0-9]{24}$/.test(data.key?.id))throw new Error('Invalid issued credential');
 const directory=config.credentialDir || join(homedir(),'.config','kh-paper-trading','tokens');
 await mkdir(directory,{recursive:true,mode:0o700});
 const stat=await lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Credential directory must be private');
 const filename=join(directory,data.key.id+'.token');
 const file=await open(filename,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW||0),0o600);
 try{await file.writeFile(data.token+'\n');}finally{await file.close();}
 return toolResult({success:true,key:data.key,tokenFile:filename,message:'The token was saved privately on this computer. Configure the other local agent with PAPER_TRADING_TOKEN_FILE pointing to this path. Its expiry and independent status are shown in key metadata. Independent tokens survive sign-out and must be revoked separately; session-bound tokens end with their authorizing session.'});
}
