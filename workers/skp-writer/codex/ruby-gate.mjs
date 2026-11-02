// Decides whether one eval_ruby call may run. New geometry must come from the job's build_model.rb,
// loaded in the single form `load '<script>'; FdsBuild.batch('<name>')`. This guards against the
// habit of inlining geometry; it is not a sandbox (the script itself can do anything Ruby can).
import { resolve } from 'node:path';

const SCRIPT_CALL = /^\s*load\s*\(?\s*(['"])([^'"\n]+)\1\s*\)?\s*;?\s*FdsBuild\.batch\(\s*(['"])([^'"\n]{1,80})\3\s*\)\s*;?\s*$/u;

const GEOMETRY = /\b(add_face|add_faces_from_mesh|add_edges|add_line|add_curve|add_arc|add_circle|add_ngon|add_polygon|add_group|add_instance|add_3d_text|add_cpoint|add_cline|add_text|add_dimension_linear|add_dimension_radial|pushpull|followme|fill_from_mesh|intersect_with|outer_shell)\b|\bdefinitions\.add\b|\bFdsKit\.(part|mesh|box|rounded_box|tube)\b/u;
const OPERATION = /\b(start_operation|commit_operation|abort_operation)\b/u;
const DYNAMIC = /\b(send|public_send|__send__|instance_eval|class_eval|module_eval|instance_exec|class_exec|module_exec|eval|binding|define_method|const_get)\b/u;
// Kernel#load / require only; `model.materials.load(path)` stays allowed.
const KERNEL_LOAD = /(?<![.\w])(load|require|require_relative|autoload)\b/u;

const samePath = (a, b) => resolve(a).replaceAll('\\', '/').toLowerCase() === resolve(b).replaceAll('\\', '/').toLowerCase();

/**
 * @returns {{ allowed: true, script_load: boolean, batch?: string } | { allowed: false, reason: string }}
 */
export function checkRubyCall(code, scriptPath) {
  try {
    const text = String(code ?? '');
    const call = text.match(SCRIPT_CALL);
    if (call) {
      if (!scriptPath) return { allowed: false, reason: 'script_unconfigured: 本任務沒有設定腳本路徑' };
      if (!samePath(call[2], scriptPath)) return { allowed: false, reason: `script_path: 只能載入本任務的 ${scriptPath}` };
      return { allowed: true, script_load: true, batch: call[4] };
    }
    if (GEOMETRY.test(text)) {
      return { allowed: false, reason: `script_required: 新建幾何必須寫進 build_model.rb，再用 eval_ruby 只送 load '${scriptPath}'; FdsBuild.batch('<批次名>')` };
    }
    if (OPERATION.test(text)) return { allowed: false, reason: 'operation_forbidden: 每次 eval_ruby 已自動包成一個操作，不要自己呼叫 start/commit/abort_operation' };
    if (DYNAMIC.test(text) || KERNEL_LOAD.test(text)) {
      return { allowed: false, reason: 'dynamic_forbidden: 不要用 load/require/eval/send 等動態呼叫；載入腳本只用固定格式' };
    }
    return { allowed: true, script_load: false };
  } catch (error) {
    return { allowed: false, reason: `gate_error: ${error?.message ?? error}` };
  }
}

const WRITABLE = /^(build_model\.rb|outputs\/report\.json)$/u;

/** Relative paths Codex may write through write_job_file; returns the absolute path or throws. */
export function jobFilePath(jobDir, relativePath) {
  const rel = String(relativePath ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!jobDir) throw new Error('job directory not configured');
  if (!WRITABLE.test(rel)) throw new Error('只能寫 build_model.rb 或 outputs/report.json');
  return resolve(jobDir, rel);
}
