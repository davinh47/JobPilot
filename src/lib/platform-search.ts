export type JobPlatform = {
  id: "linkedin" | "seek" | "zhipin" | "zhaopin" | "51job" | "liepin";
  name: string;
  marketsZh: string;
  marketsEn: string;
  requiresLogin: boolean;
  buildUrl: (title: string, location: string) => string;
};

function query(values: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value.trim()) params.set(key, value.trim());
  }
  return params.toString();
}

export const jobPlatforms: JobPlatform[] = [
  {
    id: "linkedin",
    name: "LinkedIn",
    marketsZh: "全球职位",
    marketsEn: "Global roles",
    requiresLogin: true,
    buildUrl: (title, location) => `https://www.linkedin.com/jobs/search/?${query({ keywords: title, location })}`,
  },
  {
    id: "seek",
    name: "SEEK",
    marketsZh: "澳大利亚、新西兰",
    marketsEn: "Australia and New Zealand",
    requiresLogin: false,
    buildUrl: (title, location) => `https://www.seek.com.au/jobs?${query({ keywords: title, where: location })}`,
  },
  {
    id: "zhipin",
    name: "BOSS直聘",
    marketsZh: "中国大陆",
    marketsEn: "Mainland China",
    requiresLogin: true,
    buildUrl: (title) => `https://www.zhipin.com/web/geek/jobs?${query({ query: title })}`,
  },
  {
    id: "zhaopin",
    name: "智联招聘",
    marketsZh: "中国大陆",
    marketsEn: "Mainland China",
    requiresLogin: false,
    buildUrl: (title, location) => `https://sou.zhaopin.com/?${query({ kw: title, jl: location })}`,
  },
  {
    id: "51job",
    name: "前程无忧",
    marketsZh: "中国大陆",
    marketsEn: "Mainland China",
    requiresLogin: false,
    buildUrl: (title) => `https://we.51job.com/pc/search?${query({ keyword: title })}`,
  },
  {
    id: "liepin",
    name: "猎聘",
    marketsZh: "中国大陆、中高端职位",
    marketsEn: "Mainland China, professional roles",
    requiresLogin: false,
    buildUrl: (title) => `https://www.liepin.com/zhaopin/?${query({ key: title })}`,
  },
];
