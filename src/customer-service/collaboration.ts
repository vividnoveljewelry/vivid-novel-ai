import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { pool } from '../db';
import { generateCustomerServiceReply } from './agent';
import { transitionOrder, OrderStage } from './order-flow';

export class WorkflowError extends Error { constructor(public status: number, message: string) { super(message); } }
export const modes = ['EMILY','CONSULT','REVIEW','HUMAN'];
export const factKeys = ['name','channel_handle','email','phone','location','tags','preferred_contact','language','subject','jewelry_type','important_elements','references','gemstone_preference','budget','occasion','required_date','preferences','final_quote','payment_status','deposit_status','production_status','feasibility','designer_notes','timeline_status','suggested_price'];
export function requiredText(v: unknown, max = 6000): string {
 if (typeof v !== 'string' || !v.trim() || v.length > max) throw new WorkflowError(400, 'A non-empty text value is required (max ' + max + ' characters)');
 return v.trim();
}
export async function transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
 const db = await pool.connect();
 try { await db.query('BEGIN'); const r = await fn(db); await db.query('COMMIT'); return r; }
 catch(e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
}
export async function lock(db: PoolClient, id: string) {
 if (!/^[0-9a-f-]{36}$/i.test(id)) throw new WorkflowError(400,'Invalid conversation ID');
 const r = await db.query('SELECT * FROM vn_conversations WHERE id=$1 FOR UPDATE',[id]);
 if (!r.rowCount) throw new WorkflowError(404,'Conversation not found'); return r.rows[0];
}
export async function audit(db: PoolClient, id: string, event: string, actor: string, detail: unknown) {
 await db.query('INSERT INTO vn_audit(conversation_id,event,actor,detail) VALUES($1,$2,$3,$4)',[id,event,actor,JSON.stringify(detail)]);
}
async function changed(db: PoolClient, id: string) {
 await db.query('UPDATE vn_conversations SET version=version+1,updated_at=now() WHERE id=$1',[id]);
 await db.query("UPDATE vn_reviews SET status='stale' WHERE conversation_id=$1 AND status='pending'",[id]);
}
async function message(db: PoolClient, id: string, role: string, content: string, actor: string, delivery: string, externalId?: string) {
 const mid = randomUUID();
 await db.query('INSERT INTO vn_messages(id,conversation_id,role,content,actor,delivery,external_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[mid,id,role,content,actor,delivery,externalId || null]);
 return mid;
}
export async function createConversation(name: string, actor: string, demo = false) {
 return transaction(async db => {
  const cid=randomUUID(), id=randomUUID();
  await db.query('INSERT INTO vn_clients(id,name,demo) VALUES($1,$2,$3)',[cid,requiredText(name,200),demo]);
  await db.query('INSERT INTO vn_conversations(id,client_id) VALUES($1,$2)',[id,cid]);
  await db.query('INSERT INTO vn_commissions(id,conversation_id) VALUES($1,$2)',[randomUUID(),id]);
  await putFact(db,id,'name',name,'human',true,'Staff created client record',actor);
  await audit(db,id,'created',actor,{demo}); return {id};
 });
}
export async function putFact(db: PoolClient,id:string,key:string,value:unknown,source:string,confirmed:boolean,evidence:string,actor:string,messageId?:string) {
 if (!factKeys.includes(key) || value === undefined || JSON.stringify(value).length > 6000) throw new WorkflowError(400,'Invalid fact');
 requiredText(evidence);
 const authority = ['system','shopify'].includes(source) && confirmed ? 4 : ['human','designer'].includes(source) && confirmed ? 3 : source==='customer' ? 2 : 1;
 const old = (await db.query('SELECT * FROM vn_facts WHERE conversation_id=$1 AND key=$2',[id,key])).rows[0];
 if (old && old.authority > authority) {
  await audit(db,id,'fact_rejected',actor,{key,attemptedValue:value,source,evidence,retained:old.value}); return false;
 }
 await db.query(`INSERT INTO vn_facts(id,conversation_id,key,value,source,confirmed,authority,evidence,actor,message_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(conversation_id,key) DO UPDATE SET
 value=excluded.value,source=excluded.source,confirmed=excluded.confirmed,authority=excluded.authority,evidence=excluded.evidence,actor=excluded.actor,message_id=excluded.message_id,updated_at=now()`,
 [randomUUID(),id,key,JSON.stringify(value),source,confirmed,authority,evidence,actor,messageId || null]);
 await audit(db,id,'fact_updated',actor,{key,before:old || null,value,source,confirmed,evidence}); return true;
}
export async function updateFact(id:string, body:any, actor:string) {
 return transaction(async db => {
  await lock(db,id);
  // Staff may explicitly record a low-authority inference; never silently elevate it.
  // Shopify/system confirmation is reserved for verified adapters, not admin request fields.
  const source=body.source || 'human';
  if(!['human','ai','customer'].includes(source)) throw new WorkflowError(400,'Only human, customer or AI provenance can be recorded manually');
  const accepted=await putFact(db,id,body.key,body.value,source,source==='human',requiredText(body.evidence),actor);
  if(accepted) await changed(db,id); return {accepted};
 });
}
export async function setMode(id:string, mode:string, actor:string) {
 if (!modes.includes(mode)) throw new WorkflowError(400,'Invalid mode');
 return transaction(async db => {
  const c=await lock(db,id);
  await db.query('UPDATE vn_conversations SET mode=$2,owner=$3,needs_human=$4 WHERE id=$1',[id,mode,mode==='HUMAN'?actor:null,mode!=='EMILY']);
  await changed(db,id); await audit(db,id,'mode_changed',actor,{from:c.mode,to:mode}); return {mode};
 });
}
export async function snapshot(id:string) {
 const c=(await pool.query(`SELECT c.*,cl.name,cl.channel,cl.handle,cl.language,cl.demo,co.stage FROM vn_conversations c JOIN vn_clients cl ON cl.id=c.client_id JOIN vn_commissions co ON co.conversation_id=c.id WHERE c.id=$1`,[id])).rows[0];
 if (!c) throw new WorkflowError(404,'Conversation not found');
 const [messages,facts,consultations,reviews,history,references]=await Promise.all([
  pool.query('SELECT * FROM vn_messages WHERE conversation_id=$1 ORDER BY sequence',[id]),
  pool.query('SELECT * FROM vn_facts WHERE conversation_id=$1 ORDER BY key',[id]),
  pool.query('SELECT * FROM vn_consultations WHERE conversation_id=$1 ORDER BY created_at DESC',[id]),
  pool.query('SELECT * FROM vn_reviews WHERE conversation_id=$1 ORDER BY created_at DESC',[id]),
  pool.query('SELECT * FROM vn_audit WHERE conversation_id=$1 ORDER BY id DESC LIMIT 100',[id]),
  pool.query('SELECT * FROM vn_references WHERE conversation_id=$1 ORDER BY created_at',[id]),
 ]);
 const intent=messages.rows.filter(m=>m.role==='customer').slice(-1)[0]?.content || 'No customer message yet';
 return {conversation:c,messages:messages.rows,facts:facts.rows,consultations:consultations.rows,reviews:reviews.rows,audit:history.rows,references:references.rows,
 briefing:{intent,keyFacts:facts.rows.map(f=>`${f.key}: ${JSON.stringify(f.value)} (${f.source})`),decisionNeeded:consultations.rows.find(x=>x.status==='open')?.question || (c.mode==='REVIEW'?'Edit and approve the pending reply':c.mode==='HUMAN'?'Human owns the conversation':'None')}};
}
function context(s:Awaited<ReturnType<typeof snapshot>>, note?:string) {
 return JSON.stringify({facts:s.facts,stage:s.conversation.stage,consultations:s.consultations,references:s.references,privateNote:note,
 task:note?'Draft a polished customer reply based on this private staff input. It will require human approval. Do not expose internal notes or unsupported claims.':'Reply using current facts, not stale history.'});
}
function publicHistory(s:Awaited<ReturnType<typeof snapshot>>) {
 // Approved messages have NOT been delivered; only simulated exchanges are included as simulated context.
 return s.messages.filter(m=>m.role==='customer'||(m.delivery==='sent_simulated'&&['emily','human_customer_facing'].includes(m.role))).slice(-60).map(m=>({role:(m.role==='customer'?'user':'assistant') as 'user'|'assistant',content:m.content}));
}
export const NEW_CLIENT_GREETING = 'Hello, thank you for your message!';
function firstContact(messages:string[], s:{messages:Array<{role:string}>}) {
 // Persisted outbound records, including approved drafts, survive history truncation and reloads.
 const first=!s.messages.some(m=>['emily','human_customer_facing'].includes(m.role));
 const body=messages.map(m=>m.replaceAll(NEW_CLIENT_GREETING,'').trim()).filter(Boolean);
 const result=first?[NEW_CLIENT_GREETING,...body]:body;
 return result.length>3?[...result.slice(0,2),result.slice(2).join(' ')]:result;
}
export function needsConsult(text:string) {
 return /feasib|fit|possible|can (you|we)|could (you|we)|designer|portrait|silhouette|two dogs|both dogs|complex|deadline|rush|refund|warranty|damage|chipped|quote|paid|payment|shipping|delivered|duties|customs|可|能|设计|付款|报价|交期|维修/i.test(text);
}
export async function receive(id:string,text:string,externalId:string,actor:string) {
 text=requiredText(text); externalId=requiredText(externalId,200);
 const inserted=await transaction(async db=>{
  const c=await lock(db,id);
  const existing=await db.query('SELECT id FROM vn_messages WHERE conversation_id=$1 AND external_id=$2',[id,externalId]);
  if (existing.rowCount) return false;
  const mid=await message(db,id,'customer',text,actor,'received',externalId);
  const none=text.match(/(?:no|without|don't want|do not want)\s+(?:a\s+|any\s+)?(?:diamond|gemstone)s?/i);
  if(none) await putFact(db,id,'gemstone_preference','none','customer',false,none[0],actor,mid);
  const budget=text.match(/(?:my budget is|budget[: ]+)\s*\$?([0-9]+(?:\.[0-9]+)?)/i);
  if(budget) await putFact(db,id,'budget',Number(budget[1]),'customer',false,budget[0],actor,mid);
  await db.query('UPDATE vn_conversations SET unread=unread+1 WHERE id=$1',[id]);
  await changed(db,id);
  if(c.mode==='EMILY' && needsConsult(text)) {
   await db.query("UPDATE vn_conversations SET mode='CONSULT',needs_human=true WHERE id=$1",[id]);
   await db.query('INSERT INTO vn_consultations(id,conversation_id,question) VALUES($1,$2,$3)',[randomUUID(),id,text]);
   await audit(db,id,'consult_requested','emily',{question:text});
  }
  await audit(db,id,'customer_received',actor,{messageId:mid}); return true;
 });
 if(!inserted) return {status:'ok',messages:[],duplicate:true};
 return reply(id);
}
export async function reply(id:string) {
 const s=await snapshot(id);
 if(s.conversation.mode!=='EMILY') return {status:'ok',messages:[],mode:s.conversation.mode,needsHuman:s.conversation.needs_human};
 const last=s.messages.filter(m=>m.role==='customer').slice(-1)[0];
 const messages=firstContact(await generateCustomerServiceReply({message:last?.content || 'Continue naturally using the current confirmed client memory.',history:publicHistory(s).slice(0,-1),trustedContext:context(s)}),s);
 return transaction(async db=>{
  const c=await lock(db,id);
  if(c.mode!=='EMILY'||c.version!==s.conversation.version) return {status:'ok',messages:[],mode:c.mode,stale:true};
  for(const text of messages) await message(db,id,'emily',text,'emily','sent_simulated');
  await changed(db,id); await audit(db,id,'emily_simulated','emily',{count:messages.length});
  return {status:'ok',messages,delivery:'sent_simulated'};
 });
}
export async function noteAndDraft(id:string,body:any,actor:string) {
 const note=requiredText(body.note);
 const mid=await transaction(async db=>{
  const c=await lock(db,id);
  const mid=await message(db,id,'human_internal',note,actor,'internal');
  if(body.designerConfirmed===true) {
   await db.query("UPDATE vn_consultations SET status='answered',answer_message_id=$2,reviewed_by=$3,confirmed=true WHERE conversation_id=$1 AND status='open'",[id,mid,actor]);
   if(!(await db.query('SELECT id FROM vn_consultations WHERE answer_message_id=$1',[mid])).rowCount)
    await db.query("INSERT INTO vn_consultations(id,conversation_id,question,status,answer_message_id,reviewed_by,confirmed) VALUES($1,$2,'Staff design review','answered',$3,$4,true)",[randomUUID(),id,mid,actor]);
  }
  for(const key of ['feasibility','timeline_status','suggested_price']) if(body[key]) {
   if(key==='feasibility'&&!['feasible','feasible_with_changes','not_recommended'].includes(body[key])) throw new WorkflowError(400,'Invalid feasibility');
   if(key==='timeline_status'&&!['normal','extended','needs_review'].includes(body[key])) throw new WorkflowError(400,'Invalid timeline');
   if(key==='feasibility'&&body.designerConfirmed!==true) throw new WorkflowError(400,'Confirm actual designer review first');
   await putFact(db,id,key,body[key],body.designerConfirmed===true?'designer':'human',true,note,actor,mid);
  }
  await changed(db,id);
  if(c.mode!=='HUMAN') await db.query("UPDATE vn_conversations SET mode='REVIEW',needs_human=true WHERE id=$1",[id]);
  await audit(db,id,'private_note',actor,{messageId:mid,designerConfirmed:body.designerConfirmed===true}); return mid;
 });
 // Note survives provider errors; retry can use a new note, without ever sending raw shorthand.
 const s=await snapshot(id);
 const draft=firstContact(await generateCustomerServiceReply({message:'Prepare the customer-facing reply from the private team guidance in context.',history:publicHistory(s),trustedContext:context(s,note)}),s);
 return transaction(async db=>{
  const c=await lock(db,id),rid=randomUUID();
  if(c.version!==s.conversation.version) throw new WorkflowError(409,'Conversation changed while drafting. Draft again using latest context.');
  await db.query('INSERT INTO vn_reviews(id,conversation_id,note_message_id,draft,context_version) VALUES($1,$2,$3,$4,$5)',[rid,id,mid,JSON.stringify(draft),c.version]);
  await audit(db,id,'review_drafted',actor,{reviewId:rid}); return {id:rid,draft,mode:c.mode};
 });
}
export async function approve(id:string,rid:string,messages:unknown,actor:string) {
 if(!Array.isArray(messages)||!messages.length||messages.length>6) throw new WorkflowError(400,'Provide 1–6 edited message bubbles');
 const edited=messages.map(m=>requiredText(m));
 return transaction(async db=>{
  const c=await lock(db,id);
  const r=(await db.query('SELECT * FROM vn_reviews WHERE id=$1 AND conversation_id=$2 FOR UPDATE',[rid,id])).rows[0];
  if(!r) throw new WorkflowError(404,'Review not found');
  if(r.status==='approved') return {status:'ok',messages:[],duplicate:true,delivery:'approved'};
  if(c.mode!=='REVIEW'||r.status!=='pending'||r.context_version!==c.version) throw new WorkflowError(409,'Review is stale or conversation is not in REVIEW. Generate a fresh draft.');
  const prior=await db.query('SELECT role FROM vn_messages WHERE conversation_id=$1',[id]);
  const approved=firstContact(edited,{messages:prior.rows});
  for(const text of approved) await message(db,id,'emily',text,actor,'approved');
  await db.query("UPDATE vn_reviews SET status='approved',edited=$2,approved_by=$3,approved_at=now() WHERE id=$1",[rid,JSON.stringify(approved),actor]);
  await changed(db,id); await db.query('UPDATE vn_conversations SET needs_human=false WHERE id=$1',[id]);
  await audit(db,id,'review_approved',actor,{reviewId:rid,messages:approved,delivery:'approved'});
  return {status:'ok',messages:approved,delivery:'approved'};
 });
}
export async function humanSend(id:string,text:string,actor:string) {
 return transaction(async db=>{
  const c=await lock(db,id); if(c.mode!=='HUMAN') throw new WorkflowError(409,'Direct replies require HUMAN mode');
  await message(db,id,'human_customer_facing',requiredText(text),actor,'approved');
  await changed(db,id); await audit(db,id,'human_outbound_approved',actor,{delivery:'approved'}); return {delivery:'approved'};
 });
}
export async function stage(id:string,target:OrderStage,evidence:string,actor:string) {
 return transaction(async db=>{
  await lock(db,id);
  const old=(await db.query('SELECT * FROM vn_commissions WHERE conversation_id=$1',[id])).rows[0];
  let next;
  try { next=transitionOrder({stage:old.stage,brief:{},designRefinements:old.design_refinements,finalAdjustments:old.final_adjustments},{target,source:'human',evidenceId:requiredText(evidence)}); }
  catch(e) { throw new WorkflowError(409,(e as Error).message + '. System-only stages await verified integration events.'); }
  await db.query('UPDATE vn_commissions SET stage=$2,design_refinements=$3,final_adjustments=$4 WHERE conversation_id=$1',[id,next.stage,next.designRefinements,next.finalAdjustments]);
  await changed(db,id); await audit(db,id,'stage_changed',actor,{from:old.stage,to:target,evidence}); return next;
 });
}

export async function addReference(id:string,body:any,actor:string) {
 const name=requiredText(body.name,200);
 const url=body.url ? requiredText(body.url,2000) : null;
 if(url) { try { if(new URL(url).protocol!=='https:') throw new Error(); } catch { throw new WorkflowError(400,'Use a valid HTTPS reference link'); } }
 return transaction(async db=>{
  await lock(db,id);
  const rid=randomUUID();
  await db.query('INSERT INTO vn_references(id,conversation_id,name,url,source) VALUES($1,$2,$3,$4,$5)',[rid,id,name,url,'human']);
  await changed(db,id);await audit(db,id,'reference_added',actor,{referenceId:rid,name});
  return {id:rid};
 });
}

