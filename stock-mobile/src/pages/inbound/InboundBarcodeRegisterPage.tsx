/* C:\dev\stock-mobile\src\pages\inbound\InboundBarcodeRegisterPage.tsx */
/**
 * 입고 바코드 등록 페이지
 *  - 바코드가 없는 전표 선택 시 진입
 *  - 진입 시: "바코드가 없습니다. 등록해주세요." 토스트 표시
 *  - 바코드 스캔 전: 하단 텍스트 회색, 버튼 비활성
 *  - 바코드 스캔 후: "바코드 등록 준비 완료"를 검은색 볼드로 표시, 버튼 활성
 *  - 등록 버튼: { barcode, sku, name } 바디로 API 호출
 */

import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Camera } from "lucide-react";
import { AppShell, Card, COLORS } from "../../components/layout/AppShell";
import { inboundAdapter } from "../../api/adapters/inbound.adapter";
import { BrowserMultiFormatReader } from "@zxing/browser";

interface InboundPayloadForRegister {
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
  // barcode 없음(등록 대상)
}

const InboundBarcodeRegisterPage: React.FC = () => {
  const nav = useNavigate();
  const { search } = useLocation();
  const sp = new URLSearchParams(search);

  const raw = sp.get("payload") ?? "";
  const row: InboundPayloadForRegister | null = raw ? JSON.parse(raw) : null;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  // 스캔된 바코드
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);

  // 스캔 피드백
  const [flash, setFlash] = useState(false);

  // 토스트 상태
  const [toast, setToast] = useState<string | null>(null);

  // 오디오
  const beepRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  // 🔔 토스트 헬퍼
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1200);
  };

  // 진입 시 안내 토스트
  useEffect(() => {
    showToast("바코드가 없습니다. 등록해주세요.");
  }, []);

  // 🔊 사용자 첫 터치에서 오디오 언락
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
        .catch((e) => {
          console.warn("오디오 언락 실패:", e);
        });

      window.removeEventListener("click", unlockAudio);
    };

    window.addEventListener("click", unlockAudio);
    return () => window.removeEventListener("click", unlockAudio);
  }, []);

  // 🔍 카메라 + 바코드 스캐너 세팅 (검증 없이 첫 스캔값만 사용)
  useEffect(() => {
    if (!row) return;
    if (!videoRef.current) return;

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
            if (!result) return;

            const rawText = result.getText();
            const scanned = String(rawText ?? "").trim();
            if (!scanned) return;

            // 같은 값 재스캔이면 그냥 무시
            if (scanned === scannedBarcode) return;

            setScannedBarcode(scanned);

            // flash
            setFlash(true);
            setTimeout(() => setFlash(false), 200);

            // 삡 소리
            if (audioReady && beepRef.current) {
              beepRef.current.currentTime = 0;
              beepRef.current
                .play()
                .catch((e) => console.warn("beep 재생 실패:", e));
            }

            // 진동
            if (navigator.vibrate) navigator.vibrate(100);
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
        (readerRef.current as any)?.reset();
      } catch {
        // 무시
      }
    };
  }, [row, scannedBarcode, audioReady]);

  if (!row) {
    return (
      <AppShell title="바코드 등록">
        <div
          className="p-4 text-center text-sm"
          style={{ color: COLORS.textGray }}
        >
          유효한 입고 데이터가 없습니다. 입고 목록에서 다시 진입해 주세요.
        </div>
      </AppShell>
    );
  }

  const { order_no, name, sku } = row;

  // 🔘 바코드 등록 처리
  const handleRegisterBarcode = async () => {
    if (!scannedBarcode) return;

    try {
      // TODO: inboundAdapter 안에 실제 구현 필요
      const res = await inboundAdapter.registerBarcode({
        barcode: scannedBarcode,
        sku,
        name,
      });

      if (!res.ok) {
        console.error("바코드 등록 실패:", res.error);
        showToast("바코드 등록 중 오류가 발생했습니다.");
        return;
      }

      showToast("바코드가 등록되었습니다.");
      // 등록 후 입고 리스트로 복귀 (필요 시 경로 조정)
      setTimeout(() => {
        nav("/inbound");
      }, 800);
    } catch (err) {
      console.error("바코드 등록 예외:", err);
      showToast("바코드 등록 중 예외가 발생했습니다.");
    }
  };

  const ready = !!scannedBarcode;

  return (
    <AppShell title="바코드 등록">
      {/* 토스트 */}
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
            바코드 등록 대상
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
          {scannedBarcode && (
            <div className="text-[10px]" style={{ color: COLORS.textGray }}>
              스캔된 바코드: {scannedBarcode}
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

          {/* 모서리 뷰파인더 */}
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

        {/* 하단 안내 + 등록 버튼 */}
        <Card className="p-3 space-y-4">
          <div className="text-center text-sm leading-5">
            <div style={{ color: COLORS.textGray }}>바코드 등록</div>
            <div
              className={`mt-1 ${
                ready ? "font-bold" : ""
              } text-sm`}
              style={{ color: ready ? "#000000" : COLORS.textGray }}
            >
              바코드 등록 준비 완료
            </div>
          </div>

          <button
            type="button"
            className="h-11 w-full rounded-xl font-semibold text-white active:translate-y-[1px] disabled:opacity-50"
            style={{ backgroundColor: COLORS.main }}
            onClick={handleRegisterBarcode}
            disabled={!ready}
          >
            바코드 등록
          </button>
        </Card>
      </div>
    </AppShell>
  );
};

export default InboundBarcodeRegisterPage;
