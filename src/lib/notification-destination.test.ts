import assert from "node:assert/strict";
import test from "node:test";
import { notificationDestination } from "./notification-destination";

test("new job notifications open Job Discovery instead of automation", () => {
  assert.equal(notificationDestination({
    notificationType: "new_matches",
    entityType: "agent_run",
    entityId: "search-run",
  }), "/matches");
  assert.equal(notificationDestination({
    notificationType: "new_matches",
    entityType: "source_connector",
    entityId: "connector",
  }), "/matches");
});

test("company and worker notifications continue to open automation", () => {
  assert.equal(notificationDestination({
    notificationType: "ai_task_complete",
    entityType: "company_research",
    entityId: "company-run",
  }), "/automation");
  assert.equal(notificationDestination({
    notificationType: "worker_failed",
    entityType: "background_job",
    entityId: "worker-run",
  }), "/automation");
});

test("entity-specific notifications retain their detail destinations", () => {
  assert.equal(notificationDestination({
    notificationType: "listing_expired",
    entityType: "job",
    entityId: "job-id",
  }), "/jobs/job-id");
  assert.equal(notificationDestination({
    notificationType: "ai_task_complete",
    entityType: "agent_run",
    entityId: "run-id",
    runEntityType: "resume",
    runEntityId: "resume-id",
  }), "/resumes/resume-id/edit?optimizationRun=run-id");
});
