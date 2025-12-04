/* C:\dev\stock-mobile\src\pages\outbound\OutboundScanPage.tsx */
/**
 * 출고관리 > 출고처리 - 상품 스캔 전용 페이지 (실사용 버전)
 *  - URL: /outbound/scan-items?invoice=...
 *  - 송장 스캔 후 이 페이지로 진입
 *  - 상단: 송장번호
 *  - 중간: 카메라 뷰파인더 (자동 스캔)
 *  - 하단: 상품명 / 출고수량 / 스캔수량 / 일치여부 (4줄 구조)
 *  - 바코드 스캔 로직: zxing + flash + 삡 + 진동
 *  - 출고 중량: g 단위로 입력 및 /weight 저장 후 /confirm 호출
 */

import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AppShell,
  Card,
  COLORS,
} from "../../components/layout/AppShell";
import { outboundAdapter } from "../../api/adapters/outbound.adapter";
import { BrowserMultiFormatReader } from "@zxing/browser";

interface RequiredItem {
  itemId: number;
  sku: string;
  name: string;
  qty: number;
  scannedQty: number;
  status: string;
}

const OutboundScanPage: React.FC = () => {
  const nav = useNavigate();
  const { search } = useLocation();
  const sp = new URLSearchParams(search);
  const invoiceFromUrl = sp.get("invoice") ?? "";

  const [invoice, setInvoice] = useState(invoiceFromUrl);
  const [required, setRequired] = useState<RequiredItem[]>([]);
  const [toast, setToast] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [confirming, setConfirming] = useState<boolean>(false);

  // 출고 중량(g)
  const [weight, setWeight] = useState<string>("");

  // 카메라
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  // 오디오
  const beepRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);

  // 중복 스캔 방지
  const lastCodeRef = useRef<string | null>(null);
  const lastScanAtRef = useRef<number>(0);

  // ───────────────────────────────────────────
  // 출고 정보 로드
  // ───────────────────────────────────────────
  useEffect(() => {
    setInvoice(invoiceFromUrl);

    if (!invoiceFromUrl) {
      setRequired([]);
      setToast("송장번호가 없습니다");
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const res = await outboundAdapter.fetchProcessInvoice(invoiceFromUrl);

        if (!res.ok || !res.data) {
          setToast(res.error?.message ?? "출고 정보를 불러오지 못했습니다");
          setRequired([]);
          return;
        }

        const raw: any = res.data;
        const payload = raw.result ?? raw;

        if (!payload || !Array.isArray(payload.items)) {
          console.log("unexpected outbound payload:", raw);
          setToast("출고 정보를 불러오지 못했습니다");
          setRequired([]);
          return;
        }

        // 품목 매핑
        const mapped: RequiredItem[] = payload.items.map((it: any) => ({
          itemId: it.item_id,
          sku: it.sku,
          name: it.product_name,
          qty: it.qty,
          scannedQty: it.scanned_qty,
          status: it.status,
        }));
        setRequired(mapped);

        // 서버에 저장된 weight_g가 있으면 기본값으로 세팅
        if (typeof payload.weight_g === "number" && payload.weight_g > 0) {
          setWeight(payload.weight_g.toString());
        }
      } catch {
        setToast("출고 정보를 불러오는 중 오류가 발생했습니다");
        setRequired([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [invoiceFromUrl]);

  // Toast 자동 숨김
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1400);
    return () => clearTimeout(t);
  }, [toast]);

  const allMatched =
    required.length > 0 && required.every((r) => r.scannedQty >= r.qty);

  // ───────────────────────────────────────────
  // 스캔 처리
  // ───────────────────────────────────────────
  const handleScan = useCallback(
    async (scanned: string) => {
      if (!invoice) {
        setToast("송장번호가 없습니다");
        return;
      }

      const code = scanned.trim();
      if (!code) return;

      try {
        const res = await outboundAdapter.scanProcessItem({
          invoice_no: invoice,
          barcode: code,
        });

        if (!res.ok || !res.data) {
          setToast(res.error?.message ?? "스캔 처리에 실패했습니다");
          return;
        }

        const raw = res.data;
        const payload = raw.result ?? raw;
        const item = payload.item;

        setRequired((prev) => {
          const idx = prev.findIndex((r) => r.itemId === item.item_id);
          if (idx < 0) return prev;
          const arr = [...prev];
          arr[idx] = {
            ...arr[idx],
            scannedQty: item.scanned_qty,
            status: item.status,
          };
          return arr;
        });
      } catch {
        setToast("스캔 처리 중 오류가 발생했습니다");
      }
    },
    [invoice]
  );

  // ───────────────────────────────────────────
  // 오디오 언락
  // ───────────────────────────────────────────
  useEffect(() => {
    const unlockAudio = () => {
      if (!beepRef.current) {
        beepRef.current = new Audio("/beep.mp3");
      }

      beepRef.current
        .play()
        .then(() => {
          beepRef.current?.pause();
          if (beepRef.current) beepRef.current.currentTime = 0;
          setAudioReady(true);
        })
        .catch(() => {});

      window.removeEventListener("click", unlockAudio);
    };

    window.addEventListener("click", unlockAudio);
    return () => window.removeEventListener("click", unlockAudio);
  }, []);

  // ───────────────────────────────────────────
  // 카메라 + 바코드 모듈
  // ───────────────────────────────────────────
  useEffect(() => {
    if (!invoice) return;
    if (!videoRef.current) return;

    const codeReader = new BrowserMultiFormatReader();
    readerRef.current = codeReader;

    let active = true;

    const start = async () => {
      try {
        await codeReader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result) => {
            if (!active) return;
            if (!result) return;

            const rawText = result.getText();
            const scanned = (rawText ?? "").trim();
            if (!scanned) return;

            const now = Date.now();
            const lastCode = lastCodeRef.current;
            const lastAt = lastScanAtRef.current;
            const THROTTLE_MS = 700;

            if (scanned === lastCode && now - lastAt < THROTTLE_MS) return;

            lastCodeRef.current = scanned;
            lastScanAtRef.current = now;
            setLastBarcode(scanned);

            setFlash(true);
            setTimeout(() => setFlash(false), 200);

            if (audioReady && beepRef.current) {
              beepRef.current.currentTime = 0;
              void beepRef.current.play();
            }

            if (navigator.vibrate) navigator.vibrate(100);

            void handleScan(scanned);
          }
        );
      } catch {
        setToast("카메라를 열 수 없습니다");
      }
    };

    start();

    return () => {
      active = false;
      try {
        (readerRef.current as any)?.reset();
      } catch {}
    };
  }, [invoice, handleScan, audioReady]);

  // ───────────────────────────────────────────
  // 출고처리 (중량 g 저장 + 확정)
  // ───────────────────────────────────────────
  const handleConfirm = async () => {
    if (!invoice) {
      setToast("송장번호가 없습니다");
      return;
    }
    if (!allMatched) return;

    const weightNum = Number(weight);
    if (!Number.isFinite(weightNum) || weightNum <= 0) {
      setToast("유효한 출고 중량(g)을 입력하세요");
      return;
    }

    setConfirming(true);
    try {
      // 1) 중량 저장(g)
      const wRes = await outboundAdapter.setProcessWeight({
        invoice_no: invoice,
        weight_g: weightNum,
      });

      if (!wRes.ok || !wRes.data) {
        setToast(wRes.error?.message ?? "중량 저장에 실패했습니다");
        setConfirming(false);
        return;
      }

      // 2) 출고 확정
      const res = await outboundAdapter.confirmProcess({
        invoice_no: invoice,
      });

      if (!res.ok || !res.data) {
        setToast(res.error?.message ?? "출고처리에 실패했습니다");
        setConfirming(false);
        return;
      }

      setToast("출고처리가 완료되었습니다");
      setTimeout(() => nav("/outbound"), 600);
    } catch {
      setToast("출고처리 중 오류가 발생했습니다");
    } finally {
      setConfirming(false);
    }
  };

  // 버튼 활성 조건
  const weightNum = Number(weight);
  const weightValid =
    weight.trim() !== "" && Number.isFinite(weightNum) && weightNum > 0;
  const canConfirm = !!invoice && allMatched && weightValid && !confirming;

  // ───────────────────────────────────────────
  // UI
  // ───────────────────────────────────────────
  return (
    <AppShell title="출고처리">
      <div className="space-y-3">
        {/* 송장 */}
        <Card className="p-3 space-y-1">
          <div
            className="text-xs font-medium"
            style={{ color: COLORS.textGray }}
          >
            출고 송장
          </div>
          <div
            className="text-sm font-semibold"
            style={{ color: COLORS.main }}
          >
            {invoice || "미지정"}
          </div>
          {lastBarcode && (
            <div
              className="text-[11px]"
              style={{ color: COLORS.textGray }}
            >
              마지막 스캔값: {lastBarcode}
            </div>
          )}
        </Card>

        {/* 안내 */}
        <div className="sticky top-2 z-10 mx-auto max-w-sm">
          {loading ? (
            <div
              className="inline-flex items-center gap-2 bg-white/95 border rounded-xl px-3 py-2 shadow-sm"
              style={{ borderColor: COLORS.line }}
            >
              <div className="text-sm">
                출고 상품을 불러오는 중입니다...
              </div>
            </div>
          ) : required.find((r) => r.scannedQty < r.qty) ? (
            <div
              className="inline-flex items-center gap-2 bg-white/95 border rounded-xl px-3 py-2 shadow-sm"
              style={{ borderColor: COLORS.line }}
            >
              <div className="text-sm">
                카메라에 상품 바코드를 맞추면 자동 인식됩니다
              </div>
            </div>
          ) : (
            <div
              className="inline-flex items-center gap-2 bg-white/95 border rounded-xl px-3 py-2 shadow-sm"
              style={{ borderColor: COLORS.line }}
            >
              <div className="text-sm">모든 품목이 완료되었습니다</div>
            </div>
          )}
        </div>

        {/* 뷰파인더 */}
        <div className="relative w-full h-80 bg-black/70 rounded-2xl overflow-hidden">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            muted
            playsInline
          />
          <div className="absolute inset-3 pointer-events-none">
            {/* 4개 코너 라인 */}
            <div
              className={`absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 rounded-tl-lg ${
                flash ? "border-red-500" : "border-white/90"
              }`}
            />
            <div
              className={`absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 rounded-tr-lg ${
                flash ? "border-red-500" : "border-white/90"
              }`}
            />
            <div
              className={`absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 rounded-bl-lg ${
                flash ? "border-red-500" : "border-white/90"
              }`}
            />
            <div
              className={`absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 rounded-br-lg ${
                flash ? "border-red-500" : "border-white/90"
              }`}
            />
          </div>
        </div>

        {/* 출고 상품 목록 */}
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {required.map((r) => {
                const matched =
                  r.scannedQty >= r.qty && r.qty > 0;
                const color = matched
                  ? COLORS.success
                  : COLORS.warning;

                return (
                  <React.Fragment key={r.itemId}>
                    {/* 1행: 상품명 라벨 (가운데) */}
                    <tr
                      className="border-t"
                      style={{ borderColor: COLORS.line }}
                    >
                      <td className="py-1 px-3" />
                      <td
                        className="py-1 px-3 text-center text-[11px] font-medium"
                        style={{ color: COLORS.textGray }}
                      >
                        상품명
                      </td>
                      <td className="py-1 px-3" />
                    </tr>

                    {/* 2행: 실제 상품명 (가운데) */}
                    <tr
                      className="border-t"
                      style={{ borderColor: COLORS.line }}
                    >
                      <td className="py-1 px-3" />
                      <td className="py-1 px-3 text-center font-semibold">
                        {r.name}
                      </td>
                      <td className="py-1 px-3" />
                    </tr>

                    {/* 3행: 출고수량 / 스캔수량 / 일치여부 라벨 */}
                    <tr
                      className="border-t"
                      style={{ borderColor: COLORS.line }}
                    >
                      <td
                        className="py-1 px-3 text-center text-[11px]"
                        style={{ color: COLORS.textGray }}
                      >
                        출고수량
                      </td>
                      <td
                        className="py-1 px-3 text-center text-[11px]"
                        style={{ color: COLORS.textGray }}
                      >
                        스캔수량
                      </td>
                      <td
                        className="py-1 px-3 text-center text-[11px]"
                        style={{ color: COLORS.textGray }}
                      >
                        일치여부
                      </td>
                    </tr>

                    {/* 4행: 출고수량 / 스캔수량 / 일치여부 값 */}
                    <tr
                      className="border-t"
                      style={{ borderColor: COLORS.line }}
                    >
                      <td className="py-2 px-3 text-center font-semibold">
                        {r.qty}
                      </td>
                      <td className="py-2 px-3 text-center font-semibold">
                        {r.scannedQty}
                      </td>
                      <td
                        className="py-2 px-3 text-center font-semibold"
                        style={{ color }}
                      >
                        {matched ? "일치" : "미일치"}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}

              {required.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={3}
                    className="py-6 text-center text-xs"
                    style={{ color: "#94A3B8" }}
                  >
                    출고 상품 정보가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {/* 출고 중량 입력(g) */}
        <Card className="p-3 space-y-2">
          <div
            className="text-xs font-medium"
            style={{ color: COLORS.textGray }}
          >
            출고 중량(g)
          </div>
          <input
            type="number"
            min="0"
            step="1"
            className="w-full h-10 rounded-xl border px-3 text-sm"
            style={{ borderColor: COLORS.line }}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="예: 3250"
          />
          <div className="text-[11px]" style={{ color: COLORS.textGray }}>
            실측 중량을 g 단위로 입력해야 출고처리할 수 있습니다
          </div>
        </Card>

        {/* 출고처리 버튼 */}
        <button
          className="h-12 rounded-xl font-semibold text-white active:translate-y-[1px] w-full disabled:opacity-50"
          style={{ backgroundColor: COLORS.main }}
          onClick={handleConfirm}
          disabled={!canConfirm}
        >
          {confirming ? "출고처리 중..." : "출고처리"}
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-20 text-white text-sm px-4 py-2 rounded-xl shadow-lg"
          style={{ backgroundColor: "#0F172A" }}
        >
          {toast}
        </div>
      )}
    </AppShell>
  );
};

export default OutboundScanPage;
