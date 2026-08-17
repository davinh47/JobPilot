export type SourceProvider = "greenhouse" | "lever" | "ashby";

export type NormalizedJob = {
  externalId: string;
  companyName: string;
  title: string;
  location: string | null;
  workplaceType: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  descriptionText: string;
  canonicalUrl: string;
  publishedAt: Date | null;
};

export type ConnectorInput = {
  provider: SourceProvider;
  name: string;
  boardToken: string;
  region: "global" | "eu";
};
