import { jobDescriptionHeading, parseStructuredJobDescription, structureJobDescription } from "@/lib/job-description";
import type { Locale } from "@/lib/i18n";

function isBullet(line: string) {
  return /^[-*•▪◦·]\s*/.test(line) || /^\d+[.)、]\s*/.test(line);
}

function withoutBullet(line: string) {
  return line.replace(/^[-*•▪◦·]\s*|^\d+[.)、]\s*/, "").trim();
}

export function JobDescriptionView({ description, locale }: { description: string; locale: Locale }) {
  const normalized = /^##\s/m.test(description) ? description : structureJobDescription(description);
  const blocks = parseStructuredJobDescription(normalized);

  return <div className="job-description-view">
    {blocks.map((block, blockIndex) => {
      const groups: Array<{ kind: "list" | "paragraph"; lines: string[] }> = [];
      for (const line of block.lines) {
        const kind = isBullet(line) ? "list" : "paragraph";
        const prior = groups.at(-1);
        if (prior?.kind === kind) prior.lines.push(line);
        else groups.push({ kind, lines: [line] });
      }
      return <section className="job-description-section" key={`${block.section}-${blockIndex}`}>
        <h3>{jobDescriptionHeading(block.section, locale)}</h3>
        {groups.map((group, groupIndex) => group.kind === "list"
          ? <ul key={groupIndex}>{group.lines.map((line, lineIndex) => <li key={lineIndex}>{withoutBullet(line)}</li>)}</ul>
          : <div key={groupIndex}>{group.lines.map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}</div>)}
      </section>;
    })}
  </div>;
}
