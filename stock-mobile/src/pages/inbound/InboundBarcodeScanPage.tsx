/* C:\dev\stock-mobile\src\pages\inbound\InboundBarcodeScanPage.tsx */
/**
 * 입고 바코드 스캔 페이지 (zxing + 피드백 + 선택적 바코드 검증)
 *  - 리스트 JSON(payload) 전체를 파라미터로 전달받음
 *  - row.barcode 가 있는 경우에만 바코드 검증
 *  - 정상 스캔: 뷰파인더 빨간색 flash + 삡 소리 + 진동
 *  - 수량은 자동 +1 없음, 0부터 직접 입력
 *  - 바코드 정상 스캔 전에는 수량 입력/입고 버튼 비활성
 */

import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Camera } from "lucide-react";
import { AppShell, Card, COLORS } from "../../components/layout/AppShell";
import { inboundAdapter } from "../../api/adapters/inbound.adapter";
import { BrowserMultiFormatReader } from "@zxing/browser";

interface InboundPayload {
  header_id: number;
  item_id: number;
  order_no: string;
  order_date: string;
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  total_price: number;
  supplier_name: string;
  status: string; // draft | committed
  barcode?: string; // ✅ 선택값: 이 전표에 연결된 바코드 (없으면 검증 생략)
}

const InboundBarcodeScanPage: React.FC = () => {
  const nav = useNavigate();
  const { search } = useLocation();
  const sp = new URLSearchParams(search);

  // 리스트에서 넘어온 전체 row JSON
  const raw = sp.get("payload") ?? "";
  const row: InboundPayload | null = raw ? JSON.parse(raw) : null;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  // 수량: 문자열로 관리해서 ""(빈값) 허용
  const [qtyText, setQtyText] = useState<string>("");

  // ✅ 바코드 정상 스캔 여부
  const [scannedOk, setScannedOk] = useState(false);
  // ✅ 한 번 정상 인식 후 스캔 잠금
  const [locked, setLocked] = useState(false);

  // 스캔 피드백 상태
  const [flash, setFlash] = useState(false);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);

  // 토스트 상태
  const [toast, setToast] = useState<string | null>(null);

  // 오디오 관련
  const beepRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  // 🔔 토스트 헬퍼
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1200);
  };

  // 🔊 사용자 첫 터치에서 오디오 언락 (브라우저 자동재생 제한 우회)
  useEffect(() => {
    const unlockAudio = () => {
      if (!beepRef.current) {
        beepRef.current = new Audio("/beep.mp3"); // 📁 public/beep.mp3 필요
      }
      beepRef.current
        .play()
        .then(() => {
          beepRef.current?.pause();
          if (beepRef.current) beepRef.current.currentTime = 0;
          setAudioReady(true);
        })
        .catch((e) => {
          console.warn("오디오 언락 실패:", e);
        });

      window.removeEventListener("click", unlockAudio);
    };

    window.addEventListener("click", unlockAudio);
    return () => window.removeEventListener("click", unlockAudio);
  }, []);

  // 🔍 카메라 + 바코드 스캐너 세팅
  useEffect(() => {
    if (!row) return;
    if (!videoRef.current) return;
    if (locked) return; // ✅ 한 번 인식 후에는 더 이상 스캔 시작하지 않음

    const codeReader = new BrowserMultiFormatReader();
    readerRef.current = codeReader;
    let active = true;

    const start = async () => {
      try {
        await codeReader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result, err) => {
            if (!active) return;
            if (locked) return; // ✅ 잠금 상태에서는 콜백 즉시 무시
            if (!result) return;

            const rawText = result.getText();

            // 비교용 값 정리
            const scanned = String(rawText ?? "").trim();
            const expected = row.barcode;
            const expectedNorm = String(expected ?? "").trim();

            console.log("바코드 인식 raw:", rawText);
            console.log("바코드 expected:", row.barcode);
            console.log(
              "비교용 → scanned:",
              scanned,
              " / expectedNorm:",
              expectedNorm,
            );

            // 기준값이 있는 경우에만 검증 (없는 경우 검증 생략하고 그냥 통과)
            if (expectedNorm) {
              if (scanned !== expectedNorm) {
                setLastBarcode(scanned);
                showToast("해당 상품이 아닙니다.");
                return;
              }
            }

            // 같은 정상 바코드 연속 스캔은 무시 (잠금 전 단계용)
            if (scanned === lastBarcode) return;

            setLastBarcode(scanned);

            // ✅ 정상 스캔 피드백 (flash)
            setFlash(true);
            setTimeout(() => setFlash(false), 200);

            // ✅ 삡 소리 (언락된 경우에만)
            if (audioReady && beepRef.current) {
              beepRef.current.currentTime = 0;
              beepRef.current
                .play()
                .catch((e) => console.warn("beep 재생 실패:", e));
            }

            // ✅ 진동
            if (navigator.vibrate) navigator.vibrate(100);

            // ✅ 정상 스캔 완료 플래그 + 스캔 잠금
            setScannedOk(true);
            setLocked(true);
            active = false;
          }
        );
      } catch (e) {
        console.error("바코드 스캐너 시작 실패:", e);
      }
    };

    start();

    return () => {
      active = false;
      try {
        (readerRef.current as any)?.reset?.();
      } catch {
        // 무시
      }
      // 카메라 스트림 정리
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [row, audioReady, locked, lastBarcode]);

  if (!row) {
    return (
      <AppShell title="입고 바코드 스캔">
        <div
          className="p-4 text-center text-sm"
          style={{ color: COLORS.textGray }}
        >
          유효한 입고 데이터가 없습니다. 입고 목록에서 다시 진입해 주세요.
        </div>
      </AppShell>
    );
  }

  const {
    header_id,
    item_id,
    order_no,
    name,
    sku,
    qty: plannedQty,
    barcode,
  } = row;

  // 🔢 렌더링용 파생값: 문자열 수량 → 숫자
  const qtyNumber = Number(qtyText || "0");

  const handleInbound = async () => {
    // 이중 방어
    if (!scannedOk || !Number.isFinite(qtyNumber) || qtyNumber <= 0) {
      showToast("수량을 입력해 주세요.");
      return;
    }

    try {
      const res = await inboundAdapter.processConfirm({
        header_id,
        items: [
          {
            item_id,
            sku,
            qty: qtyNumber, // ✅ 숫자로 전송
          },
        ],
        operator: "MOBILE", // 추후 로그인 사용자로 교체
      });

      if (!res.ok) {
        console.error("입고 처리 실패:", res.error);
        showToast("입고 처리 중 오류가 발생했습니다.");
        return;
      }

      nav("/inbound");
    } catch (err) {
      console.error("입고 처리 예외:", err);
      showToast("입고 처리 중 예외가 발생했습니다.");
    }
  };

  return (
    <AppShell title="입고 바코드 스캔">
      {/* 🧀 토스트 */}
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-white text-sm shadow-md"
          style={{ backgroundColor: "#e53935" }}
        >
          {toast}
        </div>
      )}

      <div className="space-y-3">
        {/* 대상 상품 정보 */}
        <Card className="p-3 space-y-1">
          <div
            className="text-xs font-medium"
            style={{ color: COLORS.textGray }}
          >
            대상 상품
          </div>
          <div
            className="text-sm font-semibold"
            style={{ color: COLORS.main }}
          >
            {name}
          </div>
          <div className="text-[11px]" style={{ color: COLORS.textGray }}>
            전표번호: {order_no}
          </div>
          <div className="text-[10px]" style={{ color: COLORS.textGray }}>
            SKU: {sku}
          </div>
          {barcode && (
            <div className="text-[10px]" style={{ color: COLORS.textGray }}>
              바코드(전표 기준): {barcode}
            </div>
          )}
          {lastBarcode && (
            <div className="text-[10px]" style={{ color: COLORS.textGray }}>
              마지막 스캔값: {lastBarcode}
            </div>
          )}
        </Card>

        {/* 뷰파인더 + 카메라 영상 */}
        <div className="relative w-full h-80 rounded-2xl overflow-hidden bg-black/70">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            muted
            playsInline
          />

          {/* 모서리 뷰파인더 (스캔 시 빨간색 flash) */}
          <div className="absolute inset-3 pointer-events-none">
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

          <div className="absolute inset-x-0 bottom-2 flex flex-col items-center gap-1 text-white text-[10px]">
            <Camera size={16} />
            <span>화면을 한 번 터치하면 스캔 음이 활성화됩니다</span>
            <span>카메라에 바코드를 맞추면 자동으로 인식됩니다</span>
          </div>
        </div>

        {/* 입고 예정 수량 + 실제 입력 수량 + 입고 처리 */}
        <Card className="p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span
              className="text-sm font-semibold"
              style={{ color: COLORS.main }}
            >
              입고 예정 수량
            </span>

            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <span
                  className="text-sm font-semibold"
                  style={{ color: COLORS.main }}
                >
                  {plannedQty}
                </span>
                <span className="text-sm" style={{ color: COLORS.textGray }}>
                  → 실제
                </span>
                <input
                  type="number"
                  min={0}
                  className="w-24 h-10 text-center rounded-xl border-2 outline-none text-sm disabled:bg-gray-100"
                  style={{ borderColor: COLORS.line }}
                  value={qtyText}
                  disabled={!scannedOk}
                  onChange={(e) => setQtyText(e.target.value)}
                />
              </div>
              {!scannedOk && (
                <span
                  className="text-[10px]"
                  style={{ color: COLORS.textGray }}
                >
                  바코드를 먼저 스캔하면 수량 입력이 가능합니다.
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="h-11 w-full rounded-xl font-semibold text-white active:translate-y-[1px] disabled:opacity-50"
            style={{ backgroundColor: COLORS.main }}
            onClick={handleInbound}
            disabled={!scannedOk || !Number.isFinite(qtyNumber) || qtyNumber <= 0}
          >
            입고 처리
          </button>
        </Card>
      </div>
    </AppShell>
  );
};

export default InboundBarcodeScanPage;
