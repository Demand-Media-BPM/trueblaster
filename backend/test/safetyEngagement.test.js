const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const safety = require("../src/config/local-safety");
const tracking = require("../src/controller/tracking.controller");
const { classify } = require("../src/controller/sendgrid.controller");
const keys = ["ALLOW_PRODUCTION_DATABASE_LOCAL","NODE_ENV","SENDGRID_TEST_MODE","SENDGRID_TEST_RUN_ID","SENDGRID_TEST_MAX_RECIPIENTS","SENDGRID_TEST_RECIPIENT_ALLOWLIST","SENDGRID_PROJECT_ID","LOCAL_TEST_DATABASE_NAME","IPINFO_TOKEN"];
let previous;
beforeEach(() => {
  previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { ALLOW_PRODUCTION_DATABASE_LOCAL:"false", NODE_ENV:"development", SENDGRID_TEST_MODE:"true", SENDGRID_TEST_RUN_ID:"unit-fixtures", SENDGRID_TEST_MAX_RECIPIENTS:"3",
    SENDGRID_TEST_RECIPIENT_ALLOWLIST:"allowed@example.com", SENDGRID_PROJECT_ID:"trueblaster-local", LOCAL_TEST_DATABASE_NAME:"trueblaster_local", IPINFO_TOKEN:"fake-unit-token" });
});
afterEach(() => { for (const [k,v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

test("local database guard blocks production/default databases before connection", () => {
  assert.throws(() => safety.assertLocalDatabase("mongodb://127.0.0.1:27017/trueblaster"));
  assert.throws(() => safety.assertLocalDatabase("mongodb+srv://example.invalid/trueblaster"));
  assert.doesNotThrow(() => safety.assertLocalDatabase("mongodb://127.0.0.1:27018/trueblaster_local?replicaSet=local"));
  process.env.NODE_ENV="test";
  assert.doesNotThrow(() => safety.assertLocalDatabase("mongodb://127.0.0.1:12345/fixture_tests"));
  assert.throws(() => safety.assertLocalDatabase("mongodb://remote.invalid/fixture_tests"));
});
test("normal local sending is allowed but cannot use a production project namespace", () => {
  process.env.SENDGRID_TEST_MODE="false"; assert.equal(safety.testSettings(),null);
  process.env.SENDGRID_PROJECT_ID="trueblaster-prod"; assert.throws(() => safety.testSettings());
  process.env.SENDGRID_TEST_MODE="true"; process.env.SENDGRID_PROJECT_ID="trueblaster-production"; assert.throws(() => safety.testSettings());
});
test("bulk allowlist and run checks remain strict while previews accept any valid receiver", () => {
  assert.throws(() => safety.assertRecipients([{email:"other@example.com"}]));
  assert.throws(() => safety.assertRecipients(Array.from({length:4},()=>({email:"allowed@example.com"}))));
  const campaign={testMode:true,testRunId:"unit-fixtures",sendgridProject:"trueblaster-local",totalRecipients:1};
  assert.doesNotThrow(() => safety.assertSend(campaign,{email:"allowed@example.com"}));
  assert.throws(() => safety.assertSend({...campaign,testMode:false},{email:"allowed@example.com"}));
  assert.throws(() => safety.assertSend({...campaign,testRunId:"older-test-run"},{email:"allowed@example.com"}));
  assert.doesNotThrow(() => safety.assertSend(campaign,{email:"other@example.com"},true));
  assert.throws(() => safety.assertSend(campaign,{email:"not-an-email"},true));
  assert.throws(() => safety.assertSend(campaign,{email:"other@example.com"},false));
  process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST="";
  assert.doesNotThrow(() => safety.assertSend(campaign,{email:"another@example.net"},true));
  process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST="*"; assert.throws(() => safety.testSettings());
});
test("blocked SMTP responses distinguish invalid recipients, permanent policy blocks and temporary failures", () => {
  assert.equal(classify({event:"bounce",type:"blocked",status:"5.1.1",reason:"Unknown recipient"}),"hard");
  assert.equal(classify({event:"bounce",type:"blocked",response:"550 5.7.1 Policy block"}),"blocked_permanent");
  assert.equal(classify({event:"bounce",type:"blocked",status:"4.2.0",response:"421 Try again"}),"soft");
  assert.equal(classify({event:"bounce",type:"blocked",reason:"Unknown reason"}),"unclassified");
  assert.equal(classify({event:"deferred",response:"421 temporary"}),"temporary");
});
test("IPinfo cache shares in-flight lookups, extracts only plan-provided fields and keeps token in headers", async () => {
  let calls=0;
  const transport={get:async(url,options)=>{calls++;assert.equal(url,"https://ipinfo.io/8.8.8.8/json");assert(!url.includes(process.env.IPINFO_TOKEN));assert.equal(options.headers.Authorization,"Bearer fake-unit-token");return {data:{country:"US",region:"Fixture region",city:"Fixture city",org:"AS15169 Fixture organization"}};}};
  const [a,b]=await Promise.all([tracking.enrichIp("8.8.8.8",transport),tracking.enrichIp("8.8.8.8",transport)]);
  assert.equal(calls,1);assert.equal(a.asn,"AS15169");assert.equal(a.organization,"AS15169 Fixture organization");assert.deepEqual(a,b);
  await tracking.enrichIp("8.8.8.8",transport);assert.equal(calls,1);
});
test("IPinfo rate limits/failures are cached and never fabricate location", async () => {
  let calls=0;
  const transport={get:async()=>{calls++;const e=new Error("fake");e.response={status:429};throw e;}};
  const a=await tracking.enrichIp("1.1.1.1",transport);await tracking.enrichIp("1.1.1.1",transport);
  assert.equal(calls,1);assert.equal(a.geoStatus,"rate_limited");assert.equal(a.country,undefined);
  assert.equal((await tracking.enrichIp("9.9.9.9",{get:async()=>{throw Error("offline");}})).geoStatus,"unavailable");
});
test("missing and non-public IPs never call IPinfo", async () => {
  const transport={get:async()=>{throw Error("must not call");}};
  for(const ip of ["127.0.0.1","192.168.0.2","172.16.0.2","::1","192.0.2.1","invalid"])
    assert.equal((await tracking.enrichIp(ip,transport)).geoStatus,"non_public");
  assert.equal((await tracking.enrichIp("",transport)).geoStatus,"not_provided");
});
test("missing UA is unknown; device parsing and privacy/scanner flags stay inferred", () => {
  assert.equal(tracking.parseAgent("").device,"");
  const ua="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
  const parsed=tracking.parseAgent(ua);assert.equal(parsed.device,"desktop");assert.equal(parsed.os,"Windows");assert.equal(parsed.browser,"Chrome");
  assert.equal(tracking.parseAgent(ua,true).trafficType,"privacy_proxy");
  assert.equal(tracking.parseAgent("Proofpoint scanner").trafficType,"automated");
});

test("real marketing transport is blocked before a request when email links still target localhost", async () => {
  const fields=["FROM_EMAIL","SENDGRID_ALLOWED_SENDERS","SENDGRID_API_KEY","PUBLIC_API_URL"];
  const original=Object.fromEntries(fields.map(k=>[k,process.env[k]]));
  try {
    Object.assign(process.env,{FROM_EMAIL:"sender@example.com",SENDGRID_ALLOWED_SENDERS:"sender@example.com",SENDGRID_API_KEY:"fake-unit-key",PUBLIC_API_URL:"http://localhost:5000"});
    await assert.rejects(require("../src/controller/mail.controller").sendEmail({testMode:true,testRunId:"unit-fixtures",sendgridProject:"trueblaster-local",totalRecipients:1},{email:"allowed@example.com"}), /public HTTPS tunnel/);
    for(const url of ["https://localhost:5000","https://127.0.0.1","https://api.local","http://webhook.example.com"]) assert.throws(()=>safety.assertPublicEmailOrigin(url));
    assert.doesNotThrow(()=>safety.assertPublicEmailOrigin("https://fixture.ngrok-free.app"));
  } finally {for(const[k,v]of Object.entries(original)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test("shared production database requires explicit development opt-in and never applies to automated tests", () => {
  const uri="mongodb+srv://example.invalid/trueblaster";
  assert.throws(()=>safety.assertLocalDatabase(uri));
  process.env.ALLOW_PRODUCTION_DATABASE_LOCAL="true";
  assert.doesNotThrow(()=>safety.assertLocalDatabase(uri));
  assert.equal(safety.usingSharedDatabaseLocally(uri),true);
  process.env.NODE_ENV="test";
  assert.throws(()=>safety.assertLocalDatabase(uri));
  assert.equal(safety.usingSharedDatabaseLocally(uri),false);
});

test("normal sending needs no test settings and preserves project and old-test isolation", () => {
  for (const key of ['SENDGRID_TEST_MODE','SENDGRID_TEST_RUN_ID','SENDGRID_TEST_MAX_RECIPIENTS','SENDGRID_TEST_RECIPIENT_ALLOWLIST']) delete process.env[key];
  const campaign = { testMode: false, sendgridProject: 'trueblaster-local', totalRecipients: 25 };
  for (const mode of ['development', 'production']) {
    process.env.NODE_ENV = mode;
    assert.equal(safety.testMode(), false);
    assert.equal(safety.testSettings(), null);
    assert.doesNotThrow(() => safety.assertRecipients(Array.from({length:25}, (_, i) => ({email:'recipient'+i+'@example.com'}))));
    assert.doesNotThrow(() => safety.assertSend(campaign, {email:'outside-old-allowlist@example.com'}));
    assert.throws(() => safety.assertSend({...campaign,sendgridProject:'another-project'}, {email:'recipient@example.com'}), /another SendGrid project/);
    assert.throws(() => safety.assertSend({...campaign,testMode:true}, {email:'recipient@example.com'}), /Test campaigns/);
  }
});
