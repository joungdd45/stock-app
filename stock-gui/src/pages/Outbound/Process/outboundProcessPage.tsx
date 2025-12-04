/**
 * UI: 출고 처리 (라운드 카드 스타일 + 스티키 헤더 테이블)
 * File: src/pages/Outbound/Process/ProcessPage.tsx
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  outboundAdapter,
  type OutboundProcessInvoiceResult,
  type OutboundProcessScanResult,
  type OutboundProcessWeightResult,
  type OutboundProcessConfirmResult,
  type OutboundProcessStateResult,
  type ProductLookupBySkuResult,
} from "@/api/adapters/outbound.adapter";
import { handleError } from "@/utils/handleError";

/* 타입 */

type RowItem = {
  id: string;
  sku: string;
  name: string;
  barcode: string;
  requiredQty: number;
  scannedQty: number;
};

type Shipment = {
  invoiceNo: string;
  shipDate: string;
  weightG?: number;   // ✅ g 단위로 변경
  items: RowItem[];
  status: string;
  overallStatus?: string;
};

/* 헬퍼 */

const uid = () => Math.random().toString(36).slice(2, 10);

const todayKST = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/**
 * apiHub 응답이
 *  - data = { result: T }
 *  - data = { item: T }
 *  - data = T
 * 세 경우 모두를 안전하게 처리
 */
function unwrapResult<T>(data: unknown): T | null {
  if (!data) return null;
  const anyData = data as any;
  if (anyData.result) return anyData.result as T;
  if (anyData.item) return anyData.item as T;
  return anyData as T;
}

function mapInvoiceToShipment(result: OutboundProcessInvoiceResult): Shipment {
  return {
    invoiceNo: result.invoice_no,
    shipDate: todayKST(),
    // ✅ 백엔드가 넘겨주는 g 값을 그대로 사용
    weightG:
      typeof result.weight_g === "number" && result.weight_g > 0
        ? result.weight_g
        : undefined,
    status: result.status,
    overallStatus: result.overall_status ?? undefined,
    items: result.items.map((it) => ({
      id: String(it.item_id ?? uid()),
      sku: it.sku,
      name: "",
      barcode: "",
      requiredQty: it.qty,
      scannedQty: it.scanned_qty,
    })),
  };
}

/**
 * 송장 품목(SKU 리스트)에 대해 lookup_by_sku 호출해서
 * 상품명/바코드 보강
 */
async function enrichShipmentWithProducts(
  base: Shipment,
): Promise<Shipment> {
  const uniqueSkus = Array.from(
    new Set(base.items.map((i) => i.sku).filter(Boolean)),
  );
  if (uniqueSkus.length === 0) return base;

  const skuMap: Record<string, { name?: string; barcode?: string }> = {};

  await Promise.all(
    uniqueSkus.map(async (sku) => {
      const res = await outboundAdapter.lookupProductBySku(sku);
      if (!res.ok || !res.data) return;
      const item = unwrapResult<ProductLookupBySkuResult>(res.data);
      if (!item) return;
      skuMap[sku] = {
        name: item.name,
        barcode: item.barcode ?? "",
      };
    }),
  );

  return {
    ...base,
    items: base.items.map((it) => ({
      ...it,
      name: skuMap[it.sku]?.name ?? it.name,
      barcode: skuMap[it.sku]?.barcode ?? it.barcode,
    })),
  };
}

/* 뱃지 */

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

/* 메인 */

