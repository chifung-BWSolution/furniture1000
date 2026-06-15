import React from "react";

const PRIMARY = [
  { key: "solutions", label: "傢俬方案", icon: "M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10" },
  { key: "customers", label: "客戶專區", icon: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM2 20c0-3.314 3.582-6 8-6s8 2.686 8 6" },
  { key: "quote", label: "傢俬報價", icon: "M9 7h6m-6 4h6m-6 4h4M5 4h14a1 1 0 011 1v15l-3-2-3 2-3-2-3 2-3-2V5a1 1 0 011-1z" },
  { key: "products", label: "產品管理", icon: "M20 7l-8-4-8 4 8 4 8-4zM4 12l8 4 8-4M4 17l8 4 8-4" },
  { key: "publish", label: "網上發佈", icon: "M21 12a9 9 0 11-18 0 9 9 0 0118 0zM3.6 9h16.8M3.6 15h16.8M12 3a13 13 0 010 18M12 3a13 13 0 000 18" },
  { key: "reports", label: "分析報表", icon: "M3 3v18h18M7 14l4-4 4 4 5-5" },
  { key: "settings", label: "設定", icon: "M10.325 4.317a1 1 0 011.35-.936l1.7.567a1 1 0 00.95-.193l1.43-1.144a1 1 0 011.46.27l.9 1.5a1 1 0 00.86.486l1.78.05a1 1 0 011 1l.05 1.78a1 1 0 00.486.86l1.5.9a1 1 0 01.27 1.46l-1.144 1.43a1 1 0 00-.193.95l.567 1.7a1 1 0 01-.936 1.35M12 15a3 3 0 100-6 3 3 0 000 6z" },
];

export function TopNavBar() {
  return (
    <div className="w-[1920px] bg-[#F5F6F9] p-6 font-sans" style={{ fontFamily: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif' }}>
      <div className="text-[13px] text-[#6B7280] mb-3 px-1">頂部一級導航 · Primary Navigation Bar</div>
      <header className="h-[64px] bg-white border border-[#E5E7EB] rounded-2xl shadow-sm flex items-center px-8">
        <div className="flex items-center gap-3 mr-10">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7C3AED] to-[#6B46C1] flex items-center justify-center shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white"><path d="M4 7l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/></svg>
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight">AI 產品管理</div>
            <div className="text-[11px] text-[#6B7280] tracking-[0.12em] uppercase">Shopify 管理工具</div>
          </div>
        </div>

        <nav className="flex items-center gap-1 flex-1">
          {PRIMARY.map((p) => {
            const active = p.key === "products";
            return (
              <button key={p.key} className={`flex items-center gap-2 h-10 px-4 rounded-lg text-[14px] font-medium transition ${active ? "bg-[#EDE9FE] text-[#6B46C1]" : "text-[#4B5563] hover:bg-[#F3F4F6]"}`}>
                <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]"><path d={p.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {p.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-4 ml-6">
          <div className="flex items-center gap-2 px-3 h-9 rounded-full bg-[#FEF3C7] border border-[#FDE68A]">
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]"/>
            <span className="text-[12px] text-[#92400E] font-medium">未連接</span>
          </div>
          <div className="flex items-center gap-2 pl-3 border-l border-[#E5E7EB]">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#A78BFA] to-[#6B46C1] flex items-center justify-center text-white text-[13px] font-semibold">CF</div>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold">Frank Chan</div>
              <div className="text-[11px] text-[#6B7280]">系統管理員</div>
            </div>
          </div>
        </div>
      </header>
      <div className="mt-3 flex items-center justify-between text-[11px] text-[#9CA3AF] px-1">
        <span>Logo · 7 個主要區塊 · 狀態指示 · 用戶頭像</span>
        <span>active = #EDE9FE / #6B46C1</span>
      </div>
    </div>
  );
}
