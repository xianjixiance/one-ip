import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getAiStatus } from "../public/worker/ai-status.js";
import { parseSendGrid } from "../public/worker/sendgrid-status.js";

const mail = {
  id: "87xnt5pfw06t",
  name: "SendGrid Mail Sending",
  status: "operational",
};
const smtp = {
  id: "smtp",
  name: "SMTP",
  group_id: mail.id,
  status: "operational",
};
const sms = { id: "sms", name: "SMS", status: "major_outage" };
const event = (id, component, extra = {}) => ({
  id,
  name: id,
  status: "identified",
  components: [component],
  impact: "minor",
  updated_at: "2026-01-01T00:00:00Z",
  ...extra,
});
const data = (extra = {}) => ({
  status: { indicator: "major" },
  components: [mail, smtp, sms],
  incidents: [event("SMS failure", sms)],
  scheduled_maintenances: [],
  ...extra,
});

test("SendGrid excludes Twilio SMS/voice outages and unrelated components", async (t) => {
  const services = JSON.parse(readFileSync("public/worker/services.json"));
  const service = services.find((s) => s.id === "2");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++;
    assert.equal(url, "https://status.twilio.com/api/v2/summary.json");
    return Response.json(data());
  });
  const result = await getAiStatus(service);
  assert.equal(calls, 1);
  assert.equal(result.status.indicator, "none");
  assert.deepEqual(result.incidents, []);
  assert.deepEqual(
    result.components.map((c) => c.id),
    [mail.id, smtp.id],
  );
});

test("SendGrid retains old unresolved incidents affecting child components", () => {
  const result = parseSendGrid(
    data({ incidents: [event("SMTP failure", smtp)] }),
  );
  assert.equal(result.status.indicator, "minor");
  assert.equal(result.incidents[0].updated_at, "2026-01-01T00:00:00Z");
  assert.equal(result.incidents[0].name, "SMTP failure");
  assert.equal(result.incidents[0].components, undefined);
});

test("SendGrid severity comes from its components, incidents and active maintenance", () => {
  assert.equal(
    parseSendGrid(
      data({ components: [mail, { ...smtp, status: "major_outage" }] }),
    ).status.indicator,
    "major",
  );
  assert.equal(
    parseSendGrid(
      data({ incidents: [event("Mail outage", mail, { impact: "critical" })] }),
    ).status.indicator,
    "critical",
  );
  assert.equal(
    parseSendGrid(
      data({
        scheduled_maintenances: [
          event("Mail maintenance", mail, { status: "in_progress" }),
        ],
      }),
    ).status.indicator,
    "maintenance",
  );
  assert.equal(
    parseSendGrid(
      data({
        scheduled_maintenances: [
          event("SMS maintenance", sms, { status: "in_progress" }),
        ],
      }),
    ).status.indicator,
    "none",
  );
});

test("resolved incidents and future/completed maintenance cannot keep SendGrid degraded", () => {
  const result = parseSendGrid(
    data({
      incidents: [
        event("resolved", smtp, { status: "resolved" }),
        event("closed", mail, { resolved_at: "2026-09-16T00:00:00Z" }),
      ],
      scheduled_maintenances: [
        event("future", mail, { status: "scheduled" }),
        event("done", mail, { status: "completed" }),
      ],
    }),
  );
  assert.equal(result.status.indicator, "none");
  assert.deepEqual(result.incidents, []);
});

test("SendGrid includes nested children and new explicitly named SendGrid groups", () => {
  const group = {
    id: "new",
    name: "SendGrid New Service",
    status: "operational",
  };
  const nested = {
    id: "nested",
    name: "Nested",
    group_id: smtp.id,
    status: "partial_outage",
  };
  const result = parseSendGrid(
    data({ components: [nested, group, sms, smtp, mail] }),
  );
  assert.equal(result.status.indicator, "minor");
  assert.deepEqual(
    result.components.map((c) => c.id),
    [nested.id, group.id, smtp.id, mail.id],
  );
});

test("missing SendGrid groups or unrecognized data fail instead of claiming healthy", () => {
  for (const value of [
    null,
    {},
    data({ components: [sms] }),
    data({ components: [{ ...mail, status: "unknown" }] }),
    data({ incidents: undefined }),
  ]) {
    assert.throws(
      () => parseSendGrid(value),
      (error) => error.status === 502,
    );
  }
});
