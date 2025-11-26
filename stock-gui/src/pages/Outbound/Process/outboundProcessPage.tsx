/**
 * UI: 출고 처리 (라운드 카드 스타일 + 스티키 헤더 테이블)
 * File: src/pages/Outbound/Process/ProcessPage.tsx
 *
 * - 상단 스캔 카드: 송장/바코드 + 중량(kg) + 완료 버튼
 * - 리스트 카드: SKU / 바코드 / 상품명 / 요구수량 / 스캔수량 / 잔여 / 상태
 * - 요구수량 초과 스캔 시 경고 및 차단
 * - 중량(kg) 미입력 시 완료 버튼 비활성화
 * - shipDate KST YYYY-MM-DD
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

// ────────────────────────────────────────────────────────────────
// 타입
type OutboundItem = {
  id: string;
  sku: string;
  name: string;
  barcode: string; // 고정 표시용
  requiredQty: number;
  scannedQty: number;
};

type Shipment = {
  invoiceNo: string;
  shipDate: string; // KST YYYY-MM-DD
  weightKg?: number;
  items: OutboundItem[];
  status: "대기" | "완료대기" | "출고완료";
};

// ────────────────────────────────────────────────────────────────
// 헬퍼
const uid = () => Math.random().toString(36).slice(2, 10);

const todayKST = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// 더미: 송장번호 → 주문 품목 목록(상품 바코드 포함)
async function mockFetchOrderByInvoice(invoiceNo: string): Promise<OutboundItem[]> {
  const seed = Number(invoiceNo.replace(/\D/g, "").slice(-1) || "3");
  const base: Array<{ sku: string; name: string; barcode: string }> = [
    { sku: "FD_SAMY_BULDAK_0200_01EA", name: "삼양 불닭볶음면 200g", barcode: "880000000001" },
    { sku: "FD_SAMLIP_MINIYAK_120_3PK", name: "삼립 미니약과 120g x3", barcode: "880000000002" },
    { sku: "FD_MAXIM_KANU_MILD_030_1BOX", name: "맥심 카누 마일드 30입 1BOX", barcode: "880000000003" },
  ];
  return base.map((b, i) => ({
    id: uid(),
    sku: b.sku,
    name: b.name,
    barcode: b.barcode,
    requiredQty: ((i + seed) % 3) + 1, // 1 to 3
    scannedQty: 0,
  }));
}

// 더미: 바코드 → SKU/상품명(스캔 매칭용)
function mockResolveBarcode(code: string): { sku: string; name: string } | null {
  const dict: Record<string, { sku: string; name: string }> = {
    "880000000001": { sku: "FD_SAMY_BULDAK_0200_01EA", name: "삼양 불닭볶음면 200g" },
    "880000000002": { sku: "FD_SAMLIP_MINIYAK_120_3PK", name: "삼립 미니약과 120g x3" },
    "880000000003": { sku: "FD_MAXIM_KANU_MILD_030_1BOX", name: "맥심 카누 마일드 30입 1BOX" },
  };
  if (dict[code]) return dict[code];
  if (/^\d{6,}$/.test(code)) {
    const tail = Number(code.slice(-1));
    if (tail % 3 === 1) return dict["880000000001"];
    if (tail % 3 === 2) return dict["880000000002"];
    return dict["880000000003"];
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// 뱃지 컴포넌트 (일치/부족/과다)
function StatusBadge({ status }: { status: "ok" | "warn" | "over" }) {
  if (status === "ok") {
    return (
      <span className="px-2 py-1 text-xs font-bold rounded-full bg-green-100 text-green-700">
        일치
      </span>
    );
  }
  if (status === "over") {
    return (
      <span className="px-2 py-1 text-xs font-bold rounded-full bg-red-100 text-red-600">
        과다
      </span>
    );
  }
  return (
    <span className="px-2 py-1 text-xs font-bold rounded-full bg-yellow-100 text-red-600">
      부족
    </span>
  );
}

// ────────────────────────────────────────────────────────────────
// 메인
export default function ProcessPage() {
  // 입력 refs
  const invoiceRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  // 상태
  const [invoiceInput, setInvoiceInput] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [shipment, setShipment] = useState<Shipment | null>(null);

  // 포커스 유틸
  const focusInvoice = () => setTimeout(() => invoiceRef.current?.focus(), 0);
  const focusBarcode = () => setTimeout(() => barcodeRef.current?.focus(), 0);

  // 송장 엔터: 품목 로드
  const handleInvoiceEnter = async () => {
    const inv = invoiceInput.trim();
    if (!inv) return focusInvoice();
    const items = await mockFetchOrderByInvoice(inv);
    setShipment({
      invoiceNo: inv,
      shipDate: todayKST(),
      weightKg: undefined,
      items,
      status: "대기",
    });
    setBarcodeInput("");
    focusBarcode();
  };

  // 바코드 엔터: 수량 증가(초과 차단 + 경고)
  const handleBarcodeEnter = () => {
    if (!shipment) return focusInvoice();
    const code = barcodeInput.trim();
    if (!code) return focusBarcode();

    const resolved = mockResolveBarcode(code);
    if (!resolved) {
      alert("등록되지 않은 바코드입니다. (더미 경고)");
      setBarcodeInput("");
      return focusBarcode();
    }

    const { sku } = resolved;

    setShipment((prev) => {
      if (!prev) return prev;
      const nextItems = prev.items.map((it) => {
        if (it.sku !== sku) return it;
        if (it.scannedQty >= it.requiredQty) {
          alert("해당 주문의 수량보다 많습니다.");
          return it;
        }
        return { ...it, scannedQty: it.scannedQty + 1 };
      });
      return { ...prev, items: nextItems };
    });

    setBarcodeInput("");
    focusBarcode();
  };

  // 완료 조건
  const allMatch = useMemo(
    () => !!shipment && shipment.items.every((it) => it.scannedQty === it.requiredQty),
    [shipment]
  );
  const weightOk = useMemo(
    () => !!shipment && typeof shipment.weightKg === "number" && (shipment.weightKg ?? 0) > 0,
    [shipment]
  );
  const canComplete = !!shipment && allMatch && weightOk && shipment.status !== "출고완료";

  const completeShipment = () => {
    if (!shipment || !canComplete) return;
    setShipment({ ...shipment, status: "출고완료" });
    alert("출고 처리 완료되었습니다. (더미 처리)");
    focusInvoice();
  };

  // 초기 포커스
  useEffect(() => {
    focusInvoice();
  }, []);

  // 레이아웃: 라운드 카드 + 스티키 헤더 테이블
  return (
    <div className="p-4">
      {/* 상단 설명 카드 */}
      <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-semibold">출고 처리</h1>
        <p className="mt-1 text-sm text-gray-600">
          송장번호 입력 후 Enter → 제품 바코드 스캔. 모든 품목의 스캔수량이 요구수량과 일치하고
          중량(kg)을 입력해야 완료됩니다.
        </p>
      </div>

      {/* 스캔/중량/완료 카드 */}
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex flex-1 flex-col gap-2 md:flex-row">
            <input
              ref={invoiceRef}
              value={invoiceInput}
              onChange={(e) => setInvoiceInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleInvoiceEnter();
                }
                if (e.key === "Tab") {
                  e.preventDefault();
                  focusBarcode();
                }
              }}
              placeholder="송장번호 스캔 또는 입력"
              className="w-full rounded-xl border px-3 py-2 md:w-[340px]"
            />
            <input
              ref={barcodeRef}
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleBarcodeEnter();
                }
              }}
              placeholder="제품 바코드 스캔"
              className="w-full rounded-xl border px-3 py-2 md:w-[420px]"
              disabled={!shipment}
            />
          </div>

          <div className="flex items-center gap-3 md:ml-auto">
            <label className="flex items-center gap-2">
              <span className="text-sm text-gray-700">중량(kg)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={shipment?.weightKg ?? ""}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setShipment((prev) =>
                    prev ? { ...prev, weightKg: v === "" ? undefined : Number(v) } : prev
                  );
                }}
                className="w-[120px] rounded-xl border px-3 py-2 text-right"
                disabled={!shipment || shipment.status === "출고완료"}
              />
            </label>

            <button
              className={`rounded-xl px-4 py-2 ${
                canComplete
                  ? "bg-black text-white"
                  : "bg-gray-200 text-gray-600 cursor-not-allowed"
              }`}
              onClick={completeShipment}
              disabled={!canComplete}
              title={
                canComplete
                  ? "출고를 완료합니다."
                  : !shipment
                  ? "송장번호를 먼저 스캔하세요."
                  : !allMatch
                  ? "스캔수량이 요구수량과 일치하지 않습니다."
                  : !weightOk
                  ? "중량(kg)을 입력하세요."
                  : "완료할 수 없습니다."
              }
            >
              출고 처리 완료
            </button>
          </div>
        </div>

        {/* 현재 송장 정보 바 */}
        <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {shipment ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span>
                송장번호: <b>{shipment.invoiceNo}</b>
              </span>
            </div>
          ) : (
            <span>송장번호를 스캔하여 출고 품목을 불러오세요.</span>
          )}
        </div>
      </div>

      {/* 리스트 카드 */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="max-h-[560px] overflow-auto rounded-2xl">
          <table
            className={[
              "w-full table-fixed border-collapse text-sm",
              "[&>thead>tr>th]:sticky [&>thead>tr>th]:top-0 [&>thead>tr>th]:z-10",
              "[&>thead>tr]:bg-gray-50 [&>thead>tr>th]:bg-gray-50",
              "[&>thead>tr>th]:border-b border-gray-200",
              "[&>thead>tr>th]:py-3 [&>tbody>tr>td]:py-3",
              "[&>thead>tr>th]:text-center [&>tbody>tr>td]:text-center",
            ].join(" ")}
          >
            <colgroup>
              <col style={{ width: "220px" }} />
              <col style={{ width: "180px" }} />
              <col style={{ width: "auto" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "140px" }} />
            </colgroup>

            <thead>
              <tr>
                <th className="text-gray-800">SKU</th>
                <th className="text-gray-800">바코드</th>
                <th className="text-gray-800">상품명</th>
                <th className="text-gray-800">요구수량</th>
                <th className="text-gray-800">스캔수량</th>
                <th className="text-gray-800">잔여</th>
                <th className="text-gray-800">상태</th>
              </tr>
            </thead>

            <tbody>
              {!shipment || shipment.items.length === 0 ? (
                <tr>
                  <td className="py-10 text-center text-gray-500" colSpan={7}>
                    로드된 출고 품목이 없습니다.
                  </td>
                </tr>
              ) : (
                shipment.items.map((it) => {
                  const remaining = it.requiredQty - it.scannedQty;
                  const status: "ok" | "warn" | "over" =
                    remaining === 0 ? "ok" : remaining < 0 ? "over" : "warn";
                  return (
                    <tr key={it.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 align-middle font-mono">{it.sku}</td>
                      <td className="px-3 align-middle font-mono">{it.barcode}</td>
                      <td className="px-3 align-middle">{it.name}</td>
                      <td className="px-3 align-middle text-right">{it.requiredQty}</td>
                      <td className="px-3 align-middle text-right">{it.scannedQty}</td>
                      <td className="px-3 align-middle text-right">
                        {Math.max(remaining, 0)}
                      </td>
                      <td className="px-3 align-middle">
                        <StatusBadge status={status} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 하단 요약바 */}
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 rounded-b-2xl">
          <div className="text-sm text-gray-600">
            {shipment ? (
              <>
                총 품목 <b>{shipment.items.length}</b>개 · 스캔 완료 품목{" "}
                <b>{shipment.items.filter((x) => x.scannedQty === x.requiredQty).length}</b>개
              </>
            ) : (
              <>출고 품목을 로드하면 요약이 표시됩니다.</>
            )}
          </div>
        </div>
      </div>

      {/* 안내 */}
      <p className="mt-3 text-xs text-gray-500">
        참고: 더미 매핑 사용 중. 바코드 예시 880000000001, 880000000002, 880000000003.
        실제 연동 시 mockResolveBarcode / mockFetchOrderByInvoice를 API로 교체하세요.
      </p>
    </div>
  );
}
