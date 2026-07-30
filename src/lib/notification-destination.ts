type NotificationDestinationInput = {
  notificationType: string;
  entityType: string | null;
  entityId: string | null;
  runEntityType?: string | null;
  runEntityId?: string | null;
};

export function notificationDestination(input: NotificationDestinationInput) {
  if (input.notificationType === "new_matches") return "/matches";
  if (input.entityType === "job" && input.entityId) return `/jobs/${input.entityId}`;
  if (input.entityType === "interview") return "/interviews";
  if (input.entityType === "resume" && input.entityId) return `/resumes/${input.entityId}/edit`;
  if (input.entityType === "agent_run" && input.entityId && input.runEntityType === "resume" && input.runEntityId) {
    return `/resumes/${input.runEntityId}/edit?optimizationRun=${input.entityId}`;
  }
  return "/automation";
}
