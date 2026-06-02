import React from "react";

const PRIMARY = [
  { key: "solutions", label: "傢俬方案", icon: "M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10", subs: ["設計專案", "產品搜尋", "邀請客戶", "已確定方案"] },
  { key: "customers", label: "客戶專區", icon: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM2 20c0-3.314 3.582-6 8-6s8 2.686 8 6", subs: ["設計專案", "產品搜尋", "確定產品", "公司資料"] },
  { key: "quote", label: "傢俬報價", icon: "M9 7h6m-6 4h6m-6 4h4M5 4h14a1 1 0 011 1v15l-3-2-3 2-3-2-3 2-3-2V5a1 1 0 011-1z", subs: ["廠家目錄", "快速報價", "產品報告", "報價一覽", "報價設定"] },
  { key: "products", label: "產品管理", icon: "M20 7l-8-4-8 4 8 4 8-4zM4 12l8 4 8-4M4 17l8 4 8-4", subs: ["儀表板", "進階搜尋", "廠家目錄", "上載PDF", "所有產品", "產品分類"] },
  { key: "publish", label: "網上發佈", icon: "M21 12a9 9 0 11-18 0 9 9 0 0118 0zM3.6 9h16.8M3.6 15h16.8M12 3a13 13 0 010 18M12 3a13 13 0 000 18", subs: ["產品文案", "發佈前檢查", "準備上載", "已上載產品"] },
  { key: "reports", label: "分析報表", icon: "M3 3v18h18M7 14l4-4 4 4 5-5", subs: ["廠家報告", "產品報告", "銷售報告"] },
  { key: "settings", label: "設定", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z", subs: ["用戶管理", "登入紀錄"] },
];

const SUB_ICONS: Record<string, string> = {
  "設計專案": "M3 7h18M3 12h18M3 17h12",
  "產品搜尋": "M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z",
  "邀請客戶": "M16 11a4 4 0 10-8 0 4 4 0 008 0zM2 20c0-3.314 3.582-6 8-6s8 2.686 8 6M19 8v6M22 11h-6",
  "已確定方案": "M5 13l4 4L19 7",
  "確定產品": "M5 13l4 4L19 7",
  "公司資料": "M3 21V8l6 4V8l6 4V4l6 4v13H3z",
  "廠家目錄": "M3 21V8l6 4V8l6 4V4l6 4v13H3z",
  "快速報價": "M13 10V3L4 14h7v7l9-11h-7z",
  "產品報告": "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  "報價一覽": "M3 6h18M3 12h18M3 18h18",
  "報價設定": "M12 15a3 3 0 100-6 3 3 0 000 6z",
  "儀表板": "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  "進階搜尋": "M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z",
  "上載PDF": "M12 16V4m0 0l-4 4m4-4l4 4M4 20h16",
  "所有產品": "M4 6h16M4 12h16M4 18h16",
  "產品分類": "M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z",
  "產品文案": "M4 6h16M4 12h10M4 18h16",
  "發佈前檢查": "M5 13l4 4L19 7",
  "準備上載": "M12 16V4m0 0l-4 4m4-4l4 4M4 20h16",
  "已上載產品": "M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 12l2 2 4-4",
  "廠家報告": "M3 3v18h18M7 14l4-4 4 4 5-5",
  "銷售報告": "M3 3v18h18M7 12l3 3 7-7",
  "用戶管理": "M16 11a4 4 0 10-8 0 4 4 0 008 0zM2 20c0-3.314 3.582-6 8-6s8 2.686 8 6",
  "登入紀錄": "M12 8v4l3 3 M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
};

export function AlternateActiveStates() {
  return (
    <div className="w-[1600px] bg-[#F5F6F9] p-10 font-sans" style={{ fontFamily: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif' }}>
      <div className="mb-8">
        <div className="text-[12px] font-semibold text-[#6B46C1] tracking-[0.2em] uppercase">Active States</div>
        <h1 className="text-[28px] font-bold tracking-tight mt-1">其他一級頁面 active 對應左側欄</h1>
        <p className="text-[13px] text-[#6B7280] mt-1.5">每個一級頁面被選取時，左側欄會切換為對應的二級導航。</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {PRIMARY.filter(p => p.key !== "products").map((p) => (
          <div key={p.key} className="bg-white border border-[#E5E7EB] rounded-2xl shadow-sm overflow-hidden">
            {/* mini top nav */}
            <div className="h-12 bg-white border-b border-[#E5E7EB] flex items-center px-4 gap-1">
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#7C3AED] to-[#6B46C1] mr-3"/>
              {PRIMARY.map((q) => {
                const active = q.key === p.key;
                return (
                  <div key={q.key} className={`flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] font-medium ${active ? "bg-[#EDE9FE] text-[#6B46C1]" : "text-[#6B7280]"}`}>
                    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5"><path d={q.icon} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {q.label}
                  </div>
                );
              })}
            </div>
            {/* sidebar + placeholder content */}
            <div className="flex h-[280px]">
              <div className="w-[200px] bg-white border-r border-[#E5E7EB] py-3 px-2.5">
                <div className="px-2 mb-2">
                  <div className="text-[9px] font-semibold text-[#6B46C1] tracking-[0.18em] uppercase">{p.key}</div>
                  <div className="text-[13px] font-bold mt-0.5">{p.label}</div>
                </div>
                {p.subs.map((s, i) => {
                  const active = i === 0;
                  return (
                    <div key={s} className={`flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[12px] mb-0.5 ${active ? "bg-[#6B46C1] text-white font-medium" : "text-[#4B5563]"}`}>
                      <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5"><path d={SUB_ICONS[s] || "M4 6h16M4 12h16M4 18h16"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {s}
                    </div>
                  );
                })}
              </div>
              <div className="flex-1 bg-[#F9FAFB] p-5">
                <div className="text-[10px] text-[#9CA3AF] mb-2">麵包屑</div>
                <div className="text-[12px] text-[#6B7280] mb-3">管理後台 › <span className="font-semibold text-[#1F2937]">{p.label}</span> › {p.subs[0]}</div>
                <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
                  <div className="h-3 w-1/2 bg-[#F3F4F6] rounded mb-2"/>
                  <div className="h-2.5 w-3/4 bg-[#F3F4F6] rounded mb-1.5"/>
                  <div className="h-2.5 w-2/3 bg-[#F3F4F6] rounded mb-1.5"/>
                  <div className="h-2.5 w-1/2 bg-[#F3F4F6] rounded"/>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[1,2,3].map(i => <div key={i} className="h-16 bg-white rounded-lg border border-[#E5E7EB]"/>)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
