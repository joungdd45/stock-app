/* C:\dev\stock-mobile\src\pages\stock\StockTakeScanPage.tsx */
/**
 * 재고실사 > 스캔 페이지 (InboundBarcodeScanPage 모방)
 * - 바코드 스캔 →
 *   1) stockAdapter.scanStatusByBarcode로 매칭 시도(재고현황 기준)
 *   2) 실패 시 products.register lookup-by-barcode로 SKU 확보
 *      → (선택) stockAdapter.getStatusList로 현재 재고수량 보강
 *      → SKU 확보되면 adjustFinalQty 가능
 *   3) 그것도 실패하면 상품선택 페이지로 이동(/stock/take/search?barcode=.)
 *
 * ✅ 수정 포인트
 * - 저장 후 lastBarcode 초기화 → 같은 바코드 재스캔 가능
 * - saving 상태 추가 → 저장 더블클릭 방지(하지만 다음 저장은 정상)
 * - search 페이지에서 돌아온 ?barcode=. 는 자동 lookup
 *
 * ✅ 빌드 오류(TS2307) 해결
 * - ././ 로 잘못된 상대경로를 ../../ 로 교정
 */

import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Camera } from "lucide-react";

import { AppShell, Card, COLORS } from "../../components/layout/AppShell";
import { stockAdapter } from "../../api/adapters/stock.adapter";
import { apiHub } from "../../api/hub/apiHub";

import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

import { playBeep } from "../../lib/beep";
import { handleError } from "../../utils/handleError";

type ScanResultShape = {
  sku: string;
  name: string;
  current_qty: number;
  available_qty: number;
  last_price: number | null;
};

type ProductLookupByBarcodeItem = {
  sku: string;
  name: string;
  last_inbound_price?: string | number | null;
  weight?: string | number | null;
  barcode?: string | null;
  is_bundle_related?: boolean;
};

const PRODUCTS_LOOKUP_BY_BARCODE_URL = "/api/products/register/lookup-by-barcode";

