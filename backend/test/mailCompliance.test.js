const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { render, trackingUrl, complianceConfig, validateTemplateCompliance } = require("../src/controller/mail.controller");

const ADDRESS = "123 Fixture Road, Sample City, 12345"; // Fictional fixture; never used for live mail.
const OTHER_ADDRESS = "456 Fixture Avenue, Example City, 67890";
const fields = ["COMPANY_NAME", "COMPANY_POSTAL_ADDRESS", "COMPLIANCE_APPROVED_POSTAL_ADDRESSES", "COMPLIANCE_APPROVED_UNSUBSCRIBE_URLS", "TRACKING_SECRET", "PUBLIC_API_URL"];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(fields.map(key => [key, process.env[key]]));
  process.env.TRACKING_SECRET = "t".repeat(64);
  process.env.PUBLIC_API_URL = "http://localhost:5000";
  process.env.COMPANY_NAME = "";
  process.env.COMPANY_POSTAL_ADDRESS = ADDRESS;
  process.env.COMPLIANCE_APPROVED_POSTAL_ADDRESSES = "[]";
  process.env.COMPLIANCE_APPROVED_UNSUBSCRIBE_URLS = "[]";
});
afterEach(() => { for (const [key, value] of Object.entries(saved)) {
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
} });
function sample(html, extra = {}) {
  return { _id: "111111111111111111111111", workspaceId: "222222222222222222222222", provider: "sendgrid", html, css: "", ...extra };
}
const recipient = { _id: "333333333333333333333333", email: "fixture@example.com", firstName: "<Friend>" };
function countFooter(html) { return cheerio.load(html)('[data-trueblaster-compliance="footer"]').length; }

test("compliant full document retains its head/styles, one body and no extra footer", () => {
  const html = `<!doctype html><html lang="en"><head><title>Original</title><style>.message{color:purple}@media(max-width:600px){.message{width:100%}}</style></head><body><p class="message">Hello {{firstName}}</p><address>${ADDRESS}</address><a href="{{ unsubscribeUrl }}">Manage unsubscribe</a></body></html>`;
  const campaign = sample(html, { css: ".message { font-weight: bold; }" });
  const before = JSON.stringify(campaign);
  const outgoing = render(campaign, recipient);
  const $ = cheerio.load(outgoing);
  assert.equal(countFooter(outgoing), 0);
  assert.equal((outgoing.match(/<html\b/gi) || []).length, 1);
  assert.equal((outgoing.match(/<body\b/gi) || []).length, 1);
  assert.equal($("title").text(), "Original");
  assert(outgoing.includes("@media"));
  assert($(".message").attr("style").includes("color: purple"));
  assert($(".message").attr("style").includes("font-weight: bold"));
  assert(outgoing.includes("&lt;Friend&gt;"));
  assert.equal(JSON.stringify(campaign), before);
});

test("missing both elements adds only an outgoing minimal footer without requiring company name", () => {
  const campaign = sample('<table><tr><td style="color:teal">Original content</td></tr></table>');
  const outgoing = render(campaign, recipient);
  const $ = cheerio.load(outgoing);
  assert.equal(countFooter(outgoing), 1);
  assert.equal($("table td").text(), "Original content");
  assert.equal($("table td").css("color"), "teal");
  assert.equal($("[data-trueblaster-compliance] a").text(), "Unsubscribe");
  assert(outgoing.includes(ADDRESS));
  assert(!campaign.html.includes(ADDRESS));
  assert(!campaign.html.includes("trueblaster-compliance"));
});

test("existing visible address gets only a missing unsubscribe link", () => {
  const outgoing = render(sample(`<address>123 Fixture Road<br>Sample City, 12345</address>`), recipient);
  const footer = cheerio.load(outgoing)('[data-trueblaster-compliance="footer"]');
  assert.equal(footer.text().trim(), "Unsubscribe");
  assert(!footer.text().includes("Fixture"));
});

test("existing signed unsubscribe mechanism gets only a missing address", () => {
  const outgoing = render(sample('<a href="{{unsubscribeUrl}}">Stop these emails</a>'), recipient);
  const $ = cheerio.load(outgoing);
  assert.equal($("a").length, 1);
  assert.equal($("[data-trueblaster-compliance] a").length, 0);
  assert($("[data-trueblaster-compliance]").text().includes(ADDRESS));
});

test("centrally approved template address and external unsubscribe need no fallback address", () => {
  process.env.COMPANY_POSTAL_ADDRESS = "";
  const url = "https://preferences.example.com/unsubscribe";
  const workspace = { compliance: { approvedPostalAddresses: [OTHER_ADDRESS], approvedUnsubscribeUrls: [url] } };
  const compliance = complianceConfig(workspace);
  const campaign = sample(`<address>${OTHER_ADDRESS}</address><a href="${url}">Unsubscribe</a>`, { compliance });
  assert.doesNotThrow(() => validateTemplateCompliance(campaign.html, "", compliance));
  assert.equal(countFooter(render(campaign, recipient)), 0);
});

test("an external URL is not trusted just because its path or label says unsubscribe", () => {
  const outgoing = render(sample(`<address>${ADDRESS}</address><a href="https://unknown.example.com/unsubscribe">Unsubscribe</a>`), recipient);
  assert.equal(countFooter(outgoing), 1);
  assert.equal(cheerio.load(outgoing)("[data-trueblaster-compliance] a").length, 1);
});

