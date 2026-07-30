export const applicationStages = [
  { value: "to_apply", label: "待申请" },
  { value: "applied", label: "已申请" },
  { value: "interview_pending", label: "待面试" },
  { value: "interviewed", label: "已面试" },
  { value: "offer", label: "Offer" },
  { value: "declined", label: "Declined" },
] as const;

export const listingStatusLabels: Record<string, string> = {
  unknown: "待核验",
  active: "招聘中",
  possibly_expired: "可能失效",
  expired: "已失效",
};

export const applicationStatusLabels = Object.fromEntries(
  applicationStages.map((stage) => [stage.value, stage.label]),
);
