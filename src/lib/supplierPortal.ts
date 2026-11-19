import { supabase } from '@/lib/supabase';
import { parseInvokeError } from '@/lib/edgeFunctionErrors';

export interface SupplierCompany {
  id: string;
  /** Internal sort name, e.g. "1.向氏 QXS". Never show this to suppliers. */
  display_name: string | null;
  /** Real factory name from PMS, e.g. "向氏". */
  factory_name: string | null;
  factory_eng_name: string | null;
  factory_code: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  location: string | null;
  join_date: string | null;
  key_product_categories: string | null;
  status: string | null;
  project_number: number | null;
  remarks: string | null;
}

export interface SupplierComplianceFile {
  id: string;
  type_name: string | null;
  file_name: string | null;
  institution: string | null;
  code_number: string | null;
  expiry_date: string | null;
  created_date: string | null;
}

export interface SupplierFactoryFile {
  id: string;
  file_name: string | null;
  file: string | null;
  created_date: string | null;
}

export interface SupplierCompliance {
  linked: boolean;
  supplier: { id: string; display_name: string | null } | null;
  files: SupplierComplianceFile[];
  /** Used when the factory has no PMS supplier master. */
  factory_files?: SupplierFactoryFile[];
  factory_status?: string | null;
  factory_join_date?: string | null;
}

export async function loadSupplierCompany(): Promise<{
  company: SupplierCompany | null;
  compliance: SupplierCompliance | null;
  error: string | null;
}> {
  const slugs = ['supabase-functions-supplier-company', 'supplier-company'];
  let lastError = '未能讀取 PMS 公司資料';
  for (const slug of slugs) {
    const { data, error } = await supabase.functions.invoke(slug, { body: {} });
    if (error) {
      lastError = await parseInvokeError(error, data);
      if (/not found|404/i.test(lastError)) continue;
      return { company: null, compliance: null, error: lastError };
    }
    const payload = data as {
      error?: string;
      company?: SupplierCompany | null;
      compliance?: SupplierCompliance | null;
    } | null;
    if (payload?.error) return { company: null, compliance: null, error: payload.error };
    return {
      company: payload?.company ?? null,
      compliance: payload?.compliance ?? null,
      error: null,
    };
  }
  return { company: null, compliance: null, error: lastError };
}
