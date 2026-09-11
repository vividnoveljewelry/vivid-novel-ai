const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {randomUUID}=require('node:crypto');
const {pool,migrate}=require('../dist/db');
const agent=require('../dist/customer-service/agent');
const flow=require('../dist/customer-service/collaboration');

test('durable collaboration: six required scenarios, stale drafts, privacy, idempotency and migrations',async t=>{
 const pg=new PGlite();
 const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length || r.affectedRows || 0};};
 // Execute multi-statement migration batches through exec; ordinary queries use Postgres parameters.
 pool.query=query;
 pool.connect=async()=>({query:async(sql,args)=>(!args && /CREATE TABLE (vn_clients|vn_instagram_oauth_states|IF NOT EXISTS vn_runtime_controls)/.test(sql))?pg.exec(sql):query(sql,args),release(){}});
 const original=agent.generateCustomerServiceReply;
 const contexts=[];
 agent.generateCustomerServiceReply=async input=>{contexts.push(input);return input.message.startsWith('Prepare')?["Our designer has reviewed the design. The two portraits can be the focus, with the house as a silhouette and the rose on the shoulder.","We recommend leaving the date off so those details have room to breathe."]:["We’ll keep the design without gemstones, as confirmed."];};
 try{
  await migrate();await migrate();
  assert.equal((await query('SELECT * FROM vn_migrations')).rows.length,3);
  const {id}=await flow.createConversation('Sophie / Milo · TEST','Tester',true);
  await t.test('1 complex feasibility creates CONSULT and Needs Human',async()=>{
   const r=await flow.receive(id,'Can both dogs, our house and a rose fit on this ring?', 'event-1','test');
   assert.deepEqual(r.messages,[]);assert.equal(r.mode,'CONSULT');
   const s=await flow.snapshot(id);assert.equal(s.conversation.needs_human,true);assert.equal(s.consultations[0].status,'open');
  });
  let review;
  await t.test('2 private designer note becomes a polished review draft',async()=>{
   review=await flow.noteAndDraft(id,{note:'two dogs okay; house as silhouette; rose on shoulder; no date.',designerConfirmed:true,feasibility:'feasible_with_changes'},'Designer');
   const s=await flow.snapshot(id);assert.equal(s.conversation.mode,'REVIEW');
   assert.equal(s.messages.filter(m=>m.role==='emily').length,0);
   assert.equal(s.messages.find(m=>m.role==='human_internal').delivery,'internal');
   assert.equal(s.consultations[0].confirmed,true);assert.equal(review.draft[0],flow.NEW_CLIENT_GREETING);assert.match(review.draft[1],/designer has reviewed/);
  });
  await t.test('3 human edits and approves; outbound is approved, never delivered',async()=>{
   const edited=['The two portraits will be the focus, with a simple house silhouette and the rose on the shoulder.'];
   assert.equal((await flow.approve(id,review.id,edited,'Reviewer')).delivery,'approved');
   const s=await flow.snapshot(id);assert.equal(s.messages.at(-1).content,edited[0]);assert.equal(s.messages.at(-1).delivery,'approved');
   assert.equal((await flow.approve(id,review.id,edited,'Reviewer')).duplicate,true);
  });
  await t.test('4 human memory update is present in Emily context over old customer value',async()=>{
   await flow.transaction(async db=>{await flow.lock(db,id);await flow.putFact(db,id,'gemstone_preference','diamond','customer',false,'Customer requested diamond','customer');});
   await flow.updateFact(id,{key:'gemstone_preference',value:'none',evidence:'Customer correction verified by staff'},'Staff');
   await flow.setMode(id,'EMILY','Staff');await flow.reply(id);
   const ctx=JSON.parse(contexts.at(-1).trustedContext);assert.equal(ctx.facts.find(f=>f.key==='gemstone_preference').value,'none');
  });
  await t.test('5 HUMAN blocks Emily at service and SQL; Return restores eligibility',async()=>{
   await flow.setMode(id,'HUMAN','Staff');const before=contexts.length;
   assert.deepEqual((await flow.reply(id)).messages,[]);assert.equal(contexts.length,before);
   await assert.rejects(query("INSERT INTO vn_messages(id,conversation_id,role,content,actor,delivery) VALUES($1,$2,'emily','Forbidden','emily','sent_simulated')",[randomUUID(),id]),/blocked/);
   await flow.humanSend(id,'I am joining personally to help.','Staff');
   await flow.setMode(id,'EMILY','Staff');assert.ok((await flow.reply(id)).messages.length);
   await assert.rejects(flow.humanSend(id,'Wrong mode','Staff'),/HUMAN/);
  });
  await t.test('6 AI cannot overwrite human-confirmed final quote; SQL trigger also protects it',async()=>{
   await flow.updateFact(id,{key:'final_quote',value:6200,evidence:'Approved final quotation Q-6200'},'Staff');
   const accepted=await flow.transaction(async db=>{await flow.lock(db,id);return flow.putFact(db,id,'final_quote',5000,'ai',false,'Generated summary','emily');});
   assert.equal(accepted,false);assert.equal((await flow.snapshot(id)).facts.find(f=>f.key==='final_quote').value,6200);
   await assert.rejects(query("UPDATE vn_facts SET value='5000',source='ai',confirmed=false,authority=1 WHERE conversation_id=$1 AND key='final_quote'",[id]),/Lower authority/);
  });
  await t.test('customer promise cannot mark deposit paid; internal messages cannot be outbound',async()=>{
   await flow.receive(id,'I will pay the deposit tomorrow','event-payment','test');
   assert.equal((await flow.snapshot(id)).conversation.stage,'NEW');
   await assert.rejects(flow.stage(id,'DEPOSIT_PAID','Customer promised','Staff'),/evidence/);
   await assert.rejects(query("INSERT INTO vn_messages(id,conversation_id,role,content,actor,delivery) VALUES($1,$2,'human_internal','secret','Staff','approved')",[randomUUID(),id]),/check constraint/);
  });
  await t.test('new fact or customer turn invalidates reviews; duplicate ingress is not replayed',async()=>{
   const r=await flow.noteAndDraft(id,{note:'Please draft a short reply',designerConfirmed:false},'Staff');
   await flow.updateFact(id,{key:'budget',value:5000,evidence:'Confirmed budget'},'Staff');
   await assert.rejects(flow.approve(id,r.id,['Old draft'],'Staff'),/stale/);
   const count=(await flow.snapshot(id)).messages.length;
   assert.equal((await flow.receive(id,'same event','event-1','test')).duplicate,true);
   assert.equal((await flow.snapshot(id)).messages.length,count);
  });
  await t.test('persisted greeting appears once; references and kill switch survive reload',async()=>{
   agent.generateCustomerServiceReply=async()=>['14K rings start from US$2,400, and 18K rings start from US$3,000.','Final pricing depends on the design, materials, gemstones, and complexity, and is confirmed after our designers review your idea—what kind of story or imagery would you like the ring to express?'];
   const {id:newId}=await flow.createConversation('Greeting regression','Tester',true);
   const first=await flow.receive(newId,'How much is a ring?','greeting-first','Tester');
   assert.equal(first.messages[0],flow.NEW_CLIENT_GREETING);assert.equal(first.messages.length,3);
   assert.match(first.messages[1],/2,400.*3,000/);
   const second=await flow.receive(newId,'I like flowers','greeting-second','Tester');
   assert.ok(!second.messages.includes(flow.NEW_CLIENT_GREETING));
   assert.equal((await flow.snapshot(newId)).messages.filter(m=>m.content===flow.NEW_CLIENT_GREETING).length,1);
   await flow.addReference(newId,{name:'Sketch placeholder'},'Tester');
   await flow.addReference(newId,{name:'Inspiration',url:'https://example.com/reference'},'Tester');
   await assert.rejects(flow.addReference(newId,{name:'Unsafe',url:'javascript:alert(1)'},'Tester'),/HTTPS/);
   assert.equal((await flow.snapshot(newId)).references.length,2);
   const controls=require('../dist/customer-service/runtime-controls');
   assert.equal(await controls.getAutoRepliesEnabled(),false);
   await controls.setAutoRepliesEnabled(true,'Tester');assert.equal((await controls.runtimeStatus()).autoRepliesEnabled,true);
   await controls.setAutoRepliesEnabled(false,'Tester');assert.equal(await controls.getAutoRepliesEnabled(),false);
  });
  await t.test('ownership change during generation suppresses pending Emily output',async()=>{
   await flow.setMode(id,'EMILY','Staff');
   agent.generateCustomerServiceReply=async()=>{await flow.setMode(id,'HUMAN','Other staff');return ['Must not send'];};
   const r=await flow.reply(id);assert.equal(r.stale,true);assert.deepEqual(r.messages,[]);
  });
 }finally{agent.generateCustomerServiceReply=original;await pg.close();}
});
