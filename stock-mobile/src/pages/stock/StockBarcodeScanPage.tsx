/* C:\dev\stock-mobile\src\pages\stock\StockBarcodeScanPage.tsx */
/**
 * 재고 바코드 스캔 페이지 (zxing + 피드백 + 1회 스캔 멈춤)
 */

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera } from "lucide-react";
import { AppShell, Card, COLORS } from "../../components/layout/AppShell";
import { BrowserMultiFormatReader } from "@zxing/browser";

interface StockRow {
  name: string;
  stock: number;
  free: number;
}

const STORAGE_KEY = "stock.scan.result";

const StockBarcodeScanPage: React.FC = () => {
  const nav = useNavigate();

  const [submitting, setSubmitting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  const [flash, setFlash] = useState(false);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);

  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false); // 🔥 1회 스캔 여부

  const [toast, setToast] = useState<string | null>(null);

  const beepRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1200);
  };

  // 🔊 오디오 언락
  useEffect(() => {
    const unlockAudio = () => {
      if (!beepRef.current) beepRef.current = new Audio("/beep.mp3");

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

  // 🔍 카메라 + 스캔(1회 인식 후 멈춤)
  useEffect(() => {
    if (!videoRef.current) return;

    const codeReader = new BrowserMultiFormatReader();
    readerRef.current = codeReader;

    let active = true;
    let stream: MediaStream | null = null;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });

        videoRef.current!.srcObject = stream;

        await codeReader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result, err) => {
            if (!active) return;
            if (scanned) return; // 🔥 이미 스캔 완료 → 무시

            if (!result) return;

            const rawText = result.getText();
            const scannedText = String(rawText ?? "").trim();

            // 🔥 중복 스캔 방지
            if (lastBarcode === scannedText) return;

            // 정상 인식
            setLastBarcode(scannedText);
            setScannedBarcode(scannedText);
            setScanned(true); // 🔥 1회 스캔 완료 플래그

            // flash
            setFlash(true);
            setTimeout(() => setFlash(false), 200);

            // 삡 소리
            if (audioReady && beepRef.current) {
              beepRef.current.currentTime = 0;
              beepRef.current.play().catch(() => {});
            }

            // 진동
            if (navigator.vibrate) navigator.vibrate(100);

            showToast("바코드 인식 완료");

            // 🔥 카메라 완전 정지
            if (stream) {
              stream.getTracks().forEach((t) => t.stop());
            }

            try {
              (readerRef.current as any)?.reset();
            } catch {}
          }
        );
      } catch (e) {
        console.error("스캐너 오류:", e);
      }
    };

    start();

    return () => {
      active = false;
      try {
        (readerRef.current as any)?.reset();
      } catch {}
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [lastBarcode, audioReady, scanned]);

  // 재고 조회
  const handleCheckStock = () => {
    if (submitting) return;
    if (!scannedBarcode) {
      showToast("먼저 바코드를 스캔해 주세요.");
      return;
    }

    setSubmitting(true);

    // TODO: 나중에 stockAdapter.status 연결
    const dummy: StockRow = {
      name: `스캔: ${scannedBarcode}`,
      stock: 10,
      free: 8,
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dummy));
    nav("/stock/status");
  };

  return (
    <AppShell title="재고 바코드 스캔">
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-white text-sm shadow-md"
          style={{ backgroundColor: "#e53935" }}
        >
          {toast}
        </div>
      )}

      <div className="space-y-3">
        {/* 안내 카드 */}
        <Card className="p-3 space-y-1">
          <div className="text-xs font-medium" style={{ color: COLORS.textGray }}>
            바코드 스캔
          </div>
          <div className="text-xs" style={{ color: COLORS.textGray }}>
            카메라에 바코드를 맞추면 자동으로 인식되며,
            1회 스캔 후 카메라가 자동으로 멈춥니다.
          </div>

          {lastBarcode && (
            <div className="text-[10px]" style={{ color: COLORS.textGray }}>
              마지막 스캔값: {lastBarcode}
            </div>
          )}
        </Card>

        {/* 카메라 뷰 */}
        <div className="relative w-full h-80 bg-black/70 rounded-2xl overflow-hidden">
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

          {/* 중앙 가이드 */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-7 w-20 border-t-2 border-b-2 border-white/75" />

          <div className="absolute inset-x-0 bottom-2 flex flex-col items-center gap-1 text-white text-[10px]">
            <Camera size={16} />
            <span>화면을 한 번 터치하면 스캔 음이 활성화됩니다</span>
          </div>
        </div>

        {/* 버튼들 */}
        <Card className="p-3 space-y-3">
          <button
            type="button"
            className="h-11 w-full rounded-xl font-semibold text-white active:translate-y-[1px] disabled:opacity-50"
            style={{ backgroundColor: COLORS.main }}
            onClick={handleCheckStock}
            disabled={!scannedBarcode || submitting}
          >
            재고 조회
          </button>

          <button
            type="button"
            className="h-10 w-full rounded-xl text-xs border active:translate-y-[1px]"
            style={{ borderColor: COLORS.line, color: COLORS.textGray }}
            onClick={() => nav("/stock/status")}
          >
            재고현황으로 돌아가기
          </button>
        </Card>
      </div>
    </AppShell>
  );
};

export default StockBarcodeScanPage;
