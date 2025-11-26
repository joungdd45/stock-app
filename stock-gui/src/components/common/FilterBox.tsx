// src/components/common/FilterBox.tsx
import React from "react";

export type FilterValue = {
  from?: string;
  to?: string;
  keyword?: string;
};

type Props = {
  value?: FilterValue; // ✅ 옵셔널 처리
  onChange: (v: FilterValue) => void;
  onSubmit: () => void;
  onReset: () => void;
  placeholders?: {
    from?: string;
    to?: string;
    keyword?: string; // 권장
    search?: string;  // ✅ 별칭 허용(선택)
  };
  className?: string;
};

export default function FilterBox({
  value = {}, // ✅ 기본값 지정
  onChange,
  onSubmit,
  onReset,
  placeholders,
  className = "",
}: Props) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onSubmit();
  };

  return (
    <div
      className={[
        "mb-3 rounded-2xl border border-gray-200 bg-white p-4",
        className,
      ].join(" ")}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">기간 시작</span>
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            placeholder={placeholders?.from ?? "연도-월-일"}
            value={value.from ?? ""}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">기간 종료</span>
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            placeholder={placeholders?.to ?? "연도-월-일"}
            value={value.to ?? ""}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </label>

        <label className="flex flex-col text-sm md:col-span-2">
          <span className="mb-1 text-gray-600">SKU 또는 상품명</span>
          <input
            type="text"
            className="rounded-lg border px-3 py-2"
            placeholder={
              placeholders?.keyword ??
              placeholders?.search ??
              "SKU, 상품명, 공급처 검색"
            }
            value={value.keyword ?? ""}
            onChange={(e) => onChange({ ...value, keyword: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={onReset}
          >
            초기화
          </button>
          <button
            type="button"
            className="rounded-xl bg-black px-4 py-2 text-sm text-white"
            onClick={onSubmit}
          >
            검색
          </button>
        </div>
      </div>
    </div>
  );
}
