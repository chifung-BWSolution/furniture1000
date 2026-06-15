import React from "react";

const SUB = [
  { key: "dashboard", label: "儀表板", icon: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z", count: null },
  { key: "search", label: "進階搜尋", icon: "M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z", count: null },
  { key: "factory", label: "廠家目錄", icon: "M3 21V8l6 4V8l6 4V4l6 4v13H3z", count: 28 },
  { key: "upload", label: "上載PDF", icon: "M12 16V4m0 0l-4 4m4-4l4 4M4 20h16", count: null },
  { key: "all", label: "所有產品", icon: "M4 6h16M4 12h16M4 18h16", count: 428 },
  { key: "category", label: "產品分類", icon: "M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z", count: 12 },
];

export function LeftSidebar() {
  return (
    <div className="w-[600px] bg-[#F5F6F9] p-6 font-sans flex gap-5" style={{ fontFamily: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif' }}>
      {/* Expanded */}
      <div>
        <div className="text-[12px] text-[#6B7280] mb-2 px-1 font-medium">展開狀態</div>
        <aside className="w-[260px] bg-white border border-[#E5E7EB] rounded-2xl shadow-sm flex flex-col h-[640px]">
          <div className="px-5 pt-5 pb-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-[#6B46C1] tracking-[0.18em]">PRODUCT MGMT</div>
              <div className="text-[15px] font-bold mt-0.5">產品管理</div>
            </div>
            <button className="w-7 h-7 rounded-md hover:bg-[#F3F4F6] flex items-center justify-center text-[#6B7280]">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4"><path d="M11 19l-7-7 7-7M20 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          <div className="px-3 pb-4">
            {SUB.map((s) => {
              const active = s.key === "category";
              return (
                <button key={s.key} className={`w-full flex items-center gap-3 h-10 px-3 rounded-lg text-[14px] mb-1 transition ${active ? "bg-[#6B46C1] text-white shadow shadow-purple-200" : "text-[#374151] hover:bg-[#F3F4F6]"}`}>
                  <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]"><path d={s.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="flex-1 text-left font-medium">{s.label}</span>
                  {s.count != null && <span className={`text-[11px] rounded px-1.5 py-0.5 ${active ? "bg-white/20" : "bg-[#F3F4F6] text-[#6B7280]"}`}>{s.count}</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-auto px-5 py-4 border-t border-[#E5E7EB] flex items-center justify-between">
            <span className="text-[12px] text-[#6B7280]">淺色模式</span>
            <button className="relative w-10 h-5 rounded-full bg-[#6B46C1]">
              <span className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow"/>
            </button>
          </div>
        </aside>
      </div>
      {/* Collapsed */}
      <div>
        <div className="text-[12px] text-[#6B7280] mb-2 px-1 font-medium">收合狀態</div>
        <aside className="w-[68px] bg-white border border-[#E5E7EB] rounded-2xl shadow-sm flex flex-col h-[640px] py-4">
          <button className="w-7 h-7 rounded-md hover:bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] mx-auto mb-3">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4"><path d="M13 5l7 7-7 7M4 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div className="flex flex-col items-center gap-1.5 px-2">
            {SUB.map((s) => {
              const active = s.key === "category";
              return (
                <button key={s.key} title={s.label} className={`w-11 h-11 rounded-lg flex items-center justify-center transition ${active ? "bg-[#6B46C1] text-white" : "text-[#4B5563] hover:bg-[#F3F4F6]"}`}>
                  <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]"><path d={s.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              );
            })}
          </div>
          <div className="mt-auto flex justify-center">
            <button className="w-9 h-9 rounded-full bg-gradient-to-br from-[#A78BFA] to-[#6B46C1] flex items-center justify-center text-white text-[12px] font-semibold">CF</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
