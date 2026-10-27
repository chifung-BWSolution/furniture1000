import { supabase } from '@/lib/supabase';
import { parseInvokeError } from '@/lib/edgeFunctionErrors';
import { projectTypeLabel, type ProjectEngineeringType } from '@/lib/projectPartitionTemplates';

export interface PresentationProjectOption {
  id: string;
  name: string;
  projectType: string | null;
  note: string | null;
  code?: string | null;
  customerName?: string | null;
  client?: PresentationClientOption | null;
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

async function lookup<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>(
    'supabase-functions-fetch-pms-pitchings', { body },
  );
  if (error) throw new Error(await parseInvokeError(error, data));
  if (!data || data.error) throw new Error(data?.error || 'PMS 搜尋未回傳資料');
  return data;
}

export async function loadPresentationClients(search = ''): Promise<PresentationClientOption[]> {
  const result = await lookup<{ clients: PresentationClientOption[] }>({ action: 'presentation_clients', search });
  if (!Array.isArray(result.clients)) throw new Error('PMS 客戶搜尋服務尚未更新');
  return result.clients;
}

export async function loadPresentationProjects(options: { search?: string; customerId?: string } = {}): Promise<PresentationProjectOption[]> {
  const result = await lookup<{ projects: PresentationProjectOption[] }>({
    action: 'presentation_projects', search: options.search ?? '', customer_id: options.customerId,
  });
  if (!Array.isArray(result.projects)) throw new Error('PMS 專案搜尋服務尚未更新');
  return result.projects;
}
