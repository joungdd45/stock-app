/* ============================================================================
 * 📄 src/pages/Inbound/Process/inboundProcessPage.tsx
 * 입고 처리 페이지 (전표 선택 → 바코드 스캔 → 수량입력 → 개별 확정)
 *
 * 구성:
 * 1) 상단 바코드 스캔 영역 (입고등록-조회탭의 검색 박스 자리에 위치)
 * 2) 전표 선택 표 (조회탭 하단 표 느낌, 라디오 선택)
 * 3) 스캔 목록 표
 * 4) 바코드 미등록 시 바코드 등록 모달
 *    + 전표 바코드는 SKU 기반 상품 lookup 으로 보강(B안)
 *    + 모달 내부 SKU 입력 후 자동으로 상품명 lookup_by_sku
 * ========================================================================== */

import React, { useEffect, useRef, useState } from "react";
import { inboundAdapter } from "@/api/adapters/inbound.adapter";

/* ─────────────────────────────────────────────
 * 타입 정의
 * ───────────────────────────────────────────── */

type InboundHeaderItem = {
  item_id: number;
  sku: string;
  name: string;
  qty: number;
};

type InboundHeaderSummary = {
  header_id: number;
  order_no: string;
  barcode?: string | null;
  sku?: string | null;
  name?: string | null;
  expected_qty: number;
  items: InboundHeaderItem[];
};

type InboundProcessScanResult = {
  sku: string;
  name: string;
  barcode: string;
};

type ScannedItem = {
  id: string;
  barcode: string;
  sku?: string;
  name?: string;
  qty?: number;
  itemId?: number;
  status: "등록필요" | "완료대기" | "입고완료";
};

