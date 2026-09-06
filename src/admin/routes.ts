import { Router, Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { pool } from '../db';
import * as flow from '../customer-service/collaboration';
import { dashboard } from './view';

function equal(a:string,b:string) { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length&&timingSafeEqual(x,y); }
export function authorized(req:Request) {
 const expected=process.env.ADMIN_TOKEN || '';
 if(expected.length<32) return false;
 const bearer=req.headers.authorization?.replace(/^Bearer /,'');
 const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('vn_admin='))?.slice(9);
 return equal(bearer || cookie || '',expected);
}
export const admin=Router();
admin.use((_req,res,next)=>{
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 next();
});
admin.get('/',(_req,res)=>res.type('html').send(dashboard));
admin.get('/app.js',(_req,res)=>res.sendFile('src/admin/app.js',{root:process.cwd()}));
admin.use((req,res,next)=>{
 if(!['GET','HEAD'].includes(req.method)&&!req.headers.authorization) {
  const origin=req.headers.origin;
  if(!origin||new URL(origin).host!==req.get('host')) {res.status(403).json({error:'Same-origin request required'});return;}
 }
 next();
});
const attempts=new Map<string,{count:number,at:number}>();
admin.post('/login',(req,res)=>{
 const key=req.ip || 'unknown', now=Date.now();
 let a=attempts.get(key); if(!a||now-a.at>60000) {a={count:0,at:now};attempts.set(key,a);}
 if(++a.count>10) {res.status(429).json({error:'Try again in one minute'});return;}
 const token=typeof req.body.token==='string'?req.body.token:'';
 if((process.env.ADMIN_TOKEN||'').length<32 || !equal(token,process.env.ADMIN_TOKEN||'')) {res.status(401).json({error:'Invalid admin token or admin not configured'});return;}
 res.cookie('vn_admin',token,{httpOnly:true,secure:process.env.NODE_ENV==='production'||req.headers['x-forwarded-proto']==='https',sameSite:'strict',path:'/admin',maxAge:8*60*60*1000});
 res.json({status:'ok'});
});
admin.use((req,res,next)=>{if(!authorized(req)){res.status(401).json({error:'Admin authentication required'});return;}next();});
admin.post('/logout',(_req,res)=>{res.clearCookie('vn_admin',{path:'/admin'});res.json({status:'ok'});});
const route=(fn:(req:any)=>Promise<unknown>)=>async(req:any,res:any)=>{
 try{res.json(await fn(req));}catch(e){const err=e as Error;res.status(e instanceof flow.WorkflowError?e.status:500).json({error:e instanceof flow.WorkflowError?err.message:'Operation failed; private input was retained if already saved. Please retry.'});console.error('Admin operation failed',err.message);}
};
const actor=(req:Request)=>flow.requiredText(req.headers['x-staff-name'] || 'Staff (shared admin token)',120);
admin.get('/api/conversations',route(async()=>({conversations:(await pool.query(`SELECT c.*,cl.name,cl.demo,co.stage FROM vn_conversations c JOIN vn_clients cl ON cl.id=c.client_id JOIN vn_commissions co ON co.conversation_id=c.id ORDER BY c.needs_human DESC,c.updated_at DESC LIMIT 200`)).rows})));
admin.post('/api/conversations',route(req=>flow.createConversation(req.body.name,actor(req),req.body.demo===true)));
admin.get('/api/conversations/:id',route(req=>flow.snapshot(req.params.id)));
admin.post('/api/conversations/:id/read',route(async req=>{await pool.query('UPDATE vn_conversations SET unread=0 WHERE id=$1',[req.params.id]);return {status:'ok'};}));
admin.post('/api/conversations/:id/mode',route(req=>flow.setMode(req.params.id,req.body.mode,actor(req))));
admin.post('/api/conversations/:id/facts',route(req=>flow.updateFact(req.params.id,req.body,actor(req))));
admin.post('/api/conversations/:id/customer',route(req=>flow.receive(req.params.id,req.body.message,req.body.externalId,actor(req))));
admin.post('/api/conversations/:id/reply',route(req=>flow.reply(req.params.id)));
admin.post('/api/conversations/:id/notes',route(req=>flow.noteAndDraft(req.params.id,req.body,actor(req))));
admin.post('/api/conversations/:id/reviews/:rid/approve',route(req=>flow.approve(req.params.id,req.params.rid,req.body.messages,actor(req))));
admin.post('/api/conversations/:id/human-send',route(req=>flow.humanSend(req.params.id,req.body.message,actor(req))));
admin.post('/api/conversations/:id/stage',route(req=>flow.stage(req.params.id,req.body.stage,req.body.evidence,actor(req))));
