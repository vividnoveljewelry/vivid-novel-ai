const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const express=require('express');
const {pool}=require('../dist/db');
const oauth=require('../dist/instagram-oauth');
const {admin}=require('../dist/admin/routes');

test('OAuth security, verified identity, encrypted storage, refresh and paused pilot',async t=>{
 process.env.ADMIN_TOKEN='test-admin-'+ 'a'.repeat(40);
 process.env.INSTAGRAM_APP_ID='123456';
 process.env.INSTAGRAM_APP_SECRET='private-app-secret-test';
 process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const pg=new PGlite();
 await pg.exec(readFileSync('db/migrations/002_runtime_controls.sql','utf8'));
 await pg.exec(readFileSync('db/migrations/003_instagram_oauth.sql','utf8'));
 const query=async(sql,args)=>{if(sql.includes('pg_try_advisory_xact_lock'))return {rows:[{locked:true}]};const r=await pg.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length};};
 pool.query=query;pool.connect=async()=>({query,release(){}});
 const app=express();app.use(express.json());app.use('/admin',admin);app.get('/auth/instagram/callback',oauth.instagramCallback);
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port, realFetch=global.fetch;
 const headers={authorization:'Bearer '+process.env.ADMIN_TOKEN,'content-type':'application/json'};
 let calls=[], username='vivid.novel', permissions=oauth.SCOPES.join(','), fail=false, accountType='BUSINESS', id='98765';
 const secret='private-instagram-long-token-test';
 global.fetch=async(url,init={})=>{
  if(String(url).startsWith(base))return realFetch(url,init);
  calls.push({url:new URL(url),init});
  if(fail)throw new Error(secret+process.env.INSTAGRAM_APP_SECRET);
  const path=new URL(url).pathname;
  let data;
  if(path==='/oauth/access_token'){
   assert.equal(init.method,'POST');assert.equal(init.body.get('grant_type'),'authorization_code');
   assert.equal(init.body.get('redirect_uri'),oauth.REDIRECT_URI);assert.equal(init.body.get('client_secret'),process.env.INSTAGRAM_APP_SECRET);
   data={data:[{access_token:'short-token-test',user_id:'111',permissions}]};
  }else if(path==='/access_token'||path==='/refresh_access_token'){
   assert.equal(new URL(url).searchParams.get('grant_type'),path==='/access_token'?'ig_exchange_token':'ig_refresh_token');
   data={access_token:secret,token_type:'bearer',expires_in:5183944};
  }else{
   assert.equal(new URL(url).host,'graph.instagram.com');assert.equal(path,'/v26.0/me');
   assert.equal(new URL(url).searchParams.get('fields'),'id,user_id,username,account_type');
   data={data:[{id:'111',user_id:id,username,account_type:accountType}]};
  }
  return new Response(JSON.stringify(data),{status:200});
 };
 const begin=async()=>{
  const response=await realFetch(base+'/admin/api/instagram/connect',{method:'POST',headers,body:'{}'});
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
  const url=new URL((await response.json()).authorizationUrl);
  assert.equal(url.origin+url.pathname,'https://www.instagram.com/oauth/authorize');
  assert.equal(url.searchParams.get('scope'),oauth.SCOPES.join(','));
  assert.equal(url.searchParams.get('redirect_uri'),oauth.REDIRECT_URI);
  return {state:url.searchParams.get('state'),cookie:cookie.split(';')[0]};
 };
 const callback=(s,extra='code=valid-code')=>realFetch(base+'/auth/instagram/callback?state='+s.state+'&'+extra,{headers:{cookie:s.cookie}});
 try{
  await t.test('admin protection and missing configuration',async()=>{
   assert.equal((await realFetch(base+'/admin/api/instagram/connect',{method:'POST',headers:{origin:base}})).status,401);
   assert.equal((await realFetch(base+'/admin/api/instagram')).status,401);
   assert.equal((await realFetch(base+'/admin/api/instagram/connect',{method:'POST',headers:{cookie:'vn_admin='+process.env.ADMIN_TOKEN,origin:'https://evil.example'}})).status,403);
   delete process.env.INSTAGRAM_APP_SECRET;
   const missing=await realFetch(base+'/admin/api/instagram/connect',{method:'POST',headers,body:'{}'});
   assert.equal(missing.status,503);assert.deepEqual((await missing.json()).missingVariables,['INSTAGRAM_APP_SECRET']);
   process.env.INSTAGRAM_APP_SECRET='private-app-secret-test';
   const paused=await realFetch(base+'/admin/api/runtime/auto-replies',{method:'POST',headers,body:'{"enabled":true}'});
   assert.equal(paused.status,409);
   assert.equal((await (await realFetch(base+'/admin/api/runtime',{headers})).json()).autoRepliesEnabled,false);
  });
  await t.test('missing, wrong-browser, expired and rotated-admin states reject without Meta calls',async()=>{
   assert.equal((await realFetch(base+'/auth/instagram/callback')).status,400);
   const s=await begin();
   assert.equal((await callback({...s,cookie:'__Secure-vn_ig_oauth='+'0'.repeat(64)})).status,400);
   await query("UPDATE vn_instagram_oauth_states SET expires_at=now()-interval '1 second'");
   assert.equal((await callback(s)).status,400);
   const rotated=await begin();process.env.ADMIN_TOKEN+='x';
   assert.equal((await callback(rotated)).status,400);process.env.ADMIN_TOKEN=process.env.ADMIN_TOKEN.slice(0,-1);
   assert.equal(calls.length,0);
  });
  await t.test('denial consumes state and reflects no query input',async()=>{
   const s=await begin(), response=await callback(s,'error_description='+encodeURIComponent(secret));
   assert.equal(response.status,400);assert.ok(!(await response.text()).includes(secret));
   assert.equal((await callback(s)).status,400);assert.equal(calls.length,0);
  });
  await t.test('wrong professional identity and denied permissions cannot persist a token',async()=>{
   username='other.account';assert.equal((await callback(await begin())).status,400);
   username='vivid.novel';accountType='PERSONAL';assert.equal((await callback(await begin())).status,400);
   accountType='BUSINESS';permissions=oauth.SCOPES[0];
   assert.equal((await callback(await begin())).status,502);permissions=oauth.SCOPES.join(',');
   assert.equal((await query('SELECT * FROM vn_instagram_connection')).rowCount,0);
  });
  await t.test('success encrypts, binds API identity and consumes state exactly once',async()=>{
   const s=await begin(), stored=(await query('SELECT * FROM vn_instagram_oauth_states WHERE state_hash=$1',[createHash('sha256').update(s.state).digest('hex')])).rows[0];
   assert.notEqual(stored.state_hash,s.state);assert.notEqual(stored.browser_hash,s.cookie.split('=')[1]);
   const responses=await Promise.all([callback(s),callback(s)]);
   assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
   for(const r of responses)assert.ok(!(await r.text()).includes(secret));
   const row=(await query('SELECT * FROM vn_instagram_connection')).rows[0];
   assert.equal(row.instagram_user_id,'98765');assert.ok(!row.token_ciphertext.includes(secret));
   assert.equal(oauth.decryptToken(row.token_ciphertext),secret);
   const damaged=row.token_ciphertext.split('.');damaged[2]=randomBytes(16).toString('base64');
   assert.throws(()=>oauth.decryptToken(damaged.join('.')));
   const status=await (await realFetch(base+'/admin/api/instagram',{headers})).text();
   assert.ok(!status.includes(secret));assert.ok(!status.includes(row.token_ciphertext));assert.match(status,/"connected"/);
  });
  await t.test('failed reconnect preserves existing encrypted token and never leaks provider errors',async()=>{
   const before=(await query('SELECT token_ciphertext FROM vn_instagram_connection')).rows[0].token_ciphertext;
   fail=true;const r=await callback(await begin());assert.equal(r.status,502);
   const body=await r.text();assert.ok(!body.includes(secret));assert.ok(!body.includes(process.env.INSTAGRAM_APP_SECRET));fail=false;
   id='99999';assert.equal((await callback(await begin())).status,409);id='98765';
   assert.equal((await query('SELECT token_ciphertext FROM vn_instagram_connection')).rows[0].token_ciphertext,before);
  });
  await t.test('refresh requires age and expiry, renews encrypted token, and reports failure safely',async()=>{
   calls=[];await oauth.refreshInstagramToken();assert.equal(calls.length,0);
   await query("UPDATE vn_instagram_connection SET expires_at=now()+interval '3 days'");
   await oauth.refreshInstagramToken();assert.equal(calls.length,0);
   await query("UPDATE vn_instagram_connection SET issued_at=now()-interval '2 days'");
   await oauth.refreshInstagramToken();assert.equal(calls.length,1);
   assert.equal(calls[0].url.pathname,'/refresh_access_token');
   let row=(await query('SELECT * FROM vn_instagram_connection')).rows[0];assert.equal(oauth.decryptToken(row.token_ciphertext),secret);
   await query("UPDATE vn_instagram_connection SET issued_at=now()-interval '2 days',expires_at=now()+interval '3 days'");
   fail=true;await oauth.refreshInstagramToken();fail=false;
   assert.equal((await query('SELECT refresh_status FROM vn_instagram_connection')).rows[0].refresh_status,'failed');
   calls=[];await query("UPDATE vn_instagram_connection SET expires_at=now()-interval '1 second'");
   await oauth.refreshInstagramToken();assert.equal(calls.length,0);
  });
 }finally{global.fetch=realFetch;await new Promise(r=>server.close(r));await pg.close();}
});
