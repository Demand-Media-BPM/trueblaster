const {test,before,after}=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("crypto");
const mongoose=require("mongoose");
const axios=require("axios");
const {testDatabase}=require("./helpers/database");
const keys=crypto.generateKeyPairSync("ec",{namedCurve:"prime256v1"});
Object.assign(process.env,{NODE_ENV:"test",AUTH_SECRET:"a".repeat(64),TRACKING_SECRET:"t".repeat(64),PUBLIC_API_URL:"http://localhost:5000",
  SENDGRID_API_KEY:"fake-lifecycle-key",SENDGRID_PROJECT_ID:"trueblaster-test",SENDGRID_WEBHOOK_PUBLIC_KEY:keys.publicKey.export({type:"spki",format:"der"}).toString("base64"),
  SENDGRID_WEBHOOK_PREVIOUS_PUBLIC_KEY:"",SENDGRID_TEST_MODE:"true",SENDGRID_TEST_RUN_ID:"lifecycle-fixtures",SENDGRID_TEST_MAX_RECIPIENTS:"3",
  SENDGRID_TEST_RECIPIENT_ALLOWLIST:"one@example.com,two@example.com",FROM_EMAIL:"sender@example.com",SENDGRID_ALLOWED_SENDERS:"sender@example.com",FROM_NAME:"Fixture sender",
  REPLY_TO_EMAIL:"replies@example.com",COMPANY_NAME:"",COMPANY_POSTAL_ADDRESS:"123 Fixture Road, Sample City, 12345",COMPLIANCE_APPROVED_POSTAL_ADDRESSES:"[]",
  COMPLIANCE_APPROVED_UNSUBSCRIBE_URLS:"[]",SENDGRID_UNSUBSCRIBE_GROUP_ID:"",ENABLE_CAMPAIGN_WORKER:"false",IPINFO_TOKEN:"fake-geolocation-token",CAMPAIGN_BATCH_DELAY_MS:"1"});
const {connectDatabase}=require("../src/config/database");
const app=require("../server");
const Campaign=require("../src/models/campaign.model");
const Recipient=require("../src/models/campaignRecipient.model");
const Template=require("../src/models/template.model");
const Event=require("../src/models/campaignEvent.model");
const Suppression=require("../src/models/suppression.model");
const {processCampaign}=require("../src/controller/delivery.controller");
const mail=require("../src/controller/mail.controller");
const {anonymizeTrackingMetadata}=require("../src/controller/tracking.controller");
let replica,server,base,token,workspaceId,campaign,recipient,templateId,geoCalls=0;
const originalGet=axios.get,originalPost=axios.post;
const html='\n<!doctype html><html><head><style>.greeting{color:teal}</style></head><body><h1 class="greeting">Hello {{firstName}}</h1><a href="https://example.com/product">Product</a></body></html>\n';
const css='.greeting{font-size:24px}';
before(async()=>{
  axios.get=async url=>{assert(url.startsWith("https://ipinfo.io/"));geoCalls++;return {data:{country:"US",region:"Fixture region",city:"Fixture city",org:"AS123 Fixture ISP"}};};
  axios.post=async()=>{throw Error("Live external POST forbidden in tests");};
  replica=await testDatabase("lifecycle_tests");process.env.MONGO_URI=replica.getUri("lifecycle_tests");await connectDatabase();
  server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));base="http://127.0.0.1:"+server.address().port;
  const signup=await request("/signup",{method:"POST",body:{firstName:"Fixture",lastName:"Owner",email:"owner@example.com",password:"fixture-password"}});
  assert.equal(signup.status,201);token=signup.body.token;workspaceId=signup.body.workspace.id;
});
after(async()=>{axios.get=originalGet;axios.post=originalPost;if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await mongoose.disconnect();if(replica)await replica.stop();});
async function request(url,{method="GET",body,form,headers={}}={}){
  const res=await fetch(base+url,{method,headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body?{"Content-Type":"application/json"}:{}),...headers},body:form||(body&&JSON.stringify(body))});
  const type=res.headers.get("content-type")||"";return {status:res.status,body:type.includes("application/json")?await res.json():await res.text()};
}
async function importCsv(name,csv){const form=new FormData();form.set("listName",name);form.set("file",new Blob([csv],{type:"text/csv"}),"fixture.csv");return request("/api/contact/upload-contact",{method:"POST",form});}
function webhookEvent(type,extra={}){return {event:type,timestamp:Math.floor(Date.now()/1000),email:recipient.email,sg_event_id:crypto.randomUUID(),sg_message_id:"fixture-provider-id",tb_project:campaign.sendgridProject,tb_message_kind:"campaign",tb_workspace_id:String(campaign.workspaceId),tb_campaign_id:String(campaign._id),tb_recipient_id:String(recipient._id),tb_attempt_id:recipient.sendAttemptId,...extra};}
async function webhook(events){const body=JSON.stringify(events),timestamp=String(Math.floor(Date.now()/1000));return request("/api/webhooks/sendgrid",{method:"POST",body:events,headers:{"X-Twilio-Email-Event-Webhook-Timestamp":timestamp,"X-Twilio-Email-Event-Webhook-Signature":crypto.sign("sha256",Buffer.concat([Buffer.from(timestamp),Buffer.from(body)]),keys.privateKey).toString("base64")}});}