type BarcodeRegisterForm = {
  barcode: string;
  sku: string;
  name: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ─────────────────────────────────────────────
 * 바코드 등록 모달
 * ───────────────────────────────────────────── */

type BarcodeRegisterModalProps = {
  open: boolean;
  form: BarcodeRegisterForm;
  saving: boolean;
  error: string | null;
  onChange: (form: BarcodeRegisterForm) => void;
  onClose: () => void;
  onSubmit: () => void;
  // ✅ SKU 입력 후 상품명 자동 조회
  onSkuLookup: (sku: string) => void;
};

const BarcodeRegisterModal: React.FC<BarcodeRegisterModalProps> = ({
  open,
  form,
  saving,
  error,
  onChange,
  onClose,
  onSubmit,
  onSkuLookup,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">바코드 신규 등록</h2>

        <p className="mb-3 text-xs text-gray-600">
          스캔된 바코드가 아직 등록되어 있지 않습니다. 매핑할 SKU와 상품명을 입력해 주세요.
        </p>

        <div className="space-y-3 text-sm">
          <div className="flex flex-col gap-1">
            <span className="text-gray-700">바코드</span>
            <input
              type="text"
              className="rounded-lg border px-3 py-2 bg-gray-50 text-gray-700"
              value={form.barcode}
              readOnly
            />
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-gray-700">SKU</span>
            <input
              type="text"
              className="rounded-lg border px-3 py-2"
              placeholder="예: sku-001"
              value={form.sku}
              onChange={(e) => {
                onChange({ ...form, sku: e.target.value });
              }}
              onBlur={() => {
                // 포커스가 빠져나갈 때 lookup_by_sku 호출
                if (form.sku.trim()) {
                  onSkuLookup(form.sku.trim());
                }
              }}
              disabled={saving}
            />
            <span className="mt-1 text-[11px] text-gray-400">
              SKU 입력 후 입력창에서 나가면 자동으로 상품명을 조회합니다.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-gray-700">상품명</span>
            <input
              type="text"
              className="rounded-lg border px-3 py-2"
              placeholder="상품명 입력"
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
              disabled={saving}
              onFocus={() => {
                // 상품명에 포커스될 때 이름이 비어 있고 SKU가 있으면 한 번 더 보조 조회
                if (!form.name.trim() && form.sku.trim()) {
                  onSkuLookup(form.sku.trim());
                }
              }}
            />
          </label>

          {error && (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-line">
              {error}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2 text-sm">
          <button
            type="button"
            className="rounded-xl border px-4 py-2 text-gray-700 hover:bg-gray-50"
            disabled={saving}
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-60"
            disabled={saving}
            onClick={onSubmit}
          >
            {saving ? "등록 중..." : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
 * 메인 컴포넌트
 * ───────────────────────────────────────────── */

const ProcessPage: React.FC = () => {
  const [barcode, setBarcode] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [headerList, setHeaderList] = useState<InboundHeaderSummary[]>([]);
  const [selectedHeader, setSelectedHeader] =
    useState<InboundHeaderSummary | null>(null);

  const [items, setItems] = useState<ScannedItem[]>([]);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [loadingRowId, setLoadingRowId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 바코드 등록 모달
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false);
  const [barcodeForm, setBarcodeForm] = useState<BarcodeRegisterForm>({
    barcode: "",
    sku: "",
    name: "",
  });
  const [barcodeSaving, setBarcodeSaving] = useState(false);
  const [barcodeModalError, setBarcodeModalError] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // 초기화
  useEffect(() => {
    const init = async () => {
      try {
        await inboundAdapter.processPing();
      } catch (e) {
        console.error("[InboundProcess] ping error", e);
        setToast("입고 처리 API 연결에 실패했습니다.");
      }
      await loadHeaderList();
    };
    void init();
  }, []);

  /* ─────────────────────────────────────────────
   * 전표 로드 + SKU 기반 바코드 보강 (B안)
   * ───────────────────────────────────────────── */

  const loadHeaderList = async () => {
    try {
      const res = await inboundAdapter.registerQueryList({
        page: 1,
        size: 100,
      });

      if (!res.ok || !res.data) {
        setToast("전표 조회 실패");
        return;
      }

      // 1) committed 라인은 제외
      const rows = (res.data.items ?? []).filter(
        (row: any) => row.status !== "committed"
      );

      // 2) header_id 기준 그룹핑
      const grouped: Record<number, InboundHeaderSummary> = {};

      rows.forEach((row: any) => {
        const hid = row.header_id as number;

        if (!grouped[hid]) {
          grouped[hid] = {
            header_id: hid,
            order_no: row.order_no,
            barcode: null,
            sku: row.sku ?? null,
            name: row.name ?? null,
            expected_qty: 0,
            items: [],
          };
        }

        const bucket = grouped[hid];

        bucket.items.push({
          item_id: row.item_id,
          sku: row.sku,
          name: row.name,
          qty: row.qty,
        });

        bucket.expected_qty += row.qty ?? 0;
      });

      const list = Object.values(grouped);

      // 3) 전표 안에 등장하는 모든 SKU 모으기
      const uniqueSkus = Array.from(
        new Set(
          list
            .flatMap((h) => h.items.map((it) => it.sku))
            .filter((sku): sku is string => !!sku)
        )
      );

      // 4) SKU → barcode 매핑 (입고 어댑터의 lookupProductBySku 사용)
      const skuBarcodeMap: Record<string, string> = {};

      await Promise.all(
        uniqueSkus.map(async (sku) => {
          try {
            const lookupRes = await inboundAdapter.lookupProductBySku(sku);
            if (!lookupRes.ok || !lookupRes.data) return;

            const data = lookupRes.data as any;
            if (!data.ok || !data.item) return;

            if (data.item.barcode) {
              skuBarcodeMap[sku] = data.item.barcode;
            }
          } catch (e) {
            console.error("[InboundProcess] lookupProductBySku error", sku, e);
          }
        })
      );

      // 5) 대표 SKU 기준으로 전표 요약에 barcode 채우기
      const enriched = list.map((h) => {
        const reprSku = h.sku || h.items[0]?.sku;
        const reprBarcode =
          reprSku && skuBarcodeMap[reprSku]
            ? skuBarcodeMap[reprSku]
            : null;
        return {
          ...h,
          barcode: reprBarcode,
        };
      });

      setHeaderList(enriched);
      setSelectedHeader(enriched.length > 0 ? enriched[0] : null);
    } catch (e) {
      console.error("[InboundProcess] loadHeaderList error", e);
      setToast("전표 조회 중 오류가 발생했습니다.");
    }
  };

  /* ─────────────────────────────────────────────
   * 바코드 등록 모달 관련
   * ───────────────────────────────────────────── */

  const openBarcodeRegisterModal = (scannedBarcode: string) => {
    setBarcodeForm({
      barcode: scannedBarcode,
      sku: "",
      name: "",
    });
    setBarcodeModalError(null);
    setBarcodeModalOpen(true);
  };

  const closeBarcodeRegisterModal = () => {
    if (barcodeSaving) return;
    setBarcodeModalOpen(false);
    setBarcodeModalError(null);
  };

  // ✅ SKU 기준 상품명 자동 채우기 (lookup_by_sku 활용)
  const handleSkuLookupInModal = async (sku: string) => {
    const trimmed = sku.trim();
    if (!trimmed) return;

    try {
      const res = await inboundAdapter.lookupProductBySku(trimmed);

      if (!res.ok || !res.data) {
        setBarcodeModalError("SKU 조회에 실패했습니다. SKU를 다시 확인해 주세요.");
        return;
      }

      const data: any = res.data;
      if (!data.ok || !data.item) {
        setBarcodeModalError("해당 SKU에 해당하는 상품을 찾을 수 없습니다.");
        return;
      }

      const item = data.item;

      setBarcodeForm((prev) => ({
        ...prev,
        sku: item.sku ?? trimmed,
        name: item.name ?? prev.name,
      }));
      setBarcodeModalError(null);
    } catch (e) {
      console.error("[InboundProcess] handleSkuLookupInModal error", e);
      setBarcodeModalError("상품 조회 중 오류가 발생했습니다.");
    }
  };

  const submitBarcodeRegister = async () => {
    const trimmedSku = barcodeForm.sku.trim();
    const trimmedName = barcodeForm.name.trim();

    if (!trimmedSku || !trimmedName) {
      setBarcodeModalError("SKU와 상품명을 모두 입력하세요.");
      return;
    }

    setBarcodeSaving(true);
    setBarcodeModalError(null);

    const res = await inboundAdapter.processRegisterBarcode({
      barcode: barcodeForm.barcode,
      sku: trimmedSku,
      name: trimmedName,
    });

    setBarcodeSaving(false);

    if (!res.ok) {
      const code = res.error?.code ?? "UNKNOWN";
      const msg = res.error?.message ?? "등록 중 오류가 발생했습니다.";
      const detail = res.error?.detail;

      if (code === "INBOUND-NOTFOUND-101") {
        setBarcodeModalError(
          `SKU를 찾을 수 없습니다. SKU를 다시 확인해 주세요.\n(${code}: ${
            detail ?? msg
          })`
        );
      } else {
        setBarcodeModalError(`바코드 등록 실패\n코드: ${code}\n메시지: ${msg}`);
      }
      return;
    }

    setBarcodeModalOpen(false);
    setToast("바코드가 등록되었습니다. 같은 바코드를 다시 스캔해 주세요.");
  };

  /* ─────────────────────────────────────────────
   * 스캔 처리
   * ───────────────────────────────────────────── */

  const handleScanAdd = async () => {
    if (!selectedHeader) {
      setToast("먼저 전표를 선택하세요.");
      return;
    }

    const value = barcode.trim();
    if (!value) return;

    const baseId = uid();

    const fallback: ScannedItem = {
      id: baseId,
      barcode: value,
      status: "등록필요",
    };

    try {
      const res = await inboundAdapter.processScan({ barcode: value });

      if (!res.ok || !res.data) {
        setBarcode("");
        openBarcodeRegisterModal(value);
        setToast("등록되지 않은 바코드입니다. SKU를 등록해 주세요.");
        return;
      }

      const r = (res.data.result ?? res.data) as InboundProcessScanResult;

      const line = selectedHeader.items.find((it) => it.sku === r.sku);

      if (!line) {
        setBarcode("");
        setToast("선택한 전표에 없는 SKU입니다.");
        return;
      }

      const next: ScannedItem = {
        id: baseId,
        barcode: r.barcode,
        sku: r.sku,
        name: r.name,
        qty: undefined,
        itemId: line.item_id,
        status: "완료대기",
      };

      setItems((prev) => [next, ...prev]);
      setBarcode("");
    } catch (e) {
      console.error("[InboundProcess] scan error", e);
      setBarcode("");
      setToast("스캔 중 오류가 발생했습니다.");
    }
  };

  const changeQty = (id: string, qty: number | undefined) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, qty } : it))
    );
  };

  /* ─────────────────────────────────────────────
   * 개별 입고 처리
   * ───────────────────────────────────────────── */

  const processRow = async (row: ScannedItem) => {
    if (!selectedHeader) {
      setToast("전표를 선택하세요.");
      return;
    }
    if (!row.sku || !row.itemId) {
      setToast("전표 매핑 정보가 부족합니다.");
      return;
    }
    if (!row.qty || row.qty <= 0) {
      setToast("수량을 입력하세요.");
      return;
    }

    setLoadingRowId(row.id);

    try {
      const setRes = await inboundAdapter.processSetQty({
        sku: row.sku,
        qty: row.qty,
      });

      if (!setRes.ok) {
        setToast("수량 설정에 실패했습니다.");
        setLoadingRowId(null);
        return;
      }

      const confirmRes = await inboundAdapter.processConfirm({
        header_id: selectedHeader.header_id,
        items: [{ item_id: row.itemId, sku: row.sku, qty: row.qty }],
        operator: "dj",
      });

      if (!confirmRes.ok) {
        setToast("입고 처리에 실패했습니다.");
        setLoadingRowId(null);
        return;
      }

      setItems((prev) =>
        prev.map((it) =>
          it.id === row.id ? { ...it, status: "입고완료" } : it
        )
      );
    } catch (e) {
      console.error("[InboundProcess] confirm error", e);
      setToast("입고 처리 중 오류가 발생했습니다.");
    } finally {
      setLoadingRowId(null);
    }
  };

  /* ─────────────────────────────────────────────
   * UI
   * ───────────────────────────────────────────── */

  return (
    <>
      <div className="p-4 space-y-4">
        {/* 1) 상단 바코드 스캔 박스 */}
        <div className="mb-1 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="flex-1">
              <input
                ref={(el) => {
                  inputRef.current = el;
                }}
                className="w-full border rounded-xl px-3 py-2"
                placeholder={
                  selectedHeader
                    ? "바코드 스캔..."
                    : "먼저 아래에서 전표를 선택하세요."
                }
                disabled={!selectedHeader}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleScanAdd();
                  }
                }}
              />
            </div>
            <div className="mt-2 w-full md:mt-0 md:w-auto md:ml-3">
              <button
                type="button"
                className="w-full rounded-xl bg.black px-4 py-2 text-sm text-white disabled:opacity-50 bg-black"
                disabled={!selectedHeader || !barcode.trim()}
                onClick={() => void handleScanAdd()}
              >
                스캔 처리
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            아래에서 입고 전표를 선택한 뒤, 상단 입력창에 바코드를 스캔해 주세요.
            미등록 바코드는 자동으로 등록 모달이 열립니다.
          </p>
        </div>

        {/* 2) 전표 선택 표 */}
        <div className="border bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <h2 className="text-lg font-semibold">입고 전표 선택</h2>

          <div className="max-h-[260px] overflow-auto border rounded-xl">
            <table
              className="w-full text-sm"
              style={{ tableLayout: "fixed" }}
            >
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 w-[8%] text-center">선택</th>
                  <th className="px-2 py-2 w-[20%] text-center">주문번호</th>
                  <th className="px-2 py-2 w-[15%] text-center">바코드</th>
                  <th className="px-2 py-2 w-[22%] text-center">SKU</th>
                  <th className="px-2 py-2 w-[28%] text-center">상품명</th>
                  <th className="px-2 py-2 w-[7%] text-center">기대 수량</th>
                </tr>
              </thead>

              <tbody>
                {headerList.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-6 text-center text-gray-500"
                    >
                      입고 내역이 없습니다.
                    </td>
                  </tr>
                )}

                {headerList.map((h) => (
                  <tr
                    key={h.header_id}
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelectedHeader(h)}
                  >
                    <td className="px-2 py-2 text-center">
                      <input
                        type="radio"
                        checked={selectedHeader?.header_id === h.header_id}
                        onChange={() => setSelectedHeader(h)}
                      />
                    </td>
                    <td className="px-2 py-2 truncate text-center">
                      {h.order_no}
                    </td>
                    <td className="px-2 py-2 truncate text-center">
                      {h.barcode ?? "-"}
                    </td>
                    <td className="px-2 py-2 truncate text-center">
                      {h.sku ?? "-"}
                    </td>
                    <td className="px-2 py-2 truncate text-center">
                      {h.name ?? "-"}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {h.expected_qty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3) 스캔 리스트 */}
        <div className="border bg-white rounded-2xl shadow-sm">
          <div className="border-b px-3 py-2 text-sm">스캔 목록</div>

          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2">바코드</th>
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2">상품명</th>
                  <th className="px-2 py-2 text-right">수량</th>
                  <th className="px-2 py-2 text-center">처리</th>
                </tr>
              </thead>

              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-6 text-center text-gray-500"
                    >
                      스캔 항목 없음
                    </td>
                  </tr>
                )}

                {items.map((row) => {
                  const canProcess =
                    row.status === "완료대기" &&
                    typeof row.qty === "number" &&
                    row.qty > 0;
                  const isLoading = loadingRowId === row.id;

                  return (
                    <tr key={row.id} className="border-b">
                      <td className="px-2 py-2">{row.barcode}</td>
                      <td className="px-2 py-2">{row.sku ?? "-"}</td>
                      <td className="px-2 py-2">{row.name ?? "-"}</td>

                      <td className="px-2 py-2 text-right">
                        <input
                          ref={(el) => {
                            qtyRefs.current[row.id] = el;
                          }}
                          type="number"
                          className="w-20 border rounded-md px-2 py-1"
                          value={row.qty ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (/^\d*$/.test(v)) {
                              changeQty(
                                row.id,
                                v ? Number(v) : undefined
                              );
                            }
                          }}
                        />
                      </td>

                      <td className="px-2 py-2 text-center">
                        {row.status === "입고완료" ? (
                          <span className="text-green-600 font-bold">
                            완료
                          </span>
                        ) : (
                          <button
                            disabled={!canProcess || isLoading}
                            onClick={() => void processRow(row)}
                            className={
                              canProcess && !isLoading
                                ? "px-3 py-1 rounded-md bg-black text-white"
                                : "px-3 py-1 rounded-md bg-gray-200 text-gray-500"
                            }
                          >
                            {isLoading ? "처리중..." : "입고"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 바코드 등록 모달 */}
      <BarcodeRegisterModal
        open={barcodeModalOpen}
        form={barcodeForm}
        saving={barcodeSaving}
        error={barcodeModalError}
        onChange={(next) => {
          setBarcodeForm(next);
          // 입력이 바뀌면 에러 메시지는 일단 지워준다
          setBarcodeModalError(null);
        }}
        onClose={closeBarcodeRegisterModal}
        onSubmit={submitBarcodeRegister}
        onSkuLookup={(sku) => {
          void handleSkuLookupInModal(sku);
        }}
      />

      {/* 토스트 */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-black text-white px-4 py-2 rounded-full shadow-lg z-50 whitespace-pre-line">
          {toast}
        </div>
      )}
    </>
  );
};

export default ProcessPage;
