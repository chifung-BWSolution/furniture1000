import React from "react";

const MAP = [
  { key: "solutions", label: "傢俬方案", icon: "M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10", subs: ["設計專案", "產品搜尋", "邀請客戶", "已確定方案"] },
  { key: "customers", label: "客戶專區", icon: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM2 20c0-3.314 3.582-6 8-6s8 2.686 8 6", subs: ["設計專案", "產品搜尋", "確定產品", "公司資料"] },
  { key: "quote", label: "傢俬報價", icon: "M9 7h6m-6 4h6m-6 4h4M5 4h14a1 1 0 011 1v15l-3-2-3 2-3-2-3 2-3-2V5a1 1 0 011-1z", subs: ["廠家目錄", "快速報價", "產品報告", "報價一覽", "報價設定"] },
  { key: "products", label: "產品管理", icon: "M20 7l-8-4-8 4 8 4 8-4zM4 12l8 4 8-4M4 17l8 4 8-4", subs: ["儀表板", "進階搜尋", "廠家目錄", "上載PDF", "所有產品", "產品分類"], current: true, currentSub: "產品分類" },
  { key: "publish", label: "網上發佈", icon: "M21 12a9 9 0 11-18 0 9 9 0 0118 0zM3.6 9h16.8M3.6 15h16.8M12 3a13 13 0 010 18M12 3a13 13 0 000 18", subs: ["產品文案", "發佈前檢查", "準備上載", "已上載產品"] },
  { key: "reports", label: "分析報表", icon: "M3 3v18h18M7 14l4-4 4 4 5-5", subs: ["廠家報告", "產品報告", "銷售報告"] },
  { key: "settings", label: "設定", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z", subs: ["用戶管理", "登入紀錄"] },
];

export function SitemapReference() {
  return (
    <div className="w-[1600px] h-[900px] bg-[#F5F6F9] p-10 font-sans" style={{ fontFamily: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif' }}>
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="text-[12px] font-semibold text-[#6B46C1] tracking-[0.2em] uppercase">FDS · Information Architecture</div>
          <h1 className="text-[32px] font-bold tracking-tight mt-1">Sitemap 對應參考</h1>
          <p className="text-[14px] text-[#6B7280] mt-1.5">7 個一級頁面 ÷ 28 個二級頁面 — 紫色標示為當前選取狀態</p>
        </div>
        <div className="flex items-center gap-6">
          <Legend dot="#6B46C1" label="當前選取（active）" />
          <Legend dot="#EDE9FE" border="#C4B5FD" label="一級導航項" />
          <Legend dot="#FFFFFF" border="#E5E7EB" label="二級頁面" />
        </div>
      </div>

      <div className="grid grid-cols-7 gap-4">
        {MAP.map((p) => (
          <div key={p.key} className="flex flex-col">
            {/* primary card */}
            <div className={`rounded-2xl border-2 p-4 mb-3 ${p.current ? "border-[#6B46C1] bg-white shadow-md shadow-purple-100" : "border-[#E5E7EB] bg-white"}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${p.current ? "bg-[#6B46C1] text-white" : "bg-[#F3F4F6] text-[#4B5563]"}`}>
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d={p.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div className="text-[15px] font-bold leading-tight">{p.label}</div>
              <div className="text-[10px] text-[#9CA3AF] mt-0.5 uppercase tracking-wider">{p.subs.length} sub-pages</div>
            </div>
            {/* connector */}
            <div className="h-3 flex justify-center">
              <div className={`w-0.5 ${p.current ? "bg-[#6B46C1]" : "bg-[#E5E7EB]"}`}/>
            </div>
            {/* subs */}
            <div className="flex-1 flex flex-col gap-1.5">
              {p.subs.map((s) => {
                const isCurrent = p.current && s === p.currentSub;
                return (
                  <div key={s} className={`rounded-lg px-3 py-2.5 text-[13px] flex items-center gap-2 border transition ${isCurrent ? "bg-[#6B46C1] text-white border-[#6B46C1] font-semibold" : p.current ? "bg-white border-[#C4B5FD] text-[#4B5563]" : "bg-white border-[#E5E7EB] text-[#4B5563]"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isCurrent ? "bg-white" : p.current ? "bg-[#6B46C1]" : "bg-[#9CA3AF]"}`}/>
                    {s}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-4 gap-4 text-[12px]">
        {[
          { t: "一級導航", v: "頂部水平", d: "Top horizontal nav · 7 entries · purple highlight on active" },
          { t: "二級導航", v: "左側欄 260px", d: "Collapsible sidebar · purple solid pill on active sub-page" },
          { t: "麵包屑", v: "管理後台 > …", d: "Reflects active primary → secondary path" },
          { t: "視覺主色", v: "#6B46C1", d: "Soft #EDE9FE for primary hover · solid for sub-active" },
        ].map((m) => (
          <div key={m.t} className="bg-white border border-[#E5E7EB] rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">{m.t}</div>
            <div className="text-[16px] font-bold mt-1">{m.v}</div>
            <div className="text-[11px] text-[#6B7280] mt-1.5 leading-relaxed">{m.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend({ dot, border, label }: { dot: string; border?: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-[#4B5563]">
      <span className="w-3 h-3 rounded-md" style={{ background: dot, border: border ? `1px solid ${border}` : undefined }}/>
      {label}
    </div>
  );
}