test("CSV import validates and deduplicates, template upload preserves exact HTML/CSS",async()=>{
  const result=await importCsv("Fixture list","Email,FirstName,LastName\none@example.com,Ada,One\none@example.com,Ada,One\ntwo@example.com,Bob,Two\n");
  assert.equal(result.status,200);assert.equal(result.body.imported,2);
  assert.equal((await importCsv("Invalid list","Email,FirstName\nbad-address,Ada\n")).status,400);
  const saved=await request("/api/preview/",{method:"POST",body:{name:"Original fixture",html,css}});assert.equal(saved.status,200);templateId=saved.body._id;
  const original=await Template.findById(templateId);assert.equal(original.html,html);assert.equal(original.css,css);
});
test("campaign snapshots local test markers and worker sends intended personalized copies once",async()=>{
  const result=await request("/api/campaign/send-campaign",{method:"POST",body:{emailId:"Lifecycle",subject:"Fixture subject",body:html,style:css,listName:"Fixture list"}});
  assert.equal(result.status,200);campaign=await Campaign.findById(result.body.campaignId);assert.equal(campaign.testMode,true);assert.equal(campaign.testRunId,"lifecycle-fixtures");
  campaign.status="running";campaign.leaseOwner="fixture-worker";campaign.leaseUntil=new Date(Date.now()+120000);await campaign.save();
  const outgoing=[];
  const send=async(c,r)=>mail.sendEmail(c,r,false,{post:async(url,body)=>{assert.equal(url,"https://api.sendgrid.com/v3/mail/send");outgoing.push(body);return {status:202,headers:{"x-message-id":"fixture-accepted-"+r._id}};}});
  await processCampaign(campaign,"fixture-worker",send);await processCampaign(campaign,"fixture-worker",send);
  assert.equal(outgoing.length,2);const ada=outgoing.find(p=>p.personalizations[0].to[0].email==="one@example.com");assert(ada.content[0].value.includes("Hello Ada"));
  assert(ada.content[0].value.includes("track-unsubscribe"));assert.equal(ada.reply_to.email,"replies@example.com");
  assert.equal((await Template.findById(templateId)).html,html);assert.equal((await Campaign.findById(campaign._id)).html,html);
  assert.equal((await Campaign.findById(campaign._id)).status,"completed");recipient=await Recipient.findOne({campaignId:campaign._id,email:"one@example.com"});
});
test("signed real-shape event batches drive unique metrics, metadata and detailed reports",async()=>{
  const ua="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
  const events=[webhookEvent("processed"),webhookEvent("delivered"),...Array.from({length:5},()=>webhookEvent("open",{ip:"8.8.4.4",useragent:ua})),webhookEvent("click",{ip:"8.8.4.4",useragent:ua,url:"https://example.com/product"})];
  assert.equal((await webhook(events)).body.processed,8);assert.equal((await webhook(events)).body.duplicate,8);assert.equal(geoCalls,1);
  const summary=(await request("/api/campaign/campaign-analytics?emailId=Lifecycle")).body;
  assert.equal(summary.processedCount,1);assert.equal(summary.deliveredCount,1);assert.equal(summary.deliveryRate,50);assert.equal(summary.unsubscribeRate,0);assert.equal(summary.totalOpens,5);assert.equal(summary.uniqueOpens,1);assert.equal(summary.uniqueClicks,1);
  const details=(await request("/api/campaign/campaign-details?emailId=Lifecycle")).body.find(r=>r.recipient==="one@example.com");
  assert.equal(details.organization,"AS123 Fixture ISP");assert.equal(details.asn,"AS123");assert.equal(details.city,"Fixture city");assert.equal(details.device,"desktop");assert.equal(details.browser,"Chrome");assert.equal(details.userAgent,ua);assert.equal(details.clickedUrl,"https://example.com/product");assert.notEqual(details.lastOpen,"NA");
});
test("confirmation and one-click unsubscribe persist and suppress a later campaign",async()=>{
  const url=new URL(mail.trackingUrl(campaign,recipient,"unsubscribe"));const endpoint=url.pathname+url.search;
  assert.equal((await request(endpoint)).status,200);assert.equal(await Suppression.countDocuments({workspaceId,email:recipient.email}),0);
  const response=await fetch(base+endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"List-Unsubscribe=One-Click"});assert.equal(response.status,200);
  assert.equal(await Suppression.countDocuments({workspaceId,email:recipient.email,reason:"unsubscribed"}),1);
  const next=await request("/api/campaign/send-campaign",{method:"POST",body:{emailId:"After opt-out",subject:"Fixture",body:html,style:css,listName:"Fixture list"}});assert.equal(next.status,200);
  assert.equal((await Recipient.findOne({campaignId:next.body.campaignId,email:recipient.email})).status,"skipped");
});
test("privacy retention anonymizes metadata while preserving event IDs, metrics and deduplication",async()=>{
  const old=webhookEvent("open",{timestamp:Math.floor(Date.now()/1000)-40*86400,ip:"8.8.4.4",useragent:"Fixture UA"});
  await webhook([old]);const count=await Event.countDocuments({campaignId:campaign._id});
  await anonymizeTrackingMetadata(new Date(Date.now()+40*86400000));
  assert.equal(await Event.countDocuments({campaignId:campaign._id}),count);
  assert.equal((await Event.findOne({providerEventId:old.sg_event_id})).ip,"");
  assert.equal((await webhook([old])).body.duplicate,1);
});

