import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateResumeDocx, generateResumePdf, resumeTemplates } from "../src/lib/resume-export";
import type { PlatformResume } from "../src/lib/resume-format";

const fixture: PlatformResume = {
  schemaVersion: 1,
  basics: {
    fullName: "Alex Chen / 贺奕⽊",
    headline: "Product Manager | AI 产品经理",
    email: "alex.chen@example.com",
    phone: "+86 138 0000 0000",
    location: "Shanghai / 上海",
    links: "https://www.linkedin.com/in/example\nhttps://example.com",
    additionalInfo: "",
  },
  summary: "Product manager with 6+ years of experience building B2B workflow products across China and global markets.\n具备从⽤户研究、产品策略到跨职能交付的完整经验，重视可验证的业务结果与清晰沟通。",
  sections: [
    {
      id: "experience",
      type: "experience",
      title: "Experience / 工作经历",
      content: "Senior Product Manager | Northstar Software | 2022 - Present\n- Led discovery and delivery for an AI-assisted operations product used by 12 enterprise teams.\n- Reduced onboarding time by 34% through workflow redesign and measurable product experiments.\n- 与设计、工程和销售团队协作，建立季度路线图与用户反馈闭环。\n\nProduct Manager | Horizon Data | 2019 - 2022\n- Launched analytics capabilities from research through general availability.\n- Built a repeatable interview program covering more than 60 customer conversations.\n- 将关键任务完成率提升 21%，并建立持续追踪指标。",
    },
    {
      id: "projects",
      type: "projects",
      title: "Selected Projects / 项目经历",
      content: "AI Workflow Assistant | 2024\n- Defined the evaluation rubric, human review workflow, and source traceability requirements.\n- Coordinated staged rollout and documented model limitations for internal stakeholders.\n\nInternational Expansion Research | 2023\n- Synthesized market, customer, and compliance findings into a phased product plan.",
    },
    {
      id: "skills",
      type: "skills",
      title: "Skills / 技能",
      content: "Product strategy, user research, roadmap planning, experimentation, SQL, analytics\n产品策略、用户研究、路线图规划、实验设计、跨团队协作",
    },
    {
      id: "education",
      type: "education",
      title: "Education / 教育经历",
      content: "M.S. in Information Systems | Example University | 2019\nB.A. in Business Administration | Sample University | 2017",
    },
  ],
};

async function main() {
  const outputDirectory = resolve("tmp/resume-export-qa");
  await mkdir(outputDirectory, { recursive: true });

  for (const template of resumeTemplates) {
    await writeFile(resolve(outputDirectory, `${template}.docx`), await generateResumeDocx(fixture, template));
    await writeFile(resolve(outputDirectory, `${template}.pdf`), await generateResumePdf(fixture, template));
  }

  console.log(outputDirectory);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
