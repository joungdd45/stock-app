/* C:\dev\stock-mobile\src\pages\outbound\OutboundInvoiceScanPage.tsx */
/**
 * 출고관리 > 송장 스캔 전용 페이지 (실사용 버전)
 *  - 카메라로 송장 바코드 자동 인식
 *  - 스캔 / 수동 입력값으로
 *      GET /api/outbound/process/invoice?invoice=... 조회
 *      → status 기준으로 필터링 후 상품 스캔 페이지로 이동
 *  - 더미 송장 없음
 */

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera } from "lucide-react";
import {
  AppShell,
  Card,
  TextInput,
  COLORS,
} from "../../components/layout/AppShell";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { outboundAdapter } from "../../api/adapters/outbound.adapter";

const OutboundInvoiceScanPage: React.FC = () => {
  const nav = useNavigate();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  const beepRef = useRef<HTMLAudioElement | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  const [invoice, setInvoice] = useState("");
  const [toast, setToast] = useState("");
  const [flash, setFlash] = useState(false);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // 토스트 자동 숨김
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1200);
    return () => clearTimeout(t);
  }, [toast]);

  // 🔊 첫 터치에서 오디오 언락
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

  /** ✅ 송장 검증 + 상태값 필터링 + 페이지 이동 */
  const validateAndGo = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setToast("송장번호를 입력 또는 스캔하세요");
      return;
    }

    if (checking) return;
    setChecking(true);
    try {
      const res = await outboundAdapter.fetchProcessInvoice(trimmed);
      console.log("fetchProcessInvoice 결과:", res);

      // 기본 에러 처리
      if (!res.ok || !res.data) {
        setToast(res.error?.message ?? "등록되지 않은 송장입니다");
        return;
      }

      const status = (res.data as any).status as string | undefined;

      if (!status) {
        setToast("송장 상태를 확인할 수 없습니다");
        return;
      }

      // 상태별 필터링
      if (status === "canceled") {
        setToast("취소된 송장입니다");
        return;
      }

      if (status === "completed") {
        setToast("이미 출고 완료된 송장입니다");
        return;
      }

      if (status === "draft" || status === "picking") {
        // 출고 작업 가능한 상태만 상품 스캔 페이지로 이동
        nav(`/outbound/scan-items?invoice=${encodeURIComponent(trimmed)}`);
        return;
      }

      // 예상 밖 상태에 대한 안전장치
      setToast(`처리할 수 없는 송장 상태: ${status}`);
    } catch (e) {
      console.error("송장 검증 중 오류:", e);
      setToast("송장 정보를 조회하지 못했습니다");
    } finally {
      setChecking(false);
    }
  };

  // 🔍 카메라 + 바코드 스캐너 세팅 (실사용)
  useEffect(() => {
    if (!videoRef.current) return;

    const codeReader = new BrowserMultiFormatReader();
    readerRef.current = codeReader;
    let active = true;
    let last = ""; // 로컬 기준으로 중복 스캔 방지

    const start = async () => {
      try {
        await codeReader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result) => {
            if (!active) return;
            if (!result) return;

            const rawText = result.getText();
            const scanned = String(rawText ?? "").trim();
            if (!scanned) return;

            console.log("송장 바코드 인식:", scanned);

            if (scanned === last) return;
            last = scanned;

            setLastBarcode(scanned);
            setInvoice(scanned);

            setFlash(true);
            setTimeout(() => setFlash(false), 200);

            if (audioReady && beepRef.current) {
              beepRef.current.currentTime = 0;
              beepRef.current
                .play()
                .catch((e) => console.warn("beep 재생 실패:", e));
            }

            if (navigator.vibrate) navigator.vibrate(100);

            void validateAndGo(scanned);
          }
        );
      } catch (e) {
        console.error("송장 바코드 스캐너 시작 실패:", e);
        setToast("카메라를 열 수 없습니다");
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
  }, [audioReady]);

  /** 뷰파인더 탭 → 현재 입력된 값으로만 검증 */
  const handleScanTap = () => {
    if (!invoice.trim()) {
      setToast("송장번호가 입력되어 있지 않습니다");
      return;
    }
    void validateAndGo(invoice);
  };

  /** 수동 입력 확인 버튼 */
  const handleManualConfirm = () => {
    void validateAndGo(invoice);
  };

  return (
    <AppShell title="송장 스캔">
      <div className="space-y-3">
        {/* 뷰파인더 + 카메라 영상 */}
        <div
          className="relative w-full h-80 rounded-2xl overflow-hidden bg-black/70"
          onClick={handleScanTap}
        >
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            muted
            playsInline
          />
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
        </div>

        {/* 입력 + 버튼 */}
        <Card className="p-0 overflow-hidden">
          <div
            className="p-3 border-b"
            style={{ borderColor: COLORS.line }}
          >
            <div className="flex items-center gap-2">
              <Camera size={18} color={COLORS.main} />
              <div className="text-base font-semibold">송장 스캔</div>
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="flex gap-2">
              <TextInput
                placeholder="수동으로 송장번호 입력"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
              />
              <button
                className="h-11 px-4 rounded-xl font-semibold text-white whitespace-nowrap active:translate-y-[1px] disabled:opacity-50"
                style={{ backgroundColor: COLORS.main }}
                onClick={handleManualConfirm}
                disabled={checking}
              >
                {checking ? "확인중..." : "확인"}
              </button>
            </div>
            {lastBarcode && (
              <div
                className="mt-2 text-[11px]"
                style={{ color: COLORS.textGray }}
              >
                마지막 스캔값: {lastBarcode}
              </div>
            )}
          </div>
        </Card>

        {toast && (
          <div
            className="fixed left-1/2 -translate-x-1/2 bottom-20 text-white text-sm px-4 py-2 rounded-xl shadow-lg"
            style={{ backgroundColor: "#0F172A" }}
          >
            {toast}
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default OutboundInvoiceScanPage;