test("worker blocks recipients removed from allowlist after queuing and records a definite failure",async()=>{
  const next=await Campaign.findOne({name:"After opt-out",workspaceId});
  next.status="running";next.leaseOwner="safety-worker";next.leaseUntil=new Date(Date.now()+120000);await next.save();
  const allowed=process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST;let calls=0;
  try {
    process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST="one@example.com";
    await processCampaign(next,"safety-worker",async()=>{calls++;return "must-not-send";});
    assert.equal(calls,0);const blocked=await Recipient.findOne({campaignId:next._id,email:"two@example.com"});
    assert.equal(blocked.status,"failed");assert.match(blocked.error,/ALLOWLIST/);
  } finally {process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST=allowed;}
});

test("actual worker claim is fenced to the current project and controlled test run",async()=>{
  const original=Campaign.findOneAndUpdate;let claimed;
  Campaign.findOneAndUpdate=async filter=>{claimed=filter;return null;};
  const stop=require("../src/controller/delivery.controller").startWorker();
  try {
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(claimed.testMode,true);assert.equal(claimed.testRunId,"lifecycle-fixtures");assert.equal(claimed.sendgridProject,"trueblaster-test");
  } finally {await stop();Campaign.findOneAndUpdate=original;}
});

test("manual preview accepts an outside-allowlist receiver even with no campaign allowlist",async()=>{
  const allowlist=process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST;
  const previousPost=axios.post;const messages=[];
  try {
    process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST="";
    axios.post=async(url,body)=>{assert.equal(url,"https://api.sendgrid.com/v3/mail/send");messages.push(body);return {status:202,headers:{"x-message-id":"fake-preview-id"}};};
    const readiness=await request("/me");
    assert.equal(readiness.body.workspace.mailConfigured,true);
    assert.equal(readiness.body.workspace.campaignConfigured,false);
    const response=await request("/api/campaign/send-test-mail",{method:"POST",body:{receiver:"preview.viewer@example.net",subject:"Preview fixture",body:html,style:css}});
    assert.equal(response.status,200);assert.equal(messages.length,1);
    assert.equal(messages[0].personalizations[0].to[0].email,"preview.viewer@example.net");
    assert.equal(messages[0].personalizations[0].custom_args.tb_message_kind,"test");
    assert.equal(messages[0].from.email,"sender@example.com");
    const invalid=await request("/api/campaign/send-test-mail",{method:"POST",body:{receiver:"not-an-email",subject:"Preview",body:html}});
    assert.equal(invalid.status,400);assert.equal(messages.length,1);
    const suppressed=await request("/api/campaign/send-test-mail",{method:"POST",body:{receiver:"one@example.com",subject:"Preview",body:html}});
    assert.equal(suppressed.status,400);assert.equal(messages.length,1);
  } finally {process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST=allowlist;axios.post=previousPost;}
});

test("normal local campaigns queue and worker claims only their project without test settings",async()=>{
  const keys=['SENDGRID_TEST_MODE','SENDGRID_TEST_RUN_ID','SENDGRID_TEST_MAX_RECIPIENTS','SENDGRID_TEST_RECIPIENT_ALLOWLIST'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const original=Campaign.findOneAndUpdate;let claimed;let stop;
  try {
    keys.forEach(key=>delete process.env[key]);
    const result=await request('/api/campaign/send-campaign',{method:'POST',body:{emailId:'Normal local flow',subject:'Normal fixture',body:html,style:css,listName:'Fixture list'}});
    assert.equal(result.status,200);
    const queued=await Campaign.findById(result.body.campaignId);
    assert.equal(queued.testMode,false);assert.equal(queued.testRunId,'');
    assert.equal(queued.sendgridProject,'trueblaster-test');
    Campaign.findOneAndUpdate=async filter=>{claimed=filter;return null;};
    stop=require('../src/controller/delivery.controller').startWorker();
    for(let i=0;i<100&&!claimed;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(claimed.sendgridProject,'trueblaster-test');assert.deepEqual(claimed.testMode,{$ne:true});
    assert.equal(claimed.testRunId,undefined);
  } finally {
    if(stop)await stop();Campaign.findOneAndUpdate=original;
    for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
