import { HttpError } from "./http.js";

// SendGrid's status page migrated into Twilio. These are its published groups.
const groupIds = new Set([
  "87xnt5pfw06t",
  "vp66l5zb77p5",
  "qk6h2h9xyt0f",
  "sqwjyy7x2sc6",
  "bdnyxg9w62zm",
  "mn4033fd3lft",
  "r769mtd3rkhv",
  "txbr9hz1lqgh",
  "v8vgjrr4qwxs",
  "qk973259tk75",
]);
const componentStates = {
  operational: "none",
  under_maintenance: "maintenance",
  degraded_performance: "minor",
  partial_outage: "minor",
  major_outage: "major",
};
const severity = ["none", "maintenance", "minor", "major", "critical"];
const unavailable = () => new HttpError(502, "SendGrid 官方状态数据暂不可用");

export function parseSendGrid(data) {
  if (
    !Array.isArray(data?.components) ||
    !Array.isArray(data.incidents) ||
    !Array.isArray(data.scheduled_maintenances)
  )
    throw unavailable();

  const roots = data.components.filter(
    (component) =>
      groupIds.has(component.id) || /^SendGrid\b/i.test(component.name),
  );
  // A partial or changed schema must not silently turn into a healthy service.
  if (
    !roots.some(
      (c) => c.id === "87xnt5pfw06t" || c.name === "SendGrid Mail Sending",
    )
  )
    throw unavailable();
  const children = new Map();
  for (const component of data.components) {
    const siblings = children.get(component.group_id) ?? [];
    siblings.push(component);
    children.set(component.group_id, siblings);
  }
  const selected = new Set();
  const queue = [...roots];
  for (let i = 0; i < queue.length; i++) {
    const component = queue[i];
    if (selected.has(component.id)) continue;
    if (!component.id || !componentStates[component.status])
      throw unavailable();
    selected.add(component.id);
    queue.push(...(children.get(component.id) ?? []));
  }
  const components = data.components.filter((c) => selected.has(c.id));
  const affectsSendGrid = (event) =>
    event.components?.some((c) => selected.has(c.id));
  const incidents = data.incidents.filter(
    (event) =>
      !event.resolved_at &&
      ["investigating", "identified", "monitoring"].includes(event.status) &&
      affectsSendGrid(event),
  );
  const maintenance = data.scheduled_maintenances.filter(
    (event) =>
      ["in_progress", "verifying"].includes(event.status) &&
      affectsSendGrid(event),
  );
  const indicators = [
    ...components.map((c) => componentStates[c.status]),
    ...incidents.map((event) =>
      ["major", "critical"].includes(event.impact) ? event.impact : "minor",
    ),
    ...(maintenance.length ? ["maintenance"] : []),
  ];
  const indicator =
    severity[Math.max(...indicators.map((state) => severity.indexOf(state)))];
  return {
    status: {
      indicator,
      description:
        indicator === "none"
          ? "正常运行"
          : indicator === "maintenance"
            ? "维护中"
            : "存在服务故障",
    },
    components: components.map(({ id, name, status }) => ({
      id,
      name,
      status,
    })),
    incidents: [...incidents, ...maintenance].map(
      ({ id, name, status, updated_at, shortlink }) => ({
        id,
        name,
        status,
        updated_at,
        shortlink,
      }),
    ),
  };
}
