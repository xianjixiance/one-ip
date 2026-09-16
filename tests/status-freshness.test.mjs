import {
  QueryClient,
  QueryObserver,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  statusSnapshot,
  statusQueryPolicy,
  STATUS_MAX_AGE,
} from "../src/views/status/freshness.ts";
import { statusOrder } from "../src/views/status/order.ts";

const result = {
  status: { indicator: "none", description: "Healthy" },
  fetchedAt: "2026-09-16T12:00:00Z",
  incidents: [],
};
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("failed refresh moves a cached healthy or faulty result to unconfirmed", async () => {
  for (const indicator of ["none", "major"]) {
    const client = new QueryClient();
    let fail = false;
    const observer = new QueryObserver(client, {
      queryKey: ["service-status", indicator],
      ...statusQueryPolicy,
      queryFn: async () => {
        if (fail) throw new Error("offline");
        return { ...result, status: { indicator } };
      },
    });
    try {
      await observer.refetch();
      fail = true;
      await observer.refetch();
      const state = statusSnapshot(observer.getCurrentResult(), Date.now());
      assert.equal(state.freshness, "error");
      assert.equal(statusOrder(state.indicator), 2);
      assert.equal(state.previousIndicator, indicator);
      assert.equal(state.historical, true);
      fail = false;
      await observer.refetch();
      assert.equal(
        statusSnapshot(observer.getCurrentResult(), Date.now()).indicator,
        indicator,
      );
    } finally {
      client.clear();
    }
  }
});

test("five-minute expiry uses successful receipt time, not official event dates", () => {
  const now = Date.now();
  const query = {
    data: {
      ...result,
      incidents: [{ status: "identified", updated_at: "2020-01-01" }],
    },
    dataUpdatedAt: now,
    error: null,
    isPending: false,
  };
  assert.equal(statusSnapshot(query, now).freshness, "current");
  assert.equal(
    statusSnapshot(query, now + STATUS_MAX_AGE - 1).indicator,
    "none",
  );
  assert.equal(
    statusSnapshot(query, now + STATUS_MAX_AGE).freshness,
    "expired",
  );
  assert.equal(
    statusOrder(statusSnapshot(query, now + STATUS_MAX_AGE).indicator),
    2,
  );
  assert.equal(
    statusSnapshot(
      { ...query, dataUpdatedAt: now + STATUS_MAX_AGE },
      now + STATUS_MAX_AGE,
    ).freshness,
    "current",
  );
});

test("first load and initial failure never invent a previous status", () => {
  const query = { dataUpdatedAt: 0, isPending: true, error: null };
  assert.equal(statusSnapshot(query, Date.now()).freshness, "pending");
  assert.equal(
    statusSnapshot(
      { ...query, isPending: false, error: new Error() },
      Date.now(),
    ).historical,
    false,
  );
});

test("focus/reconnect refresh stale data, skip fresh data, and reuse an in-flight request", async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { networkMode: "always", refetchOnWindowFocus: false },
    },
  });
  const queryKey = ["service-status", "test"];
  client.setQueryData(queryKey, result);
  client.mount();
  let calls = 0;
  let finish;
  const observer = new QueryObserver(client, {
    queryKey,
    ...statusQueryPolicy,
    queryFn: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const stop = observer.subscribe(() => {});
  try {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await nextTurn();
    assert.equal(calls, 0, "fresh data must not cause extra requests");
    client.setQueryData(queryKey, result, { updatedAt: Date.now() - 61_000 });
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await nextTurn();
    assert.equal(calls, 1);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    const refresh = observer.refetch({ cancelRefetch: false });
    await nextTurn();
    assert.equal(
      calls,
      1,
      "simultaneous refresh triggers must share the request",
    );
    finish(result);
    await refresh;
    client.setQueryData(queryKey, result, { updatedAt: Date.now() - 61_000 });
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await nextTurn();
    assert.equal(calls, 2);
    finish(result);
    await nextTurn();
  } finally {
    stop();
    client.unmount();
    client.clear();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  }
});
