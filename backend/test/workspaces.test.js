const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const xlsx = require("xlsx");
process.env.AUTH_SECRET = "a".repeat(64);
process.env.TRACKING_SECRET = "t".repeat(64);
process.env.PUBLIC_API_URL = "http://localhost:5000";
process.env.FORCE_SES_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "test-only";
process.env.AWS_SECRET_ACCESS_KEY = "test-only";
process.env.FROM_EMAIL = "sender@example.com";
process.env.IPINFO_TOKEN = "";
process.env.CAMPAIGN_BATCH_DELAY_MS = "1";
const models = {
  Workspace: require("../src/models/workspace.model"),
  User: require("../src/models/user.model"),
  Contact: require("../src/models/contact.model"),
  ContactList: require("../src/models/contactList.model"),
  ListMembership: require("../src/models/listMembership.model"),
  Template: require("../src/models/template.model"),
  Campaign: require("../src/models/campaign.model"),
  CampaignRecipient: require("../src/models/campaignRecipient.model"),
  CampaignEvent: require("../src/models/campaignEvent.model"),
  Suppression: require("../src/models/suppression.model"),
};
const { createWorkspace } = require("../src/controller/auth.controller");
const { connectDatabase } = require("../src/config/database");
const { sign, verify, hashPassword, verifyPassword } = require("../src/middleware/auth");
const { trackingUrl, render } = require("../src/controller/mail.controller");
const { processCampaign } = require("../src/controller/delivery.controller");
const { applyNotification, signingString } = require("../src/controller/webhook.controller");
const app = require("../server");
let replica, server, base;
before(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    instanceOpts: [{ launchTimeout: 60000 }],
  });
  process.env.MONGO_URI = replica.getUri("workspace_tests");
  await connectDatabase();
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
  if (replica) await replica.stop();
});
async function request(url, { token, method = "GET", body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(base + url, {
    method,
    headers,
    body: form || (body && JSON.stringify(body)),
    redirect: "manual",
  });
  const type = res.headers.get("content-type") || "";
  return {
    status: res.status,
    body: type.includes("application/json") ? await res.json() : await res.text(),
    headers: res.headers,
  };
}
function sheet(rows, name = "Customers") {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), "Contacts");
  const form = new FormData();
  form.set("listName", name);
  form.set(
    "file",
    new Blob([xlsx.write(wb, { type: "buffer", bookType: "xlsx" })]),
    "contacts.xlsx"
  );
  return form;
}
test("signed sessions reject tampering and passwords are hashed", async () => {
  const hash = await hashPassword("test-password");
  assert.notEqual(hash, "test-password");
  assert(await verifyPassword("test-password", hash));
  assert(!(await verifyPassword("incorrect", hash)));
  const token = sign({ userId: "alice" }, "auth", 60);
  assert.equal(verify(token, "auth").userId, "alice");
  assert.throws(() => verify(token + "x", "auth"));
  assert.throws(() => verify(token, "tracking"));
  assert.throws(() => verify(sign({}, "auth", -1), "auth"));
  const html = render(
    { html: "{{firstName}} {{custom}}", css: "" },
    { email: "test@example.com", firstName: "<script>", customFields: { custom: "<img>" } },
    true
  );
  assert(html.includes("&lt;script&gt;") && html.includes("&lt;img&gt;"));
  assert(!html.includes("<script>"));
  assert.equal(
    signingString({
      Type: "Notification",
      Message: "hello",
      MessageId: "id",
      Timestamp: "now",
      TopicArn: "topic",
    }),
    "Message\nhello\nMessageId\nid\nTimestamp\nnow\nTopicArn\ntopic\nType\nNotification\n"
  );
});
test("workspace isolation across contacts, templates, suppressions, campaigns, tracking, exports, and worker", async (t) => {
  const alice = await createWorkspace({
    name: "Alice",
    slug: "alice",
    firstName: "Alice",
    lastName: "Example",
    email: "alice@example.com",
    password: "alice-password",
  });
  const bob = await createWorkspace({
    name: "Bob",
    slug: "bob",
    firstName: "Bob",
    lastName: "Example",
    email: "bob@example.com",
    password: "bob-password",
  });
  const a = (
    await request("/login", {
      method: "POST",
      body: { email: "alice@example.com", password: "alice-password" },
    })
  ).body.token;
  const b = (
    await request("/login", {
      method: "POST",
      body: { email: "bob@example.com", password: "bob-password" },
    })
  ).body.token;
  assert(a && b);
  await t.test(
    "signup validates names, normalizes email, creates isolated owners, and rolls back duplicate accounts",
    async () => {
      const before = await models.Workspace.countDocuments();
      const body = {
        firstName: "Charlie",
        lastName: "Example",
        email: "CHARLIE@example.com",
        password: "charlie-password",
        workspaceId: String(alice._id),
        role: "member",
      };
      const created = await request("/signup", { method: "POST", body });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert(created.body.token);
      assert.equal(created.body.user.email, "charlie@example.com");
      assert.equal(created.body.user.firstName, "Charlie");
      assert.equal(created.body.user.role, "owner");
      assert.notEqual(String(created.body.workspace.id), String(alice._id));
      const user = await models.User.findOne({ email: "charlie@example.com" }).select(
        "+passwordHash"
      );
      assert.notEqual(user.passwordHash, body.password);
      assert.equal(created.body.user.passwordHash, undefined);
      assert.equal(
        (await request("/api/contact/lists", { token: created.body.token })).body.length,
        0
      );
      assert.equal((await request("/signup", { method: "POST", body })).status, 409);
      assert.equal(await models.Workspace.countDocuments(), before + 1);
      assert.equal(
        (
          await request("/signup", {
            method: "POST",
            body: { ...body, email: "invalid@example.com", firstName: "" },
          })
        ).status,
        400
      );
      assert.equal(
        (
          await request("/signup", {
            method: "POST",
            body: { ...body, email: "invalid@example.com", password: "short" },
          })
        ).status,
        400
      );
      const loggedIn = await request("/login", {
        method: "POST",
        body: { email: "CHARLIE@example.com", password: "charlie-password" },
      });
      assert.equal(loggedIn.status, 200);
      assert.equal(loggedIn.body.workspace.id, created.body.workspace.id);
    }
  );
  await t.test(
    "session restore returns the authenticated profile and workspace sender settings only",
    async () => {
      assert.equal((await request("/me")).status, 401);
      const result = await request("/me", { token: a });
      assert.equal(result.status, 200);
      assert.equal(result.body.user.email, "alice@example.com");
      assert.equal(String(result.body.workspace.id), String(alice._id));
      assert.equal(result.body.workspace.senderEmail, "sender@example.com");
      assert.equal(result.body.workspace.mailConfigured, true);
      assert.equal(result.body.user.passwordHash, undefined);
      assert.equal(result.body.workspace.AWS_SECRET_ACCESS_KEY, undefined);
    }
  );
  await t.test("unauthenticated management endpoints reject access", async () => {
    for (const url of [
      "/api/contact/lists",
      "/api/preview",
      "/api/blocklist/list",
      "/api/unsubscribelist/list",
      "/api/campaign/campaign-ids",
      "/api/campaign/send-campaign-progress?emailId=Shared",
    ])
      assert.equal((await request(url)).status, 401, url);
    assert.equal(
      (
        await request("/login", {
          method: "POST",
          body: { email: "alice@example.com", password: "wrong" },
        })
      ).status,
      401
    );
  });
  await t.test(
    "same list/email can exist in separate workspaces; duplicate imports are deduplicated",
    async () => {
      for (const token of [a, b]) {
        const result = await request("/api/contact/upload-contact", {
          token,
          method: "POST",
          form: sheet([
            { Email: "SAME@example.com", FirstName: token === a ? "Alice" : "Bob" },
            { Email: "same@example.com" },
          ]),
        });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.imported, 1);
      }
      assert.equal(
        (
          await request("/api/contact/upload-contact", {
            token: a,
            method: "POST",
            form: sheet([{ Email: "same@example.com", FirstName: "Alice" }]),
          })
        ).status,
        200
      );
      assert.equal(await models.Contact.countDocuments({ workspaceId: alice._id }), 1);
      assert.equal(await models.Contact.countDocuments({ workspaceId: bob._id }), 1);
      assert.equal(await models.ListMembership.countDocuments({ workspaceId: alice._id }), 1);
      const rows = await request("/api/contact/view-list-data?listName=Customers", { token: a });
      assert.equal(rows.body[0].FirstName, "Alice");
      assert.equal(
        (
          await request("/api/contact/upload-contact", {
            token: a,
            method: "POST",
            form: sheet([{ Email: "bad" }], "Invalid"),
          })
        ).status,
        400
      );
      assert.equal(
        await models.ContactList.countDocuments({ workspaceId: alice._id, name: "Invalid" }),
        0
      );
      assert.equal((await request("/api/contact/lists", { token: a })).body[0].count, 1);
    }
  );
  let templateId;
  await t.test(
    "template object IDs cannot cross workspaces and body cannot spoof ownership",
    async () => {
      const created = await request("/api/preview", {
        token: a,
        method: "POST",
        body: { name: "Welcome", html: "Hello", workspaceId: String(bob._id) },
      });
      assert.equal(created.status, 200);
      templateId = created.body._id;
      assert.equal((await request("/api/preview", { token: b })).body.length, 0);
      for (const [method, suffix, body] of [
        ["PUT", "", { html: "stolen" }],
        ["DELETE", "", undefined],
        ["POST", "/duplicate", {}],
        ["PATCH", "/rename", { name: "stolen" }],
      ]) {
        assert.equal(
          (await request(`/api/preview/${templateId}${suffix}`, { token: b, method, body })).status,
          404
        );
      }
      assert.equal(
        (
          await request(`/api/preview/${templateId}/rename`, {
            token: a,
            method: "PATCH",
            body: { name: "Updated" },
          })
        ).status,
        200
      );
      assert.equal(
        (
          await request(`/api/preview/${templateId}/duplicate`, {
            token: a,
            method: "POST",
            body: {},
          })
        ).status,
        200
      );
    }
  );
  await t.test("template names and content save atomically within their workspace", async () => {
    const updated = await request(`/api/preview/${templateId}`, {
      token: a, method: "PUT", body: { name: "Saved together", html: "<p>Hello {{firstName}}</p>", css: "p { color: green; }" },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, "Saved together");
    assert.equal(updated.body.html, "<p>Hello {{firstName}}</p>");
    assert.equal((await request(`/api/preview/${templateId}`, { token: a, method: "PUT", body: { name: "", html: "must not save" } })).status, 400);
    const templates = (await request("/api/preview", { token: a })).body;
    assert.equal(templates.find(item => item._id === templateId).html, "<p>Hello {{firstName}}</p>");
  });
  await t.test("template images require authenticated uploads and are safely served as public email assets", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Ry8AAAAASUVORK5CYII=", "base64");
    const form = () => { const body = new FormData(); body.set("file", new Blob([png], { type: "image/png" }), "pixel.png"); return body; };
    assert.equal((await request("/api/preview/images", { method: "POST", form: form() })).status, 401);
    assert.equal((await request("/api/preview/images", { token: a, method: "POST", form: new FormData() })).status, 400);
    const malicious = new FormData();
    malicious.set("file", new Blob(["<script>alert('not an image')</script>"], { type: "image/png" }), "fake.png");
    assert.equal((await request("/api/preview/images", { token: a, method: "POST", form: malicious })).status, 400);
    const tooLarge = new FormData();
    tooLarge.set("file", new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: "image/png" }), "large.png");
    assert.equal((await request("/api/preview/images", { token: a, method: "POST", form: tooLarge })).status, 413);
    const uploaded = await request("/api/preview/images", { token: a, method: "POST", form: form() });
    assert.equal(uploaded.status, 201);
    const publicPath = new URL(uploaded.body.url).pathname;
    const filename = publicPath.split("/").pop();
    assert.match(filename, /^[a-f0-9-]{36}\.png$/);
    try {
      const response = await fetch(base + publicPath);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
      assert.equal((await request("/api/template-images/not-an-image.svg")).status, 404);
      assert.equal((await request("/api/template-images/00000000-0000-0000-0000-000000000000.png")).status, 404);
    } finally {
      await require("node:fs/promises").unlink(require("node:path").join(__dirname, "../uploads/template-images", filename));
    }
  });
  await t.test("suppression data and IDs remain scoped", async () => {
    const added = await request("/api/blocklist/upload", {
      token: a,
      method: "POST",
      body: { Email: "blocked@example.com", workspaceId: String(bob._id) },
    });
    assert.equal(added.status, 201);
    assert.equal((await request("/api/blocklist/list", { token: b })).body.length, 0);
    assert.equal(
      (await request(`/api/blocklist/remove/${added.body._id}`, { token: b, method: "DELETE" }))
        .status,
      404
    );
    assert.equal(
      (await request("/api/blocklist/search?email=blocked", { token: a })).body.length,
      1
    );
  });
  let ca, cb;
  await t.test(
    "campaigns snapshot content and permit the same name in different workspaces",
    async () => {
      const body = {
        emailId: "Shared",
        subject: "Hello",
        body: "Hi {{firstName}}",
        listName: "Customers",
        redirectUrl: "https://example.com",
        scheduleTime: new Date(Date.now() + 60000).toISOString(),
      };
      for (const token of [a, b]) {
        const result = await request("/api/campaign/send-campaign", {
          token,
          method: "POST",
          body,
        });
        assert.equal(result.status, 200, JSON.stringify(result.body));
      }
      ca = await models.Campaign.findOne({ workspaceId: alice._id, name: "Shared" });
      cb = await models.Campaign.findOne({ workspaceId: bob._id, name: "Shared" });
      assert(ca && cb);
      assert.equal(ca.html, "Hi {{firstName}}");
      assert.equal(
        (await request("/api/campaign/send-campaign", { token: a, method: "POST", body })).status,
        409
      );
      const original = await models.Contact.findOne({ workspaceId: alice._id });
      original.firstName = "Changed";
      await original.save();
      assert.equal(
        (await models.CampaignRecipient.findOne({ workspaceId: alice._id, campaignId: ca._id }))
          .firstName,
        "Alice"
      );
      assert.equal((await request("/api/campaign/campaign-ids", { token: b })).body.length, 1);
      await request("/api/campaign/send-campaign", {
        token: a,
        method: "POST",
        body: { ...body, emailId: "Alice only" },
      });
      assert.equal(
        (await request("/api/campaign/campaign-analytics?emailId=Alice%20only", { token: b }))
          .status,
        404
      );
      assert.equal(
        (await request("/api/campaign/campaign-details?emailId=Shared", { token: a })).body[0]
          .recipient,
        "same@example.com"
      );
      assert.equal(
        (await request("/api/campaign/campaign-csv?emailId=Shared", { token: a })).status,
        200
      );
      assert.equal(
        (await request("/api/campaign/send-campaign-progress?emailId=Shared", { token: a })).body
          .total,
        1
      );
    }
  );
  await t.test(
    "signed tracking cannot target another tenant or action, and unsubscribe is idempotent",
    async () => {
      const recipient = await models.CampaignRecipient.findOne({
        workspaceId: alice._id,
        campaignId: ca._id,
      });
      const url = new URL(trackingUrl(ca, recipient, "unsubscribe"));
      assert.equal((await request(url.pathname + url.search)).status, 200);
      assert.equal((await request(url.pathname + url.search)).status, 200);
      assert.equal(
        await models.Suppression.countDocuments({
          workspaceId: alice._id,
          email: "same@example.com",
          reason: "unsubscribed",
        }),
        1
      );
      assert.equal(
        await models.Suppression.countDocuments({
          workspaceId: bob._id,
          email: "same@example.com",
        }),
        0
      );
      assert.equal((await request("/api/campaign/track-click" + url.search)).status, 400);
      assert.equal(
        (
          await request(
            "/api/campaign/track-unsubscribe?emailId=Shared&recipientId=same@example.com"
          )
        ).status,
        400
      );
      assert.equal((await request("/api/unsubscribelist/list", { token: a })).body.length, 1);
    }
  );
  await t.test(
    "worker rechecks suppressions and never resends interrupted recipients",
    async () => {
      ca.status = "running";
      ca.leaseOwner = "test";
      ca.leaseUntil = new Date(Date.now() + 120000);
      await ca.save();
      let calls = 0;
      await processCampaign(ca, "test", async () => {
        calls++;
        return "fake-id";
      });
      assert.equal(calls, 0);
      assert.equal(
        (await models.CampaignRecipient.findOne({ workspaceId: alice._id, campaignId: ca._id }))
          .status,
        "skipped"
      );
      assert.equal(
        (await request("/api/campaign/campaign-details?emailId=Shared", { token: a })).body[0]
          .error,
        "unsubscribed"
      );
      cb.status = "running";
      cb.leaseOwner = "test";
      cb.leaseUntil = new Date(Date.now() + 120000);
      await cb.save();
      await processCampaign(cb, "test", async () => {
        calls++;
        return "fake-ses-id";
      });
      assert.equal(calls, 1);
      assert.equal(
        (await models.CampaignRecipient.findOne({ workspaceId: bob._id, campaignId: cb._id }))
          .status,
        "accepted"
      );
      assert.equal(
        (await request("/api/campaign/campaign-analytics?emailId=Shared", { token: b })).body
          .totalSent,
        1
      );
      const interrupted = await models.Campaign.findOne({
        workspaceId: alice._id,
        name: "Alice only",
      });
      await models.CampaignRecipient.updateMany(
        { workspaceId: alice._id, campaignId: interrupted._id },
        { $set: { status: "sending" } }
      );
      interrupted.status = "running";
      interrupted.leaseOwner = "test";
      interrupted.leaseUntil = new Date(Date.now() + 120000);
      await interrupted.save();
      await processCampaign(interrupted, "test", async () => {
        calls++;
        return "must-not-send";
      });
      assert.equal(calls, 1);
      assert.equal((await models.Campaign.findById(interrupted._id)).status, "needs_review");
    }
  );
  await t.test("open/click analytics count signed events only in their workspace", async () => {
    const recipient = await models.CampaignRecipient.findOne({
      workspaceId: bob._id,
      campaignId: cb._id,
    });
    for (const action of ["pixel", "click"]) {
      const url = new URL(trackingUrl(cb, recipient, action));
      const result = await request(url.pathname + url.search);
      assert.equal(result.status, action === "pixel" ? 200 : 302);
      if (action === "click") assert.equal(result.headers.get("location"), "https://example.com/");
    }
    const summary = (await request("/api/campaign/campaign-analytics?emailId=Shared", { token: b }))
      .body;
    assert.equal(summary.totalOpens, 1);
    assert.equal(summary.uniqueClicks, 1);
    assert.equal(
      (await request("/api/campaign/campaign-analytics?emailId=Shared", { token: a })).body
        .totalOpens,
      0
    );
  });
  await t.test(
    "verified SES event application is idempotent and scoped by its stored message ID",
    async () => {
      const notification = {
        MessageId: "sns-bounce-1",
        Message: JSON.stringify({
          notificationType: "Bounce",
          mail: { messageId: "fake-ses-id" },
          bounce: {
            bounceType: "Permanent",
            bouncedRecipients: [{ emailAddress: "same@example.com" }],
          },
        }),
      };
      await applyNotification(notification);
      await applyNotification(notification);
      assert.equal(
        await models.CampaignEvent.countDocuments({ workspaceId: bob._id, type: "bounce" }),
        1
      );
      assert.equal(
        await models.Suppression.countDocuments({ workspaceId: bob._id, reason: "hard_bounce" }),
        1
      );
      assert.equal(
        await models.Suppression.countDocuments({ workspaceId: alice._id, reason: "hard_bounce" }),
        0
      );
      await applyNotification({
        MessageId: "sns-delivery-1",
        Message: JSON.stringify({
          notificationType: "Delivery",
          mail: { messageId: "fake-ses-id" },
          delivery: { recipients: ["same@example.com"] },
        }),
      });
      assert.equal(
        (await models.CampaignRecipient.findOne({ workspaceId: bob._id, campaignId: cb._id }))
          .status,
        "bounced"
      );
    }
  );
  await t.test("deleting lists preserves contacts and campaign history", async () => {
    assert.equal(
      (
        await request("/api/contact/delete-list", {
          token: a,
          method: "DELETE",
          body: { listName: "Customers" },
        })
      ).status,
      200
    );
    assert.equal(await models.ListMembership.countDocuments({ workspaceId: alice._id }), 0);
    assert.equal(await models.Contact.countDocuments({ workspaceId: alice._id }), 1);
    assert.equal(await models.Campaign.countDocuments({ workspaceId: alice._id }), 2);
    assert.equal((await request("/api/contact/lists", { token: b })).body.length, 1);
  });
  await t.test("untrusted SNS notifications are rejected and logout revokes sessions", async () => {
    process.env.SES_SNS_TOPIC_ARNS = "arn:aws:sns:us-east-1:123456789012:test";
    const result = await request("/api/campaign/ses-webhook", {
      method: "POST",
      body: { Type: "Notification", TopicArn: "arn:aws:sns:us-east-1:123456789012:other" },
    });
    assert.equal(result.status, 403);
    assert.equal((await request("/logout", { token: a, method: "POST" })).status, 200);
    assert.equal((await request("/api/contact/lists", { token: a })).status, 401);
    assert.equal((await request("/api/contact/lists", { token: b })).status, 200);
  });
});
