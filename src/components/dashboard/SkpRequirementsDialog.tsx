import { useState } from 'react';
import { AlertCircle, CheckCircle2, CircleX, Download, ExternalLink, Info, Loader2, Monitor, RotateCcw, Search, Settings } from 'lucide-react';
import { Modal, ModalButton } from '@/components/ui/modal';
import { fetchSkpRequirements, type CodexCheckKey, type SkpRequirements } from '@/lib/productModels';

const DOWNLOAD_URL = 'https://help.sketchup.com/en/downloading-sketchup';
const SDK_URL = 'https://developer.sketchup.com/';

type RequirementMode = 'parametric' | 'codex';

const CODEX_CHECKS: [CodexCheckKey, string, string][] = [
  ['sketchup', 'SketchUp 桌面版', '已授權並完成首次模板設定'],
  ['seed', 'SketchUp 種子模型', '首次安裝時開啟 SketchUp 選擇模板後產生'],
  ['codex_cli', 'Codex CLI', '安裝 Codex 桌面版或 CLI'],
  ['codex_login', 'Codex 登入', '在 Worker 電腦用該帳號登入 Codex（Worker 不收集密碼）'],
  ['mcp_bridge', 'SketchUp MCP 橋接', '隨最新版 SKP Worker 安裝'],
  ['session_ruby', 'SketchUp 專用工作階段腳本', '隨最新版 SKP Worker 安裝'],
];

