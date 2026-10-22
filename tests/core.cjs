const assert=require('node:assert/strict');const {analyze,validate,sample,day}=require('../src/app.js');
const t=(id,s,e,deps=[],extra={})=>({id,name:id,start:s,end:e,owner:'',deps,lag:0,progress:0,...extra});
const ts=[t('A','2027-01-01','2027-01-03'),t('B','2027-01-01','2027-01-02',['A']),t('C','2027-01-01','2027-01-01',['A']),t('M','2027-01-06','2027-01-06',['B','C'],{milestone:true})];
let a=analyze(ts,'M');assert.equal(a.es.B,day('2027-01-04'));assert.equal(a.ef.B,day('2027-01-06'));assert.equal(a.slack.A,0);assert.equal(a.slack.B,0);assert.equal(a.slack.C,1);assert.equal(a.slack.M,0);
a=analyze([...ts,t('Z','2027-03-01','2027-03-03')],'M');assert.equal(a.slack.Z,undefined);assert.equal(a.finish,day('2027-01-06'));
assert.throws(()=>analyze([t('A','2027-01-01','2027-01-02',['B']),t('B','2027-01-01','2027-01-02',['A'])]),/循環/);
assert.throws(()=>analyze([t('A','2027-01-01','2027-01-02',['X'])]),/存在しない/);
assert.equal(analyze([t('A','2027-01-01','2027-01-03'),t('B','2027-01-01','2027-01-01',['A'],{lag:2})]).es.B,day('2027-01-06'));
let p=sample();assert.deepEqual(validate(JSON.parse(JSON.stringify(p))),p);assert.throws(()=>validate({...p,tasks:[...p.tasks,p.tasks[0]]}),/重複/);assert.throws(()=>validate({...p,tasks:[t('A','2027-02-30','2027-03-04')]}),/日付/);assert.throws(()=>validate({...p,tasks:[t('A','2027-01-01','2027-01-03',[],{actualEnd:'2027-01-02'})]}),/実績開始/);assert.equal(analyze([]).relevant.size,0);console.log('PASS: FS, lag, milestone, critical path, target scoping, cycles, missing dependencies, date validation, actual dates, JSON round-trip, empty project');

const {rememberOwners}=require('../src/app.js');
const legacy=sample();delete legacy.owners;validate(legacy);assert(legacy.owners.includes('担当A'));
legacy.tasks[0].owner='追加した担当者';rememberOwners(legacy);legacy.tasks[0].owner='担当A';rememberOwners(legacy);assert(legacy.owners.includes('追加した担当者'));
assert.equal(legacy.owners.length,new Set(legacy.owners).size);assert.deepEqual(validate(JSON.parse(JSON.stringify(legacy))).owners,legacy.owners);
console.log('PASS: legacy owner migration, owner history, deduplication, JSON round-trip');
