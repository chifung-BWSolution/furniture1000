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

const SUB = [
  { key: "dashboard", label: "儀表板", icon: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" },
  { key: "search", label: "進階搜尋", icon: "M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" },
  { key: "factory", label: "廠家目錄", icon: "M3 21V8l6 4V8l6 4V4l6 4v13H3z" },
  { key: "upload", label: "上載PDF", icon: "M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" },
  { key: "all", label: "所有產品", icon: "M4 6h16M4 12h16M4 18h16" },
  { key: "category", label: "產品分類", icon: "M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" },
];

const PRODUCTS = [
  { name: "意式極簡三人布藝沙發", code: "SF-2401", category: "沙發系列", price: "HK$ 12,800", factory: "東莞 · 雅居家具", img: "from-stone-200 to-stone-300" },
  { name: "北歐胡桃木餐桌（六人位）", code: "DT-1158", category: "餐廳系列", price: "HK$ 8,600", factory: "佛山 · 木匠坊", img: "from-amber-100 to-amber-200" },
  { name: "現代簡約皮革床架（King Size）", code: "BD-3302", category: "睡房系列", price: "HK$ 15,400", factory: "深圳 · 安睡家居", img: "from-slate-200 to-slate-300" },
  { name: "美式輕奢電視櫃 2.4M", code: "TV-0918", category: "客廳系列", price: "HK$ 6,980", factory: "中山 · 萬豪", img: "from-zinc-200 to-zinc-300" },
  { name: "日式榻榻米收納床（1.5M）", code: "BD-2207", category: "睡房系列", price: "HK$ 9,200", factory: "東莞 · 木源", img: "from-orange-100 to-orange-200" },
  { name: "輕奢大理石茶几", code: "TB-4490", category: "客廳系列", price: "HK$ 4,560", factory: "佛山 · 石尚", img: "from-neutral-100 to-neutral-200" },
  { name: "原木實木書桌 1.6M", code: "DK-7710", category: "書房系列", price: "HK$ 5,800", factory: "東莞 · 林木坊", img: "from-yellow-100 to-yellow-200" },
  { name: "歐式絨布單人椅", code: "CH-5523", category: "客廳系列", price: "HK$ 3,280", factory: "深圳 · 雅軒", img: "from-rose-100 to-rose-200" },
];

export function FullInterface() {
  return (
    <div className="w-[1920px] h-[1080px] bg-[#F5F6F9] font-sans text-[#1F2937] flex flex-col overflow-hidden" style={{ fontFamily: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif' }}>
      {/* TOP BAR */}
      <header className="h-[64px] bg-white border-b border-[#E5E7EB] flex items-center px-8 shrink-0">
        <div className="flex items-center gap-3 mr-10">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7C3AED] to-[#6B46C1] flex items-center justify-center shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white"><path d="M4 7l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/></svg>
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight">AI 產品管理</div>
            <div className="text-[11px] text-[#6B7280] tracking-[0.12em] uppercase">Shopify 管理工具</div>
          </div>
        </div>

        {/* PRIMARY NAV */}
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
          <button className="w-9 h-9 rounded-lg hover:bg-[#F3F4F6] flex items-center justify-center text-[#6B7280]">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
          <div className="flex items-center gap-2 pl-3 border-l border-[#E5E7EB]">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#A78BFA] to-[#6B46C1] flex items-center justify-center text-white text-[13px] font-semibold">CF</div>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold">Frank Chan</div>
              <div className="text-[11px] text-[#6B7280]">系統管理員</div>
            </div>
          </div>
        </div>
      </header>

      {/* BODY */}
      <div className="flex-1 flex min-h-0">
        {/* LEFT SIDEBAR */}
        <aside className="w-[260px] bg-white border-r border-[#E5E7EB] flex flex-col shrink-0">
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
                <button key={s.key} className={`w-full flex items-center gap-3 h-10 px-3 rounded-lg text-[14px] mb-1 transition ${active ? "bg-[#6B46C1] text-white shadow-sm shadow-purple-200" : "text-[#374151] hover:bg-[#F3F4F6]"}`}>
                  <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]"><path d={s.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="flex-1 text-left font-medium">{s.label}</span>
                  {active && <span className="text-[11px] bg-white/20 rounded px-1.5 py-0.5">42</span>}
                </button>
              );
            })}
          </div>

          <div className="mt-3 px-5 py-3 border-t border-[#E5E7EB]">
            <div className="text-[11px] text-[#9CA3AF] uppercase tracking-wider mb-2">快捷操作</div>
            {[{l:"新增產品",i:"M12 4v16m8-8H4"},{l:"批量匯入",i:"M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"}].map((q,i)=>(
              <button key={i} className="w-full flex items-center gap-2 h-9 px-2 rounded-md text-[13px] text-[#4B5563] hover:bg-[#F3F4F6]">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4"><path d={q.i} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {q.l}
              </button>
            ))}
          </div>

          <div className="mt-auto px-5 py-4 border-t border-[#E5E7EB] flex items-center justify-between">
            <span className="text-[12px] text-[#6B7280]">淺色模式</span>
            <button className="relative w-10 h-5 rounded-full bg-[#6B46C1]">
              <span className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow"/>
            </button>
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* TOOLBAR */}
          <div className="px-8 pt-6 pb-4 bg-[#F5F6F9]">
            <div className="flex items-center text-[12px] text-[#6B7280] mb-3">
              <span>管理後台</span>
              <svg viewBox="0 0 24 24" className="w-3 h-3 mx-1.5" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              <span>產品管理</span>
              <svg viewBox="0 0 24 24" className="w-3 h-3 mx-1.5" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              <span className="text-[#1F2937] font-medium">產品分類</span>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <h1 className="text-[26px] font-bold tracking-tight">產品分類</h1>
                <p className="text-[13px] text-[#6B7280] mt-1">瀏覽與管理所有家俬產品分類，共 <span className="font-semibold text-[#1F2937]">428</span> 件產品。</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]"><path d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  <input placeholder="搜尋產品名稱、編號、廠家…" className="h-10 pl-9 pr-4 w-[300px] rounded-lg border border-[#E5E7EB] bg-white text-[13px] focus:outline-none focus:border-[#6B46C1]" />
                </div>
                <select className="h-10 px-3 rounded-lg border border-[#E5E7EB] bg-white text-[13px] font-medium">
                  <option>建立時間（最新優先）</option>
                  <option>價格（高至低）</option>
                  <option>名稱（A → Z）</option>
                </select>
                <select className="h-10 px-3 rounded-lg border border-[#E5E7EB] bg-white text-[13px] font-medium">
                  <option>每頁 100 項</option>
                </select>
                <button className="h-10 px-4 rounded-lg bg-[#6B46C1] text-white text-[13px] font-medium hover:bg-[#5B3AA8] flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none"><path d="M12 4v16m8-8H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  新增產品
                </button>
              </div>
            </div>
          </div>

          {/* FILTER CHIPS */}
          <div className="px-8 pb-3 flex items-center gap-2 bg-[#F5F6F9]">
            {["全部分類", "沙發系列", "餐廳系列", "睡房系列", "客廳系列", "書房系列", "戶外傢俬"].map((c, i) => (
              <button key={c} className={`h-8 px-3.5 rounded-full text-[12px] font-medium transition ${i===0 ? "bg-[#1F2937] text-white" : "bg-white border border-[#E5E7EB] text-[#4B5563] hover:border-[#6B46C1] hover:text-[#6B46C1]"}`}>{c}</button>
            ))}
          </div>

          {/* PRODUCT GRID */}
          <div className="flex-1 overflow-auto px-8 pb-8">
            <div className="grid grid-cols-4 gap-5">
              {PRODUCTS.map((p, i) => (
                <div key={i} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden hover:shadow-lg hover:border-[#C4B5FD] transition group">
                  <div className={`h-[150px] bg-gradient-to-br ${p.img} relative`}>
                    <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-white/85 backdrop-blur text-[10px] font-semibold text-[#6B46C1]">{p.category}</div>
                    <button className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/85 backdrop-blur flex items-center justify-center text-[#6B7280] opacity-0 group-hover:opacity-100 transition">
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none"><path d="M12 5v.01M12 12v.01M12 19v.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  <div className="p-3.5">
                    <div className="text-[10px] text-[#9CA3AF] font-mono mb-1">#{p.code}</div>
                    <div className="text-[13.5px] font-semibold leading-snug line-clamp-2 mb-1.5">{p.name}</div>
                    <div className="text-[11px] text-[#6B7280] mb-2.5">廠家 · {p.factory}</div>
                    <div className="flex items-center justify-between pt-2 border-t border-[#F3F4F6]">
                      <span className="text-[14px] font-bold text-[#6B46C1]">{p.price}</span>
                      <div className="flex items-center gap-1 text-[10px] text-[#10B981]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]"/>已上架
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="mt-6 flex items-center justify-between">
              <div className="text-[12px] text-[#6B7280]">顯示 <span className="font-semibold text-[#1F2937]">1 – 100</span> / 共 428 件產品</div>
              <div className="flex items-center gap-1">
                {["‹", "1", "2", "3", "4", "5", "›"].map((n, i) => (
                  <button key={i} className={`min-w-[32px] h-8 px-2 rounded-md text-[12.5px] font-medium ${n==="1"?"bg-[#6B46C1] text-white":"bg-white border border-[#E5E7EB] text-[#4B5563] hover:border-[#6B46C1]"}`}>{n}</button>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