/** Shared by both SU entry points; failure stays in the dialog instead of a toast. */
export function useSkpRequirements() {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<SkpRequirements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RequirementMode>('parametric');
  const readyFor = (value: SkpRequirements | null, which: RequirementMode) =>
    which === 'codex' ? value?.codex_ready === true : value?.ready === true;

  const check = async (retry = false, nextMode: RequirementMode = 'parametric'): Promise<boolean> => {
    // 生成按鈕已經有進度窗。環境就緒時不要再疊一個檢測窗；只有未就緒或這窗裡的「重新檢測」才打開。
    setMode(nextMode);
    if (retry) setOpen(true);
    setChecking(true);
    setError(null);
    if (!retry) setResult(null);
    try {
      const next = await fetchSkpRequirements();
      setResult(next);
      const ready = readyFor(next, nextMode);
      setOpen(!ready || retry);
      return ready;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOpen(true);
      return false;
    } finally {
      setChecking(false);
    }
  };

  const status = (value: boolean | null | undefined, icon = false) => (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${value === true ? 'bg-emerald-50 text-emerald-700' : value === false ? 'bg-rose-50 text-rose-600' : 'bg-slate-200/60 text-slate-500'}`}>
      {icon && (value === true ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />)}
      {value === true ? '已找到' : value === false ? '缺少' : '未能確認'}
    </span>
  );
  const checks = result?.checks;
  const sdkValues = [checks?.writer, checks?.api_dll, checks?.preferences_dll];
  const sdkStatus = sdkValues.every((value) => value === true) ? true : sdkValues.some((value) => value === false) ? false : null;
  const linkClass = 'inline-flex items-center gap-2 text-sm font-medium text-[#5146ff] underline underline-offset-4 hover:text-[#4036d9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5146ff]';
  const sectionClass = 'flex items-start gap-4 rounded-xl border border-slate-200/70 bg-slate-50/80 p-4 sm:p-5';
  const iconClass = 'hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#eeecff] text-[#574dff] sm:flex';
  const dialog = (
    <Modal
      open={open}
      onOpenChange={(value) => { if (!checking) setOpen(value); }}
      size="3xl"
      icon={<Search />}
      title="SU 生成環境檢測"
      description="檢查 Windows Worker 電腦上的生成環境。"
      hideClose={checking}
      footer={
        <>
          <ModalButton variant="secondary" disabled={checking} onClick={() => setOpen(false)}>關閉</ModalButton>
          {!readyFor(result, mode) && <ModalButton disabled={checking} onClick={() => void check(true, mode)}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}重新檢測
          </ModalButton>}
        </>
      }
    >
      <div className="space-y-5" aria-live="polite" aria-busy={checking}>
        {checking ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />正在檢測 Worker 及寫檔程式…</p> : error ? (
          <p className="text-sm text-destructive">{error}。請確認網絡及登入狀態，再重新檢測。</p>
        ) : readyFor(result, mode) ? (
          <p className="text-sm">生成環境已就緒，請關閉此視窗後再次點擊生成 SU。</p>
        ) : result && mode === 'codex' ? <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-50 px-5 py-4 text-rose-600">
            <AlertCircle className="h-7 w-7 shrink-0 fill-rose-500 text-white" />
            <p className="min-w-0 flex-1 text-sm font-semibold sm:text-base">
              {result.codex_connected ? 'Codex Worker 已連線，但建模環境尚未齊備。' : '未有支援本機 Codex 建模的 SKP Worker 上線。'}
            </p>
            <a href="/assets/downloads/FDS-SKP-Worker-Setup.exe" download className="inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4 hover:text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600">
              <Download className="h-4 w-4" />下載最新版 SKP Worker
            </a>
          </div>
          <div className={sectionClass}>
            <span className={iconClass}><Monitor className="h-6 w-6" /></span>
            <div className="min-w-0 flex-1 space-y-3 text-sm leading-relaxed text-slate-500">
              <h3 className="text-base font-semibold text-slate-950 sm:text-lg">Worker 電腦上的本機建模環境</h3>
              {!result.codex_checks && <p>Worker 尚未回報 Codex 狀態（可能是舊版 Worker）。請更新 SKP Worker 後重新檢測。</p>}
              <ul className="space-y-2">
                {CODEX_CHECKS.map(([key, label, hint]) => (
                  <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 font-medium text-slate-700">{label}</span>
                    {status(result.codex_checks?.[key])}
                    <span className="w-full text-xs">{hint}</span>
                  </li>
                ))}
              </ul>
              {result.codex_checks?.codex_version && <p className="border-t border-slate-200 pt-3 text-xs">Codex 版本：{result.codex_checks.codex_version}</p>}
            </div>
          </div>
          <p className="text-xs text-slate-500">本機建模不會改用舊的參數寫檔方式。環境未齊備時請先修正，再按「重新檢測」。</p>
        </> : result && <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-50 px-5 py-4 text-rose-600">
            <AlertCircle className="h-7 w-7 shrink-0 fill-rose-500 text-white" />
          <p className="min-w-0 flex-1 text-sm font-semibold sm:text-base">
            {result.connected === false ? '未收到 SKP Worker 的有效連線，暫時不能生成。' : result.connected === true ? 'Worker 已連線，但寫檔環境尚未齊備。' : '未有可用的 SKP Worker，暫時不能生成。'}
          </p>
          <a href="/assets/downloads/FDS-SKP-Worker-Setup.exe" download className="inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4 hover:text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600">
            <Download className="h-4 w-4" />下載 SKP Worker
          </a>
          </div>
          {!checks && <p className="text-sm leading-relaxed text-slate-500 sm:text-base">目前未能確認各程式是否已安裝。請在 Windows Worker 電腦啟動或更新 SKP Worker 後重新檢測。</p>}
          <div className="space-y-4 text-sm leading-relaxed text-slate-500">
            <div className={sectionClass}>
              <span className={iconClass}><Monitor className="h-6 w-6" /></span>
              <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-950 sm:text-lg">SketchUp 桌面版</h3>
                {status(checks?.sketchup, true)}
              </div>
              <p>在 Worker 電腦安裝並登入已授權版本，首次啟動請完成模板設定。</p>
              <a className={linkClass} href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 shrink-0" />前往官方下載（新視窗）</a>
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">SketchUp 寫檔腳本：{status(checks?.ruby_script)}</div>
              </div>
            </div>
            <div className={sectionClass}>
              <span className={iconClass}><Settings className="h-6 w-6" /></span>
              <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-950 sm:text-lg">SketchUp SDK / 程式環境</h3>
                {status(sdkStatus, true)}
              </div>
              <ul className="space-y-2">
                {([['writer', 'skp_writer.exe'], ['api_dll', 'SketchUpAPI.dll'], ['preferences_dll', 'SketchUpCommonPreferences.dll']] as const).map(([key, label]) => (
                  <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="min-w-0 break-all">{label}</span>{status(checks?.[key])}</li>
                ))}
              </ul>
              <a className={linkClass} href={SDK_URL} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 shrink-0" />前往官方申請 SDK（新視窗）</a>
              <p className="border-t border-slate-200 pt-3">由管理員編譯寫檔程式，並將 SDK DLL 放在程式旁。桌面版及 SDK 方案擇一即可。</p>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-xl bg-[#f2f3ff] px-4 py-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e5e7ff] text-[#574dff]"><Info className="h-6 w-6 fill-[#574dff] text-white" /></span>
              <div><p>完成設定後啟動 SKP Worker，再按「重新檢測」。</p><p className="text-xs sm:text-sm">檔案存在檢測不代表授權已通過。</p></div>
            </div>
          </div>
        </>}
      </div>
    </Modal>
  );
  return { check, dialog, open };
}