const StockTakeScanPage: React.FC = () => {
  const nav = useNavigate();
  const { search } = useLocation();
  const sp = new URLSearchParams(search);

  const prefillBarcode = (sp.get("barcode") ?? "").trim();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  const [qtyText, setQtyText] = useState<string>("");

  const [locked, setLocked] = useState(false);
  const [flash, setFlash] = useState(false);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [matched, setMatched] = useState<ScanResultShape | null>(null);
  const [scannedOk, setScannedOk] = useState(false);

  // ✅ 연속 인식 방지(디바운스)
  const lockRef = useRef(false);
  const lockTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1200);
  };

  const gotoSearch = (barcode: string) => {
    nav(`/stock/take/search?barcode=${encodeURIComponent(barcode)}`);
  };

  /**
   * 상품등록(product.register)에서 바코드로 SKU 단건 조회
   * - 응답 바디는 ActionResponse 래핑 구조라 케이스별로 안전 파싱
   */
  const lookupSkuByBarcodeFromProducts = async (
    barcode: string
  ): Promise<ProductLookupByBarcodeItem | null> => {
    const res = await apiHub.get<any>(PRODUCTS_LOOKUP_BY_BARCODE_URL, {
      params: { barcode },
    });

    if (!res.ok) return null;

    const raw: any = res.data;
    const item: any =
      raw?.data?.result?.item ??
      raw?.result?.item ??
      raw?.item ??
      null;

    const sku = String(item?.sku ?? "").trim();
    const name = String(item?.name ?? "").trim();

    if (!sku || !name) return null;

    return {
      sku,
      name,
      last_inbound_price: item?.last_inbound_price ?? null,
      weight: item?.weight ?? null,
      barcode: item?.barcode ?? null,
      is_bundle_related: !!item?.is_bundle_related,
    };
  };

  /**
   * (선택) 현재 재고수량 보강:
   * - stock/status/list에서 sku 키워드로 조회해서 정확히 sku 일치하는 1건을 뽑는다.
   * - 없으면 0으로 간주(재고현황에 아직 없거나, 기준 테이블이 다른 케이스)
   */
  const fillStatusBySku = async (sku: string) => {
    try {
      const res = await stockAdapter.getStatusList({
        page: 1,
        size: 10,
        keyword: sku,
      });
      if (!res.ok) return null;

      const raw: any = res.data;
      const items: any[] =
        raw?.items ??
        raw?.result?.items ??
        raw?.data?.result?.items ??
        raw?.data?.items ??
        [];

      const hit = items.find((x) => String(x?.sku ?? "").trim() === sku);
      if (!hit) return null;

      return {
        current_qty: Number(hit?.current_qty ?? 0),
        available_qty: Number(hit?.available_qty ?? 0),
        last_price: hit?.last_price ?? null,
      };
    } catch {
      return null;
    }
  };

  const lookup = async (barcode: string) => {
    if (loading) return;
    setLoading(true);
    setMatched(null);
    setScannedOk(false);
    setQtyText("");

    try {
      // 1) 재고현황 기준 바코드 스캔(기존 로직)
      const res = await stockAdapter.scanStatusByBarcode({ barcode });

      if (res.ok) {
        const found = (res.data as unknown) as ScanResultShape | null;
        if (found && String(found.sku ?? "").trim()) {
          setMatched(found);
          setScannedOk(true);
          setLocked(true);
          return;
        }
      } else {
        // 기존 에러는 기록만(바로 실패 처리하지 않고 다음 경로로 시도)
        handleError(res.error);
      }

      // 2) 상품등록 기준 바코드 → SKU 확보(신규 로직)
      const prod = await lookupSkuByBarcodeFromProducts(barcode);
      if (!prod) {
        gotoSearch(barcode);
        return;
      }

      const status = await fillStatusBySku(prod.sku);

      const merged: ScanResultShape = {
        sku: prod.sku,
        name: prod.name,
        current_qty: Number(status?.current_qty ?? 0),
        available_qty: Number(status?.available_qty ?? 0),
        last_price: (status?.last_price ?? null) as any,
      };

      setMatched(merged);
      setScannedOk(true);
      setLocked(true);
    } catch (e) {
      handleError(e);
      showToast("조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // ✅ search 페이지에서 복귀한 barcode는 자동 조회
  useEffect(() => {
    if (!prefillBarcode) return;
    if (locked || loading) return;
    void lookup(prefillBarcode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillBarcode]);

  // ✅ 스캐너 시작
  useEffect(() => {
    if (!videoRef.current) return;
    if (locked) return;

    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.ITF,
    ]);

    const codeReader = new BrowserMultiFormatReader(hints);
    readerRef.current = codeReader;

    let active = true;
    let controls: any = null;

    const stopAll = () => {
      active = false;

      try {
        controls?.stop?.();
      } catch {}

      try {
        (readerRef.current as any)?.reset?.();
      } catch {}

      if (videoRef.current && videoRef.current.srcObject) {
        try {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach((t) => t.stop());
        } catch {}
        videoRef.current.srcObject = null;
      }

      if (lockTimerRef.current) {
        window.clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    };

    const handleDetected = (scanned: string) => {
      if (!scanned) return;
      if (scanned === lastBarcode) return; // ✅ 같은 값 연속 인식 방지
      if (lockRef.current) return;

      lockRef.current = true;
      lockTimerRef.current = window.setTimeout(() => {
        lockRef.current = false;
      }, 1000);

      setLastBarcode(scanned);

      setFlash(true);
      setTimeout(() => setFlash(false), 200);

      void playBeep();
      if (navigator.vibrate) navigator.vibrate(100);

      void lookup(scanned);
    };

    const start = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          } as any,
        };

        controls = await (codeReader as any).decodeFromConstraints(
          constraints,
          videoRef.current!,
          (result: any) => {
            if (!active || locked || !result) return;
            const text = String(result.getText?.() ?? "").trim();
            handleDetected(text);
          }
        );
      } catch (e) {
        handleError(e);
        showToast("카메라 시작에 실패했습니다.");
      }
    };

    start();
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, lastBarcode]);

  const qtyNumber = Number(qtyText || "0");

  const handleAdjust = async () => {
    if (saving) return;
    if (!matched) return;

    if (!scannedOk || qtyNumber < 0) {
      showToast("수량을 입력해 주세요.");
      return;
    }

    setSaving(true);
    try {
      const res = await stockAdapter.adjustFinalQty({
        sku: matched.sku,
        final_qty: qtyNumber,
        memo: "재고실사(MOBILE)",
      });

      if (!res.ok) {
        handleError(res.error);
        showToast("재고실사 처리 중 오류가 발생했습니다.");
        return;
      }

      showToast("저장 완료");

      // ✅ 다음 실사 계속 (중요: lastBarcode 초기화로 같은 바코드도 다시 스캔 가능)
      setMatched(null);
      setScannedOk(false);
      setLocked(false);
      setQtyText("");
      setLastBarcode(null);
    } catch (e) {
      handleError(e);
      showToast("재고실사 처리 중 예외가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="재고실사 스캔">
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-white text-sm shadow-md"
          style={{ backgroundColor: "#e53935" }}
        >
          {toast}
        </div>
      )}

      <div className="space-y-3">
        <Card className="p-3 space-y-2">
          <div className="text-xs font-medium" style={{ color: COLORS.textGray }}>
            카메라
          </div>

          <div
            className="relative overflow-hidden rounded-2xl border"
            style={{ borderColor: COLORS.line }}
          >
            <video
              ref={videoRef}
              className="w-full aspect-[4/3] object-cover"
              muted
              playsInline
              autoPlay
            />

            {flash && (
              <div
                className="absolute inset-0 opacity-30"
                style={{ backgroundColor: COLORS.primary }}
              />
            )}

            <div
              className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full text-[11px] text-white"
              style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
            >
              <Camera size={14} />
              스캔 중
            </div>
          </div>

          <div className="text-[10px]" style={{ color: COLORS.textGray }}>
            {locked
              ? "조회 완료(잠금). 저장 후 다음 스캔이 가능합니다."
              : "바코드를 카메라에 비춰 주세요."}
          </div>
        </Card>

        <Card className="p-3 space-y-2">
          <div className="text-xs font-medium" style={{ color: COLORS.textGray }}>
            대상 상품
          </div>

          {matched ? (
            <>
              <div className="text-sm font-semibold" style={{ color: COLORS.main }}>
                {matched.name}
              </div>
              <div className="text-[10px]" style={{ color: COLORS.textGray }}>
                SKU: {matched.sku}
              </div>
              <div className="text-[10px]" style={{ color: COLORS.textGray }}>
                현재 재고: {Number(matched.current_qty ?? 0)}
              </div>
            </>
          ) : (
            <div className="text-sm" style={{ color: COLORS.textGray }}>
              바코드를 스캔해 주세요.
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs font-semibold" style={{ color: COLORS.main }}>
              현 재고수량
            </span>

            <input
              type="number"
              min={0}
              className="w-28 h-10 text-center rounded-xl border-2 outline-none text-sm disabled:bg-gray-100"
              style={{ borderColor: COLORS.line }}
              value={qtyText}
              disabled={!scannedOk || saving}
              onChange={(e) => setQtyText(e.target.value)}
            />
          </div>

          {!scannedOk && (
            <div className="text-[10px]" style={{ color: COLORS.textGray }}>
              바코드를 먼저 스캔하면 수량 입력이 가능합니다.
            </div>
          )}

          <button
            className="h-11 w-full rounded-xl font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: COLORS.main }}
            onClick={handleAdjust}
            disabled={!scannedOk || qtyNumber < 0 || saving}
          >
            {saving ? "저장 중..." : "재고실사 저장"}
          </button>
        </Card>
      </div>
    </AppShell>
  );
};

export default StockTakeScanPage;
