// ElderCare Connect - end-to-end smoke test (no dependencies, Node 18+).
// Start all six services (or docker compose up), then:   npm run smoke
// Optional: GATEWAY_URL=http://host:8080 npm run smoke
const B=process.env.GATEWAY_URL||'http://localhost:8080'; let pass=0, fail=0;
const ok=(c,m)=>{ c?pass++:fail++; console.log((c?'PASS ':'FAIL ')+m); };
const call=async(method,path,token,body)=>{const r=await fetch(B+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});let j;try{j=await r.json()}catch{j=null}return {s:r.status,j};};
const login=async u=>(await call('POST','/oauth/token',null,{grant_type:'password',username:u,password:'ElderCare@2026'})).j.access_token;
const cg=await login('caregiver.maria'), fam=await login('family.jose'), nurse=await login('nurse.ana'), admin=await login('admin.harold');
ok(cg&&fam&&nurse&&admin,'4 role logins');
let r=await call('POST','/api/checkins',cg,{patientId:'P-1002',vitals:{systolic:126,diastolic:80,heartRate:72,temperatureC:36.6,spo2:97},medication:{taken:true}});
ok(r.s===201&&r.j.checkin.severity==='none','normal check-in 201, no anomaly');
r=await call('POST','/api/checkins',cg,{patientId:'P-1001',vitals:{systolic:400,diastolic:500}}); ok(r.s===422,'invalid vitals 422');
const key='offline-'+Date.now(); const a=await call('POST','/api/checkins',cg,{patientId:'P-1002',idempotencyKey:key,vitals:{heartRate:74}}); const b=await call('POST','/api/checkins',cg,{patientId:'P-1002',idempotencyKey:key,vitals:{heartRate:74}});
ok(a.s===201&&b.s===200&&b.j.duplicate&&a.j.checkin.id===b.j.checkin.id,'idempotent offline replay');
ok((await call('POST','/api/checkins',cg,{patientId:'P-1003',vitals:{heartRate:70}})).s===403,'unassigned patient 403');
ok((await call('GET','/api/clinic/queue',fam)).s===403,'family -> clinic queue 403');
ok((await call('GET','/api/patients/P-1002/history',fam)).s===403,'family -> other patient 403');
// saga
const t0=Date.now();
r=await call('POST','/api/checkins',cg,{patientId:'P-1001',vitals:{systolic:186,diastolic:118,heartRate:104,temperatureC:37.1,spo2:95},medication:{taken:false,missed:['Losartan']},notes:'headache'});
ok(r.s===201&&r.j.checkin.severity==='critical','critical check-in detected'); const cid=r.j.checkin.id;
let alert,item,tA,tC;
while(Date.now()-t0<5000&&(!alert||!item)){ if(!alert){const n=await call('GET','/api/alerts/notifications?patientId=P-1001',fam); alert=n.j.notifications.find(x=>x.metadata&&x.metadata.checkinId===cid); if(alert)tA=Date.now()-t0;}
 if(!item){const q=await call('GET','/api/clinic/queue',nurse); item=q.j.items.find(i=>i.patient.id==='P-1001'&&i.reasons.some(x=>x.checkinId===cid)); if(item)tC=Date.now()-t0;} await new Promise(r=>setTimeout(r,50)); }
ok(!!alert,`family alert raised in ${tA} ms`); ok(!!item&&['P1','P2'].includes(item.priority),`clinic queue item ${item&&item.priority} score ${item&&item.scores.total} in ${tC} ms`);
ok(Math.max(tA,tC)<2000,`end-to-end under 2.0 s objective (${Math.max(tA,tC)} ms)`);
await new Promise(r=>setTimeout(r,1500));
const n2=await call('GET','/api/alerts/notifications?patientId=P-1001',fam); const al=n2.j.notifications.find(x=>x.id===alert.id);
ok(al.delivery.filter(d=>d.channel==='sms').every(d=>['simulated','sent'].includes(d.status)),'SMS processed via BullMQ: '+al.delivery.map(d=>d.channel+':'+d.status).join(','));
r=await call('GET','/api/clinic/patients/P-1001/emr-history',nurse);
ok(r.s===200&&r.j.history.source==='legacy-emr'&&r.j.history.demographics.birthDate==='1946-03-14','legacy SOAP -> JSON via adapter, emrScore '+(r.j&&r.j.emrScore));
r=await call('PATCH','/api/clinic/queue/'+item.id,nurse,{status:'in_review',notes:'called caregiver',assignedTo:'U-CS-001'}); ok(r.s===200&&r.j.item.status==='in_review','triage status update');
ok((await call('PATCH','/api/clinic/queue/'+item.id,nurse,{status:'bogus'})).s===409,'invalid transition 409');
r=await call('POST','/api/alerts/dispatch',nurse,{patientId:'P-1001',message:'Nurse visit tomorrow 9AM'}); ok(r.s===202&&r.j.alertId,'manual dispatch 202');
ok((await call('POST','/api/alerts/dispatch',cg,{patientId:'P-1001',message:'hello there'})).s===403,'caregiver dispatch 403');
r=await call('POST','/api/alerts/weather-check',admin,{zipCode:'1012'}); ok([200,503].includes(r.s),'weather-check reachable ('+(r.s===503?'503 = OPENWEATHER_API_KEY not set':'200 = mashup ran')+')');
r=await call('GET','/api/admin/health',admin); ok(r.s===200,'admin health ('+r.j.overall+'): '+r.j.services.map(s=>s.name+'='+s.status).join(' '));
r=await call('GET','/api/patients/P-1001/history',fam); ok(r.s===200&&r.j.trends.totalCheckins>=1,'family history trends');
r=await call('GET','/api/admin/users',admin); ok(r.s===200&&r.j.users.every(u=>!u.passwordHash),'admin user list without password hashes');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
