import { supabase } from '@/lib/supabase';

/** Same string the bundled worker reports (workers/skp-writer/worker.mjs); older ones drop colours and holes. */
export const CURRENT_SKP_WORKER_VERSION = 'device-auth-2';

export interface SkpPairing {
  code: string;
  environment: 'production' | 'branch';
  computerName: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  tasks: string[];
  canAuthorize: boolean;
}

export interface SkpDeviceRow {
  id: string;
  computerName: string;
  environment: 'production' | 'branch';
  workerVersion: string | null;
  status: string;
  revokeReason: string | null;
  approvedAt: string;
  expiresAt: string;
  approverEmail: string | null;
  lastHeartbeatAt: string | null;
  ready: boolean;
  checks: Record<string, boolean> | null;
  currentJobId: string | null;
  currentJobType: string | null;
}

type RpcRow = Record<string, unknown>;

function asError(value: unknown, fallback: string) {
  if (value && typeof value === 'object' && 'error' in value && typeof (value as RpcRow).error === 'string') {
    return (value as RpcRow).error as string;
  }
  return fallback;
}

export function skpDeviceError(code: string) {
  switch (code) {
    case 'permission_denied':
      return '請由管理員、PM 或設計師授權';
    case 'not_found':
      return '找不到這組配對碼，或已經失效。';
    case 'expired':
      return '配對已過期，請在安裝程式重新開始。';
    case 'already_decided':
      return '這次配對已經處理過。';
    case 'rate_limited':
      return '操作太頻繁，請稍後再試。';
    case 'different_admin_required':
      return '需要另一位同事重新批准。';
    case 'not_suspended':
      return '這台電腦不是暫停狀態。';
    default:
      return '暫時無法完成，請再試一次。';
  }
}

export function skpEnvironmentLabel(environment: string) {
  return environment === 'production' ? '正式環境' : environment === 'branch' ? '測試環境' : environment;
}

function pairingFrom(row: RpcRow): SkpPairing {
  return {
    code: String(row.code ?? ''),
    environment: row.environment === 'branch' ? 'branch' : 'production',
    computerName: String(row.computer_name ?? ''),
    status: String(row.status ?? ''),
    createdAt: String(row.created_at ?? ''),
    expiresAt: String(row.expires_at ?? ''),
    tasks: Array.isArray(row.tasks) ? row.tasks.map(String) : [],
    canAuthorize: row.can_authorize === true || row.is_admin === true,
  };
}

export async function lookupSkpPairing(code: string): Promise<SkpPairing> {
  const { data, error } = await supabase.rpc('fds_skp_device_pairing_lookup', { p_code: code });
  if (error) throw new Error(error.message.includes('permission_denied') ? 'permission_denied' : 'lookup_failed');
  const row = (data ?? {}) as RpcRow;
  if (typeof row.error === 'string') throw new Error(row.error);
  return pairingFrom(row);
}

export async function decideSkpPairing(code: string, approve: boolean) {
  const { data, error } = await supabase.rpc('fds_skp_device_pairing_decide', {
    p_code: code,
    p_approve: approve,
    p_reason: approve ? null : 'rejected',
  });
  if (error) throw new Error(error.message.includes('permission_denied') ? 'permission_denied' : 'decide_failed');
  const row = (data ?? {}) as RpcRow;
  if (typeof row.error === 'string') throw new Error(row.error);
  return String(row.status ?? '');
}

export async function listSkpDevices(): Promise<SkpDeviceRow[]> {
  const { data, error } = await supabase.rpc('fds_skp_devices_admin_list');
  if (error) throw new Error(error.message.includes('permission_denied') ? 'permission_denied' : 'list_failed');
  const rows = Array.isArray(data) ? data : [];
  return rows.map((item) => {
    const row = item as RpcRow;
    return {
      id: String(row.id ?? ''),
      computerName: String(row.computer_name ?? ''),
      environment: row.environment === 'branch' ? 'branch' : 'production',
      workerVersion: row.worker_version ? String(row.worker_version) : null,
      status: String(row.status ?? ''),
      revokeReason: row.revoke_reason ? String(row.revoke_reason) : null,
      approvedAt: String(row.approved_at ?? ''),
      expiresAt: String(row.expires_at ?? ''),
      approverEmail: row.approver_email ? String(row.approver_email) : null,
      lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
      ready: row.ready === true,
      checks: row.checks && typeof row.checks === 'object' ? row.checks as Record<string, boolean> : null,
      currentJobId: row.current_job_id ? String(row.current_job_id) : null,
      currentJobType: row.current_job_type ? String(row.current_job_type) : null,
    };
  });
}

export async function revokeSkpDevice(id: string) {
  const { data, error } = await supabase.rpc('fds_skp_device_admin_revoke', {
    p_device_id: id,
    p_reason: 'admin_revoke',
  });
  if (error) throw new Error(asError(data, 'revoke_failed'));
  const row = (data ?? {}) as RpcRow;
  if (typeof row.error === 'string') throw new Error(row.error);
}

export async function reapproveSkpDevice(id: string) {
  const { data, error } = await supabase.rpc('fds_skp_device_admin_reapprove', { p_device_id: id });
  if (error) throw new Error(error.message.includes('permission_denied') ? 'permission_denied' : 'reapprove_failed');
  const row = (data ?? {}) as RpcRow;
  if (typeof row.error === 'string') throw new Error(row.error);
}
