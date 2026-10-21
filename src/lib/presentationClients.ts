import { supabase } from '@/lib/supabase';
import { projectTypeLabel, type ProjectEngineeringType } from '@/lib/projectPartitionTemplates';

/** Furniture client master. There is no page titled 客戶管理; this is the clients table. */
export const PRESENTATION_CLIENT_TABLE = 'client_companies';

export interface PresentationProjectOption {
  id: string;
  name: string;
  projectType: string | null;
  note: string | null;
}

export interface PresentationClientOption {
  id: string;
  name: string;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  projects: PresentationProjectOption[];
}

const KNOWN_TYPES = new Set<ProjectEngineeringType>(['office', 'school', 'clinic', 'hotel', 'other']);

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function nextFieldValue(
  current: string | undefined,
  suggestion: string,
  lastAuto: string | null,
  max: number,
): { value: string; auto: string | null } {
  const cur = current ?? '';
  const next = suggestion.trim().slice(0, max);
  const untouched = !cur.trim() || (lastAuto != null && cur === lastAuto);
  if (!untouched || !next) return { value: cur, auto: lastAuto };
  return { value: next, auto: next };
}

export function clientPurposeDefault(client: PresentationClientOption): string {
  const labels = [...new Set(
    client.projects
      .map((project) => project.projectType)
      .filter((type): type is string => Boolean(type && KNOWN_TYPES.has(type as ProjectEngineeringType)))
      .map((type) => projectTypeLabel(type)),
  )];
  if (labels.length === 0) return '';
  return `工程類型：${labels.join('、')}`;
}

export function projectOptionHint(project: PresentationProjectOption): string | null {
  if (!project.projectType || !KNOWN_TYPES.has(project.projectType as ProjectEngineeringType)) return null;
  return projectTypeLabel(project.projectType);
}

export function projectPurposeDefault(project: PresentationProjectOption): string {
  if (!project.projectType || !KNOWN_TYPES.has(project.projectType as ProjectEngineeringType)) return '';
  return `工程類型：${projectTypeLabel(project.projectType)}`;
}

export function clientContentDefault(client: PresentationClientOption): string {
  const lines: string[] = [];
  if (client.contactPerson) lines.push(`聯絡人：${client.contactPerson}`);
  if (client.contactPhone) lines.push(`電話：${client.contactPhone}`);
  if (client.contactEmail) lines.push(`電郵：${client.contactEmail}`);
  if (client.address) lines.push(`地址：${client.address}`);
  const notes = [...new Set(client.projects.map((project) => project.note).filter((note): note is string => Boolean(note)))];
  if (notes.length > 0) lines.push(`客戶備註：${notes.join('；')}`);
  return lines.join('\n');
}

export function projectContentDefault(client: PresentationClientOption, project: PresentationProjectOption): string {
  const lines: string[] = [];
  if (client.contactPerson) lines.push(`聯絡人：${client.contactPerson}`);
  if (client.contactPhone) lines.push(`電話：${client.contactPhone}`);
  if (client.contactEmail) lines.push(`電郵：${client.contactEmail}`);
  if (client.address) lines.push(`地址：${client.address}`);
  if (project.note) lines.push(`客戶備註：${project.note}`);
  return lines.join('\n');
}

interface CompanyRow {
  id: string;
  name: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
}

interface ProjectRow {
  id: string;
  name: string | null;
  client_company: string | null;
  project_type: string | null;
  reply_note: string | null;
}

export async function loadPresentationClients(): Promise<PresentationClientOption[]> {
  const [companies, projects] = await Promise.all([
    supabase
      .from('client_companies')
      .select('id, name, contact_person, contact_email, contact_phone, address')
      .order('name', { ascending: true }),
    supabase
      .from('design_projects')
      .select('id, name, client_company, project_type:meta->>projectType, reply_note:meta->clientQuoteReply->>note')
      .order('updated_at', { ascending: false }),
  ]);
  if (companies.error) throw new Error(companies.error.message);
  if (projects.error) throw new Error(projects.error.message);

  const byCompany = new Map<string, PresentationProjectOption[]>();
  for (const row of (projects.data ?? []) as ProjectRow[]) {
    const key = norm(row.client_company);
    const name = text(row.name);
    if (!key || !name) continue;
    const list = byCompany.get(key) ?? [];
    list.push({
      id: row.id,
      name,
      projectType: text(row.project_type) || null,
      note: text(row.reply_note) || null,
    });
    byCompany.set(key, list);
  }

  return ((companies.data ?? []) as CompanyRow[])
    .map((row) => {
      const name = text(row.name);
      if (!name) return null;
      return {
        id: row.id,
        name,
        contactPerson: text(row.contact_person) || null,
        contactEmail: text(row.contact_email) || null,
        contactPhone: text(row.contact_phone) || null,
        address: text(row.address) || null,
        projects: byCompany.get(norm(name)) ?? [],
      };
    })
    .filter((row): row is PresentationClientOption => row !== null);
}
