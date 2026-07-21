import type { DesignProject, DesignProjectMeta } from '@/types/solutions';

/**
 * 方案列表 demo seed rows — customer fields aligned with 報價一覽 / PMS pitching.
 * Keys = fixed design_projects.id from migrations/20250148_seed_design_projects.sql
 */
export type SolutionDemoCustomerPatch = {
  name: string;
  clientCompany: string;
  clientName: string;
  /** Fallback when live PMS lookup is unavailable. */
  pmLabel?: string;
  meta?: DesignProjectMeta;
};

export const SOLUTION_DEMO_PROJECT_CUSTOMERS: Record<string, SolutionDemoCustomerPatch> = {
  '11111111-1111-1111-1111-111111111111': {
    name: '伊利沙伯中學舊生會中學 課室及辦公傢俬',
    clientCompany: '伊利沙伯中學舊生會中學',
    clientName: '黃智穎',
    pmLabel: 'Michael Lee',
    meta: {
      projectType: 'school',
      pitchingCode: 'BWF-SH26-060',
      quoteId: 'BWF-SH26-060',
    },
  },
  '22222222-2222-2222-2222-222222222222': {
    name: 'HK PolyU Charlene Zhou 傢俬方案',
    clientCompany: 'HK PolyU Charlene Zhou',
    clientName: 'Charlene Zhou',
    pmLabel: 'Michael Lee',
    meta: {
      projectType: 'school',
      pitchingCode: 'BWF-SH26-061',
      quoteId: 'BWF-SH26-061',
    },
  },
  '33333333-3333-3333-3333-333333333333': {
    name: '仁濟醫院 診所傢俬配置',
    clientCompany: '仁濟醫院',
    clientName: 'Yan Chai Hospital',
    pmLabel: 'Rachel Zhu',
    meta: {
      projectType: 'clinic',
      pitchingCode: 'BWF-SH26-058',
    },
  },
};

/** Apply 報價一覽-aligned customer labels to known demo seed projects. */
export function applySolutionDemoCustomerPatch(project: DesignProject): DesignProject {
  const patch = SOLUTION_DEMO_PROJECT_CUSTOMERS[project.id];
  if (!patch) return project;
  return {
    ...project,
    name: patch.name,
    clientCompany: patch.clientCompany,
    clientName: patch.clientName,
    meta: { ...(project.meta ?? {}), ...(patch.meta ?? {}) },
  };
}