test("unsubscribed placeholder text, anchors and another recipient's signed token are insufficient", () => {
  for (const link of ['<span>{{unsubscribeUrl}}</span>', '<a href="#">Unsubscribe</a>', '<a href="javascript:void(0)">Unsubscribe</a>', '<a href="{{unsubscribeUrl}}"></a>']) {
    assert.equal(countFooter(render(sample(`<address>${ADDRESS}</address>${link}`), recipient)), 1);
  }
  const campaign = sample(`<address>${ADDRESS}</address>`);
  const wrongLink = trackingUrl(campaign, { ...recipient, _id: "444444444444444444444444" }, "unsubscribe");
  campaign.html += `<a href="${wrongLink}">Unsubscribe</a>`;
  assert.equal(countFooter(render(campaign, recipient)), 1);
});

test("hidden address or hidden unsubscribe cannot satisfy visible compliance", () => {
  const outgoing = render(sample(`<style>.hidden{display:none}</style><div class="hidden">${ADDRESS}</div><a hidden href="{{unsubscribeUrl}}">Unsubscribe</a>`), recipient);
  const footer = cheerio.load(outgoing)('[data-trueblaster-compliance="footer"]');
  assert(footer.text().includes(ADDRESS));
  assert.equal(footer.find("a").length, 1);
});

test("no address, unknown template address, and placeholder defaults all block marketing rendering", () => {
  for (const value of ["", "Your postal address", "{{address}}", "TBD", "Placeholder address"]) {
    process.env.COMPANY_POSTAL_ADDRESS = value;
    assert.throws(() => render(sample(`<address>${OTHER_ADDRESS}</address><a href="{{unsubscribeUrl}}">Unsubscribe</a>`), recipient), /Sender postal address cannot be established/);
  }
});

test("workspace approvals are isolated and override application configuration without mixing senders", () => {
  const own = complianceConfig({ compliance: { postalAddress: OTHER_ADDRESS } });
  const outgoing = render(sample("<p>Message</p>", { compliance: own }), recipient);
  assert(outgoing.includes(OTHER_ADDRESS)); assert(!outgoing.includes(ADDRESS));
  const unconfiguredWorkspace = complianceConfig({ compliance: { companyName: "Different organization" } });
  assert.throws(() => render(sample("<p>Message</p>", { compliance: unconfiguredWorkspace }), recipient), /Sender postal address/);
  assert.throws(() => render(sample(`<address>${OTHER_ADDRESS}</address>`, { compliance: { approvedPostalAddresses: [ADDRESS] } }), recipient), /Sender postal address/);
});

test("central snapshot is stable if application defaults change later", () => {
  const compliance = complianceConfig();
  process.env.COMPANY_POSTAL_ADDRESS = OTHER_ADDRESS;
  assert(render(sample("<p>Message</p>", { compliance }), recipient).includes(ADDRESS));
});

test("address matching respects number boundaries and configuration arrays fail clearly", () => {
  const config = { postalAddress: "", approvedPostalAddresses: [ADDRESS], approvedUnsubscribeUrls: [] };
  assert.throws(() => validateTemplateCompliance(`<address>1${ADDRESS}</address>`, "", config), /Sender postal address/);
  process.env.COMPLIANCE_APPROVED_POSTAL_ADDRESSES = "not-json";
  assert.throws(() => complianceConfig(), /JSON array/);
});

test("configured SendGrid group unsubscribe tags remain intact without a duplicate footer", () => {
  for (const content of ['<a href="<%asm_group_unsubscribe_raw_url%>">Unsubscribe</a>', '<p><%asm_group_unsubscribe_url%></p>']) {
    const campaign = sample('<address>' + ADDRESS + '</address>' + content, { unsubscribeGroupId: 123 });
    const outgoing = render(campaign, recipient);
    assert.equal(countFooter(outgoing), 0);
    assert(outgoing.includes('<%asm_group_unsubscribe'));
    assert.equal(countFooter(render({ ...campaign, unsubscribeGroupId: undefined }, recipient)), 1);
  }
});

test("hidden or escaped native tags and unapproved global account tags don't satisfy unsubscribe", () => {
  for (const content of ['<p hidden><%asm_group_unsubscribe_url%></p>', '<p>&lt;%asm_group_unsubscribe_url%&gt;</p>', '<p><%asm_global_unsubscribe_url%></p>']) {
    assert.equal(countFooter(render(sample('<address>' + ADDRESS + '</address>' + content, { unsubscribeGroupId: 123 }), recipient)), 1);
  }
});

test("numeric and prompt placeholders cannot become sender addresses, and optional company placeholders aren't emitted", () => {
  for (const value of ['1234567890123', '<actual sender address>']) {
    process.env.COMPANY_POSTAL_ADDRESS = value;
    assert.throws(() => render(sample('<p>Message</p>'), recipient), /Sender postal address/);
  }
  process.env.COMPANY_POSTAL_ADDRESS = ADDRESS;
  process.env.COMPANY_NAME = 'Your company';
  assert(!render(sample('<p>Message</p>'), recipient).includes('Your company'));
});

test("zero-font layout containers retain visible child addresses and unsubscribe links", () => {
  const html = '<div style="font-size:0"><address style="font-size:14px">' + ADDRESS + '</address><a style="font-size:14px" href="{{unsubscribeUrl}}">Unsubscribe</a></div>';
  assert.equal(countFooter(render(sample(html), recipient)), 0);
  const hiddenLink = '<address>' + ADDRESS + '</address><a style="font-size:0" href="{{unsubscribeUrl}}">Unsubscribe</a>';
  assert.equal(countFooter(render(sample(hiddenLink), recipient)), 1);
});

test("a wholly hidden email body cannot hide an automatically appended footer", () => {
  assert.throws(() => render(sample('<html><body style="display:none"><p>Message</p></body></html>'), recipient), /Make the email body visible/);
});