export default function ProcessPage() {
  const invoiceRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const [invoiceInput, setInvoiceInput] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");

  const [shipment, setShipment] = useState<Shipment | null>(null);

  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [loadingScan, setLoadingScan] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);

  const focusInvoice = () => setTimeout(() => invoiceRef.current?.focus(), 0);
  const focusBarcode = () =>
    setTimeout(() => barcodeRef.current?.focus(), 0);

  /* 초기 핑 */

  useEffect(() => {
    focusInvoice();
    outboundAdapter.pingProcess().then((res) => {
      if (!res.ok) {
        handleError(res.error);
      }
    });
  }, []);

  /* 송장 엔터: 품목 로드 */

  const handleInvoiceEnter = async () => {
    const inv = invoiceInput.trim();
    if (!inv) {
      focusInvoice();
      return;
    }

    setLoadingInvoice(true);
    try {
      const res = await outboundAdapter.fetchProcessInvoice(inv);

      if (!res.ok) {
        handleError(res.error);
        return;
      }
      if (!res.data) {
        handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "송장 품목을 불러오지 못했습니다.",
        } as any);
        return;
      }

      const result = unwrapResult<OutboundProcessInvoiceResult>(res.data);
      if (!result || !result.items || result.items.length === 0) {
        alert("해당 송장에 대한 출고 품목을 찾을 수 없습니다.");
        return;
      }

      const mapped = mapInvoiceToShipment(result);
      const enriched = await enrichShipmentWithProducts(mapped);

      setShipment(enriched);
      setBarcodeInput("");
      focusBarcode();
    } catch (err: any) {
      console.error(err);
      handleError(err as any);
    } finally {
      setLoadingInvoice(false);
    }
  };

  /* 바코드 엔터: 스캔(+1) */

  const handleBarcodeEnter = async () => {
    if (!shipment) {
      focusInvoice();
      return;
    }

    const code = barcodeInput.trim();
    if (!code) {
      focusBarcode();
      return;
    }

    setLoadingScan(true);
    try {
      const res = await outboundAdapter.scanProcessItem({
        invoice_no: shipment.invoiceNo,
        barcode: code,
      });

      if (!res.ok) {
        handleError(res.error);
        setBarcodeInput("");
        focusBarcode();
        return;
      }
      if (!res.data) {
        handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "스캔 처리에 실패했습니다.",
        } as any);
        setBarcodeInput("");
        focusBarcode();
        return;
      }

      const raw = res.data as any;
      let scannedItem: any = null;

      if (raw.result && raw.result.item) {
        scannedItem = raw.result.item;
      } else if (raw.item) {
        scannedItem = raw.item;
      } else {
        if (
          raw &&
          typeof raw.sku === "string" &&
          typeof raw.qty === "number" &&
          typeof raw.scanned_qty === "number"
        ) {
          scannedItem = raw;
        }
      }

      if (
        !scannedItem ||
        typeof scannedItem.sku !== "string" ||
        typeof scannedItem.qty !== "number" ||
        typeof scannedItem.scanned_qty !== "number"
      ) {
        alert("스캔 결과를 찾을 수 없습니다.");
        setBarcodeInput("");
        focusBarcode();
        return;
      }

      setShipment((prev) => {
        if (!prev) return prev;
        const nextItems = prev.items.map((it) =>
          it.sku === scannedItem.sku
            ? {
                ...it,
                requiredQty: scannedItem.qty,
                scannedQty: scannedItem.scanned_qty,
              }
            : it,
        );
        return { ...prev, items: nextItems };
      });

      setBarcodeInput("");
      focusBarcode();
    } catch (err: any) {
      console.error(err);
      handleError(err as any);
    } finally {
      setLoadingScan(false);
    }
  };

  /* 중량 입력/블러 (g 단위) */

  const handleWeightChange = (value: string) => {
    setShipment((prev) =>
      prev
        ? {
            ...prev,
            weightG: value === "" ? undefined : Number(value),
          }
        : prev,
    );
  };

  const handleWeightBlur = async () => {
    if (!shipment || !shipment.weightG || shipment.weightG <= 0) return;

    try {
      const res = await outboundAdapter.setProcessWeight({
        invoice_no: shipment.invoiceNo,
        // ✅ 그대로 g 단위 전송
        weight_g: Math.round(shipment.weightG),
      });

      if (!res.ok) {
        handleError(res.error);
        return;
      }
      if (!res.data) {
        handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "중량 설정에 실패했습니다.",
        } as any);
        return;
      }

      const r = unwrapResult<OutboundProcessWeightResult>(res.data);
      if (!r) return;

      setShipment((prev) =>
        prev
          ? {
              ...prev,
              weightG:
                typeof r.weight_g === "number" && r.weight_g > 0
                  ? r.weight_g
                  : prev.weightG,
            }
          : prev,
      );
    } catch (err: any) {
      console.error(err);
      handleError(err as any);
    }
  };

  /* 완료 조건 */

  const allMatch = useMemo(
    () =>
      !!shipment &&
      shipment.items.length > 0 &&
      shipment.items.every((it) => it.scannedQty === it.requiredQty),
    [shipment],
  );

  const weightOk = useMemo(
    () =>
      !!shipment &&
      typeof shipment.weightG === "number" &&
      (shipment.weightG ?? 0) > 0,
    [shipment],
  );

  const canComplete =
    !!shipment &&
    allMatch &&
    weightOk &&
    shipment.status !== "completed" &&
    shipment.status !== "출고완료";

  /* 출고 처리 완료 */

  const completeShipment = async () => {
    if (!shipment || !canComplete) return;

    setLoadingConfirm(true);
    try {
      const res = await outboundAdapter.confirmProcess({
        invoice_no: shipment.invoiceNo,
      });

      if (!res.ok) {
        handleError(res.error);
        return;
      }
      if (!res.data) {
        handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "출고 처리에 실패했습니다.",
        } as any);
        return;
      }

      const confirmR = unwrapResult<OutboundProcessConfirmResult>(res.data);

      const stateRes = await outboundAdapter.fetchProcessState(
        shipment.invoiceNo,
      );

      if (stateRes.ok && stateRes.data) {
        const st = unwrapResult<OutboundProcessStateResult>(stateRes.data);

        if (st) {
          setShipment((prev) =>
            prev
              ? {
                  ...prev,
                  status: st.status ?? confirmR?.status ?? "completed",
                  overallStatus: st.overall_status ?? prev.overallStatus,
                  weightG:
                    typeof st.weight_g === "number" && st.weight_g > 0
                      ? st.weight_g
                      : prev.weightG,
                }
              : prev,
          );
        } else {
          setShipment((prev) =>
            prev ? { ...prev, status: confirmR?.status ?? "completed" } : prev,
          );
        }
      } else {
        setShipment((prev) =>
          prev ? { ...prev, status: confirmR?.status ?? "completed" } : prev,
        );
      }

      alert("출고 처리 완료되었습니다.");
      focusInvoice();
    } catch (err: any) {
      console.error(err);
      handleError(err as any);
    } finally {
      setLoadingConfirm(false);
    }
  };

  /* 렌더 */

  const allRows = shipment?.items ?? [];

  return (
    <div className="p-4">
      {/* 상단 설명 카드 */}
      <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h1 className="text-lg font-semibold">출고 처리</h1>
        <p className="mt-1 text-sm text-gray-600">
          송장 스캔 → 품목 로드 → 바코드 스캔으로 수량 일치 → 중량(g) 입력 → 출고 처리 완료
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
                  void handleInvoiceEnter();
                }
                if (e.key === "Tab") {
                  e.preventDefault();
                  focusBarcode();
                }
              }}
              placeholder="송장번호 스캔 또는 입력"
              className="w-full rounded-xl border px-3 py-2 md:w-[340px]"
              disabled={loadingInvoice}
            />
            <input
              ref={barcodeRef}
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleBarcodeEnter();
                }
              }}
              placeholder="제품 바코드 스캔"
              className="w-full rounded-xl border px-3 py-2 md:w-[420px]"
              disabled={!shipment || loadingScan}
            />
          </div>

          <div className="flex items-center gap-3 md:ml-auto">
            <label className="flex items-center gap-2">
              <span className="text-sm text-gray-700">중량(g)</span>
              <input
                type="number"
                inputMode="decimal"
                step="1"
                min={0}
                value={shipment?.weightG ?? ""}
                onChange={(e) => handleWeightChange(e.currentTarget.value)}
                onBlur={() => void handleWeightBlur()}
                className="w-[120px] rounded-xl border px-3 py-2 text-right"
                disabled={!shipment}
              />
            </label>

            <button
              className={`rounded-xl px-4 py-2 ${
                canComplete
                  ? "bg-black text-white"
                  : "bg-gray-200 text-gray-600 cursor-not-allowed"
              }`}
              onClick={() => void completeShipment()}
              disabled={!canComplete || loadingConfirm}
            >
              {loadingConfirm ? "처리 중..." : "출고 처리 완료"}
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
              <span>
                상태: <b>{shipment.overallStatus ?? shipment.status}</b>
              </span>
              {shipment.weightG && shipment.weightG > 0 && (
                <span>
                  중량: <b>{shipment.weightG} g</b>
                </span>
              )}
            </div>
          ) : (
            <span>송장번호를 스캔하여 출고 품목을 불러오세요.</span>
          )}
        </div>
      </div>

      {/* 리스트 카드 */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="max-h-[560px] overflow-auto rounded-2xl">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">바코드</th>
                <th className="px-3 py-2 text-left">상품명</th>
                <th className="px-3 py-2 text-center">요구수량</th>
                <th className="px-3 py-2 text-center">스캔수량</th>
                <th className="px-3 py-2 text-center">잔여</th>
                <th className="px-3 py-2 text-center">상태</th>
              </tr>
            </thead>
            <tbody>
              {allRows.length === 0 ? (
                <tr>
                  <td className="py-10 text-center text-gray-500" colSpan={7}>
                    로드된 출고 품목이 없습니다.
                  </td>
                </tr>
              ) : (
                allRows.map((it) => {
                  const remaining = it.requiredQty - it.scannedQty;
                  const status: "ok" | "warn" | "over" =
                    remaining === 0 ? "ok" : remaining < 0 ? "over" : "warn";
                  return (
                    <tr
                      key={it.id}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-3 py-2 align-middle font-mono">
                        {it.sku}
                      </td>
                      <td className="px-3 py-2 align-middle font-mono">
                        {it.barcode || (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {it.name || (
                          <span className="text-gray-400">상품명 없음</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle text-center">
                        {it.requiredQty}
                      </td>
                      <td className="px-3 py-2 align-middle text-center">
                        {it.scannedQty}
                      </td>
                      <td className="px-3 py-2 align-middle text-center">
                        {Math.max(remaining, 0)}
                      </td>
                      <td className="px-3 py-2 align-middle text-center">
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
                <b>
                  {
                    shipment.items.filter(
                      (x) => x.scannedQty === x.requiredQty,
                    ).length
                  }
                </b>
                개
              </>
            ) : (
              <>출고 품목을 로드하면 요약이 표시됩니다.</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
