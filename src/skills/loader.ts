import { readFile, readdir, stat } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  version?: string;
  requirements?: {
    binaries?: string[];
    envVars?: string[];
  };
}

export interface Skill {
  metadata: SkillMetadata;
  content: string;
  // available: requirements are satisfied at startup (checked once, frozen for the session)
  // activated (LLM-triggered full skill load) is handled at the channel/prompt layer — Phase 12
  available: boolean;
}

function getWorkspacePath(): string {
  const workspace = process.env.AGENT_WORKSPACE;
  if (!workspace) {
    throw new Error('AGENT_WORKSPACE environment variable is required');
  }
  return workspace;
}

function getSkillsPath(): string {
  return join(getWorkspacePath(), 'skills');
}

function parseYamlFrontmatter(content: string): { metadata: Record<string, unknown>; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { metadata: {}, body: content };
  }

  const yamlContent = match[1] ?? '';
  const body = match[2] ?? '';
  const metadata = (parseYaml(yamlContent) as Record<string, unknown>) ?? {};

  return { metadata, body };
}

function checkRequirements(requirements?: SkillMetadata['requirements']): { satisfied: boolean; missing: string[] } {
  if (!requirements) {
    return { satisfied: true, missing: [] };
  }

  const missing: string[] = [];

  if (requirements.binaries) {
    for (const binary of requirements.binaries) {
      try {
        execSync(`which ${binary}`, { stdio: 'ignore' });
      } catch {
        missing.push(`binary: ${binary}`);
      }
    }
  }

  if (requirements.envVars) {
    for (const envVar of requirements.envVars) {
      if (!process.env[envVar]) {
        missing.push(`env: ${envVar}`);
      }
    }
  }

  return { satisfied: missing.length === 0, missing };
}

export async function loadSkills(): Promise<Skill[]> {
  const skillsPath = getSkillsPath();
  const skills: Skill[] = [];

  try {
    const entries = await readdir(skillsPath);
    for (const entry of entries) {
      const skillDir = join(skillsPath, entry);
      const skillStat = await stat(skillDir);

      if (!skillStat.isDirectory()) continue;

      const skillFile = join(skillDir, 'SKILL.md');

      try {
        const content = await readFile(skillFile, 'utf-8');
        const { metadata, body } = parseYamlFrontmatter(content);

        const skillMetadata: SkillMetadata = {
          id: entry,
          name: (metadata.name as string) || entry,
          description: (metadata.description as string) || '',
          version: metadata.version as string,
          requirements: metadata.requirements as SkillMetadata['requirements'],
        };

        const { satisfied, missing } = checkRequirements(skillMetadata.requirements);

        skills.push({
          metadata: skillMetadata,
          content: body,
          available: satisfied,
        });

        if (!satisfied) {
          console.warn(`Skill "${entry}" skipped: missing ${missing.join(', ')}`);
        }
      } catch (error) {
        console.warn(`Failed to load skill "${entry}":`, error);
      }
    }
  } catch (error) {
    console.warn('No skills directory found or error reading:', error);
  }

  return skills.sort((a, b) => a.metadata.id.localeCompare(b.metadata.id));
}

export function generateSkillsMetadataXml(skills: Skill[]): string {
  if (skills.length === 0) {
    return '';
  }

  const availableSkills = skills
    .filter((s) => s.available)
    .map((s) => {
      return `    <skill id="${s.metadata.id}" name="${s.metadata.name}">${s.metadata.description}</skill>`;
    })
    .join('\n');

  return `
<skills>
${availableSkills}
</skills>

To activate a skill, mention "activate skill: <skill-id>" in your response.`;
}

export function getSkillContent(skills: Skill[], skillId: string): string | null {
  const skill = skills.find((s) => s.metadata.id === skillId);
  if (!skill) {
    return null;
  }
  if (!skill.available) {
    return null;
  }
  return skill.content;
}
