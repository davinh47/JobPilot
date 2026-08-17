export type ResumeSectionType = "experience_projects" | "experience" | "education" | "skills" | "projects" | "certifications" | "other";

export type ResumeEntry = {
  id: string;
  kind: ResumeSectionType;
  organization: string;
  position: string;
  school: string;
  degree: string;
  fieldOfStudy: string;
  projectName: string;
  role: string;
  name: string;
  issuer: string;
  category: string;
  title: string;
  subtitle: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  date: string;
  url: string;
  description: string;
  highlights: string[];
  skills: string[];
};

export type ResumeSection = {
  id: string;
  type: ResumeSectionType;
  title: string;
  content: string;
  entries?: ResumeEntry[];
};

export type PlatformResume = {
  schemaVersion: 1 | 2;
  basics: {
    fullName: string;
    headline: string;
    email: string;
    phone: string;
    location: string;
    links: string;
    additionalInfo: string;
  };
  summary: string;
  sections: ResumeSection[];
};
