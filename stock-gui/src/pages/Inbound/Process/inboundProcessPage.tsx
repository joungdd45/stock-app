/**
 * UI: 입고 처리 페이지 (라운드 카드 + 스티키 헤더 테이블)
 * File: src/pages/Inbound/Process/inboundProcessPage.tsx
 *
 * 기능 요약
 * - 바코드 스캔 추가(Enter) → 새 행 추가, qty는 빈칸 시작
 * - 수량 입력 숫자만 허용, 빈칸 유지 가능
 * - 수량 입력칸에서 Enter → 해당 행의 "입고 처리" 버튼으로 포커스
 * - 처리 가능 조건: qty가 숫자이고 > 0, 상태가 "완료대기"
 * - 처리 후 버튼 대신 붉은색 볼드 "입고완료" 표시
 * - KST 기준 YYYY-MM-DD 주문일자 자동 생성
 * - UI 라운드 카드, 섹션 분리, 테이블 헤더 sticky
 * - 미등록 바코드 스캔 시 상단 중앙 토스트로 안내만 표시
 * - 체크박스 선택 후 "바코드 등록" 버튼으로 모달 오픈
 *   (바코드, SKU, 상품명을 모두 수정 가능)
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

// ────────────────────────────────────────────────────────────────
// 타입
type ScannedItem = {
  id: string;
  orderDate: string;
  barcode: string;
  sku?: string;
  name?: string;
  qty?: number;
  supplier?: string;
  status: "대기" | "등록필요" | "완료대기" | "입고완료";
};

type RegisterModalState = {
  open: boolean;
  targetRowId?: string;
  targetSku?: string;
  targetName?: string;
  targetBarcode?: string;
};

// ────────────────────────────────────────────────────────────────
// 헬퍼
const uid = () => Math.random().toString(36).slice(2, 10);

// KST 기준 YYYY-MM-DD 문자열 반환
const todayKST = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// 바코드 → SKU/상품명 임시 매핑 (추후 API 대체)
const mockResolveBarcode = (barcode: string) => {
  if (/^\d{3,}$/.test(barcode)) {
    return {
      sku: `SKU-${barcode.slice(-6)}`,
      name: `상품-${barcode.slice(-4)}`,
    };
  }
  return null;
};

// ────────────────────────────────────────────────────────────────
// 컴포넌트
const ProcessPage: React.FC = () => {
  const [barcode, setBarcode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<ScannedItem[]>([]);
  const [showRegisterModal, setShowRegisterModal] = useState<RegisterModalState>(
    { open: false }
  );

  // 토스트 메시지 상태
  const [toast, setToast] = useState<string | null>(null);

  // 각 행 수량 input refs
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  // 선택 체크박스
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const selectedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked]
  );

  // 포커스 유틸
  const focusBarcodeInput = () =>
    setTimeout(() => inputRef.current?.focus(), 0);

  const focusFirstQty = () => {
    const first = items[0];
    if (!first) return;
    const el = qtyRefs.current[first.id];
    if (el) setTimeout(() => el.focus(), 0);
  };

  // 방금 추가한 행의 수량 input으로 렌더 후 자동 포커스
  useEffect(() => {
    if (!lastAddedId) return;
    const el = qtyRefs.current[lastAddedId];
    if (el) {
      el.focus();
      setLastAddedId(null);
    }
  }, [items, lastAddedId]);

  // 토스트 자동 삭제
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // 스캔 추가 (Enter 전용) — qty를 undefined로 두어 빈칸으로 시작
  const handleScanAdd = () => {
    const value = barcode.trim();
    if (!value) {
      focusBarcodeInput();
      return;
    }

    const resolved = mockResolveBarcode(value);
    const newId = uid();
    const next: ScannedItem = {
      id: newId,
      orderDate: todayKST(),
      barcode: value,
      sku: resolved?.sku,
      name: resolved?.name,
      qty: undefined,
      supplier: undefined,
      status: resolved ? "완료대기" : "등록필요",
    };

    setItems((prev) => [next, ...prev]);
    setBarcode("");

    if (!resolved) {
      // 미등록 바코드 안내만 표시 (모달 자동 오픈 X)
      setToast(
        "등록된 바코드가 아닙니다. 상품을 선택한 뒤 바코드 등록 버튼으로 연결해 주세요."
      );
      return;
    }

    // 렌더 후 수량 포커스
    setLastAddedId(newId);
  };

  // 수량 변경: 숫자만 허용, 빈칸은 undefined로 보존
  const changeQty = (id: string, nextQty: number | undefined) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, qty: nextQty } : it))
    );
  };

  // 체크박스
  const toggleCheck = (id: string, value: boolean) =>
    setChecked((prev) => ({ ...prev, [id]: value }));

  const toggleCheckAll = (value: boolean) => {
    const next: Record<string, boolean> = {};
    items.forEach((it) => (next[it.id] = value));
    setChecked(next);
  };

  // 선택된 한 행 가져오기 (0개/여러 개일 때는 null)
  const getSingleSelectedRow = (): ScannedItem | null => {
    const selected = items.filter((it) => checked[it.id]);
    if (selected.length === 0) return null;
    if (selected.length > 1) return null;
    return selected[0];
  };

  // "바코드 등록" 버튼 클릭 시: 선택된 행 기준으로 모달 오픈
  const handleOpenRegisterModalFromSelection = () => {
    const row = getSingleSelectedRow();
    if (!row) {
      if (selectedCount === 0) {
        setToast("바코드를 등록할 상품을 먼저 한 개 선택하세요.");
      } else {
        setToast("한 번에 한 상품만 바코드를 등록할 수 있습니다.");
      }
      return;
    }

    setShowRegisterModal({
      open: true,
      targetRowId: row.id,
      targetSku: row.sku,
      targetName: row.name,
      targetBarcode: row.barcode || "",
    });
  };

  // 바코드 등록(모달 저장) — 대상 행의 SKU/상품명/바코드/상태 업데이트
  const registerBarcode = (
    skuValue: string,
    nameValue: string,
    barcodeValue: string
  ) => {
    const { targetRowId } = showRegisterModal;
    if (!targetRowId) return;

    setItems((prev) =>
      prev.map((it) =>
        it.id === targetRowId
          ? {
              ...it,
              barcode: barcodeValue,
              sku: skuValue,
              name: nameValue,
              status: "완료대기",
            }
          : it
      )
    );

    setShowRegisterModal({
      open: false,
      targetRowId: undefined,
      targetSku: undefined,
      targetName: undefined,
      targetBarcode: undefined,
    });

    focusBarcodeInput();
    setToast("바코드가 등록되었습니다. 이제 입고 처리할 수 있습니다.");
  };

  // 행별 입고 처리: qty가 숫자이고 > 0 이면서 상태가 완료대기일 때만
  const processRow = (id: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        if (
          typeof it.qty === "number" &&
          it.qty > 0 &&
          it.status === "완료대기"
        ) {
          // 실제론 API 성공 시 반영
          return { ...it, status: "입고완료" };
        }
        return it;
      })
    );
    focusBarcodeInput();
  };

  // ────────────────────────────────────────────────────────────────
  // UI (라운드 카드 + 스티키 헤더 테이블)
  return (
    <>
      <div className="p-4 space-y-4">
        {/* 상단 안내 카드 */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h1 className="text-lg font-semibold">입고 처리</h1>
          <p className="mt-1 text-sm text-gray-600">
            바코드를 스캔하거나 직접 입력한 뒤 Enter로 추가하세요. 등록되지 않은
            바코드는 상단 안내로 표시되고, 체크박스로 상품을 선택해 바코드를
            등록할 수 있습니다.
          </p>
        </div>

        {/* 스캔/액션 카드 */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              ref={inputRef}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScanAdd();
                }
                if (e.key === "Tab") {
                  e.preventDefault();
                  // 목록이 있으면 첫 행 수량 input으로 이동
                  const first = items[0];
                  const el = first ? qtyRefs.current[first.id] : null;
                  if (el) el.focus();
                }
              }}
              placeholder="바코드 스캔 또는 수기 입력"
              className="w-full rounded-xl border px-3 py-2 md:w-[520px]"
            />

            <div className="md:ml-auto flex gap-2">
              <button
                onClick={handleOpenRegisterModalFromSelection}
                className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
              >
                바코드 등록
              </button>
            </div>
          </div>
        </div>

        {/* 리스트 카드 */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          {/* 상단 툴바 */}
          <div className="flex items-center gap-3 border-b px-3 py-2 rounded-t-2xl">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                onChange={(e) => toggleCheckAll(e.currentTarget.checked)}
                checked={
                  items.length > 0 &&
                  items.every((it) => checked[it.id] === true)
                }
                aria-label="전체선택"
              />
              <span className="text-sm">전체선택</span>
            </label>
            <span className="text-sm text-gray-500">
              총 {items.length}건, 선택 {selectedCount}건
            </span>
          </div>

          {/* 테이블 */}
          <div className="max-h-[560px] overflow-auto rounded-b-2xl">
            <table
              className={[
                "w-full table-fixed border-collapse text-sm",
                "[&>thead>tr>th]:sticky [&>thead>tr>th]:top-0 [&>thead>tr>th]:z-10",
                "[&>thead>tr]:bg-gray-50 [&>thead>tr>th]:bg-gray-50",
                "[&>thead>tr>th]:border-b border-gray-200",
                "[&>thead>tr>th]:py-3 [&>tbody>tr>td]:py-3",
              ].join(" ")}
            >
              <colgroup>
                <col style={{ width: "60px" }} />
                <col style={{ width: "120px" }} />
                <col style={{ width: "220px" }} />
                <col style={{ width: "220px" }} />
                <col style={{ width: "auto" }} />
                <col style={{ width: "120px" }} />
                <col style={{ width: "140px" }} />
              </colgroup>

              <thead>
                <tr>
                  <th className="text-left px-2">선택</th>
                  <th className="text-left px-2">주문일자</th>
                  <th className="text-left px-2">바코드</th>
                  <th className="text-left px-2">SKU</th>
                  <th className="text-left px-2">상품명</th>
                  <th className="text-right px-2">수량</th>
                  <th className="text-center px-2">입고 처리</th>
                </tr>
              </thead>

              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td
                      className="py-10 text-center text-gray-500"
                      colSpan={7}
                    >
                      스캔된 항목이 없습니다.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => {
                    const canProcess =
                      typeof row.qty === "number" &&
                      row.qty > 0 &&
                      row.status === "완료대기";
                    const isDone = row.status === "입고완료";
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="px-2 align-middle">
                          <input
                            type="checkbox"
                            checked={!!checked[row.id]}
                            onChange={(e) =>
                              toggleCheck(row.id, e.currentTarget.checked)
                            }
                            aria-label={`select-${row.id}`}
                          />
                        </td>
                        <td className="px-2 align-middle">{row.orderDate}</td>
                        <td className="px-2 align-middle font-mono">
                          {row.barcode}
                        </td>
                        <td className="px-2 align-middle">
                          {row.sku ? (
                            row.sku
                          ) : (
                            <span className="text-red-600 font-bold">
                              등록 필요
                            </span>
                          )}
                        </td>
                        <td className="px-2 align-middle">
                          {row.name ?? "-"}
                        </td>
                        <td className="px-2 align-middle text-right">
                          <input
                            ref={(el) => {
                              qtyRefs.current[row.id] = el;
                            }}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={row.qty ?? ""}
                            onChange={(e) => {
                              const v = e.currentTarget.value;
                              if (/^\d*$/.test(v)) {
                                changeQty(
                                  row.id,
                                  v === "" ? undefined : Number(v)
                                );
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const btn = document.querySelector(
                                  `#confirm-btn-${row.id}`
                                ) as HTMLButtonElement | null;
                                btn?.focus();
                              }
                            }}
                            className="w-[90px] rounded-md border px-2 py-1 text-right"
                          />
                        </td>
                        <td className="px-2 align-middle text-center">
                          {isDone ? (
                            <span className="font-bold text-red-600">
                              입고완료
                            </span>
                          ) : (
                            <button
                              id={`confirm-btn-${row.id}`}
                              className={`rounded-md px-3 py-1.5 border ${
                                canProcess
                                  ? "bg-black text-white"
                                  : "bg-gray-200 text-gray-600 cursor-not-allowed"
                              }`}
                              disabled={!canProcess}
                              onClick={() => processRow(row.id)}
                              title={
                                canProcess
                                  ? "이 행을 입고 처리합니다."
                                  : row.status === "등록필요"
                                  ? "바코드 등록 후 처리 가능합니다."
                                  : "수량을 입력하거나 상태를 점검하세요."
                              }
                            >
                              입고 처리
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 안내 */}
        <p className="text-xs text-gray-500">
          참고: 더미 매핑 사용 중입니다. 실제 연동 시 바코드와 상품 매핑, 저장
          API로 대체하세요.
        </p>

        {/* 바코드 등록 모달 */}
        {showRegisterModal.open && (
          <RegisterBarcodeModal
            targetSku={showRegisterModal.targetSku}
            targetName={showRegisterModal.targetName}
            defaultBarcode={showRegisterModal.targetBarcode}
            onClose={() =>
              setShowRegisterModal({
                open: false,
                targetRowId: undefined,
                targetSku: undefined,
                targetName: undefined,
                targetBarcode: undefined,
              })
            }
            onSave={(sku, name, bc) => registerBarcode(sku, name, bc)}
          />
        )}
      </div>

      {/* 토스트 메시지: 상단 중앙 */}
      {toast && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 transform">
          <div className="rounded-full bg-black px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </>
  );
};

// ────────────────────────────────────────────────────────────────
// 바코드 등록 모달
// - 바코드 / SKU / 상품명을 모두 입력 가능
// - 기본값은 선택된 행의 값으로 채움
const RegisterBarcodeModal: React.FC<{
  targetSku?: string;
  targetName?: string;
  defaultBarcode?: string;
  onClose: () => void;
  onSave: (sku: string, name: string, barcode: string) => void;
}> = ({ targetSku, targetName, defaultBarcode, onClose, onSave }) => {
  const [sku, setSku] = useState(targetSku ?? "");
  const [name, setName] = useState(targetName ?? "");
  const [barcode, setBarcode] = useState(defaultBarcode ?? "");

  const barcodeRef = useRef<HTMLInputElement>(null);
  const skuRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setTimeout(() => barcodeRef.current?.focus(), 0);
  }, []);

  const canSave =
    sku.trim().length > 0 && name.trim().length > 0 && barcode.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave(sku.trim(), name.trim(), barcode.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-[520px] rounded-2xl border bg-white shadow-lg">
        <div className="border-b p-4 rounded-t-2xl">
          <h2 className="text-lg font-semibold">바코드 등록</h2>
          <p className="text-sm text-gray-600">
            선택한 상품의 바코드, SKU, 상품명을 확인·수정한 뒤 저장하세요.
          </p>
        </div>

        <div className="space-y-4 p-4">
          {/* 바코드 */}
          <div>
            <label className="mb-1 block text-sm text-gray-700">바코드</label>
            <input
              ref={barcodeRef}
              value={barcode}
              onChange={(e) => setBarcode(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  skuRef.current?.focus();
                }
              }}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="예: 8801234567890"
            />
          </div>

          {/* SKU */}
          <div>
            <label className="mb-1 block text-sm text-gray-700">SKU</label>
            <input
              ref={skuRef}
              value={sku}
              onChange={(e) => setSku(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  nameRef.current?.focus();
                }
              }}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="예: FD_SAMY_BULDAK_0200_01EA"
            />
          </div>

          {/* 상품명 */}
          <div>
            <label className="mb-1 block text-sm text-gray-700">상품명</label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (canSave) {
                    handleSave();
                  } else {
                    saveBtnRef.current?.focus();
                  }
                }
              }}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="예: 삼양 불닭볶음면 200g"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-4 rounded-b-2xl">
          <button
            onClick={onClose}
            className="rounded-xl border px-3 py-2 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            ref={saveBtnRef}
            onClick={handleSave}
            disabled={!canSave}
            className={`rounded-xl px-4 py-2 ${
              canSave
                ? "bg-black text-white"
                : "cursor-not-allowed bg-gray-300 text-gray-600"
            }`}
            title={
              canSave
                ? "저장"
                : "바코드, SKU, 상품명을 모두 입력하세요"
            }
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProcessPage;
