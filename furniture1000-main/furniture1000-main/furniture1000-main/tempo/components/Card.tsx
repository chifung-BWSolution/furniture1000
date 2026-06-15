import type { ReactNode } from "react";

interface CardProps {
  label?: string;
  title: string;
  children?: ReactNode;
}

export function Card({ label, title, children }: CardProps) {
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-6">
      {label && (
        <div className="text-[11px] font-semibold tracking-wide uppercase text-white/40 mb-2.5">
          {label}
        </div>
      )}
      <div className={`text-[15px] font-semibold text-gray-100 ${children ? "mb-2" : ""}`}>
        {title}
      </div>
      {children && (
        <div className="text-[13px] leading-5 text-white/45">
          {children}
        </div>
      )}
    </div>
  );
}
