import assert from "node:assert/strict";
import test from "node:test";
import { adjustedNotificationCount } from "./notification-count";

test("notification mutations remove unread badges optimistically", () => {
  assert.equal(adjustedNotificationCount(3, "decrement"), 2);
  assert.equal(adjustedNotificationCount(1, "decrement"), 0);
  assert.equal(adjustedNotificationCount(4, "clear"), 0);
  assert.equal(adjustedNotificationCount(0, "decrement"), 0);
  assert.equal(adjustedNotificationCount(2, "refresh"), 2);
});
