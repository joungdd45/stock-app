// src/components/PermissionGate.tsx
import React, { useMemo, useState } from "react";
import { unlockBeep, playBeep } from "../lib/beep";

const READY_KEY = "app.permissions.ready.v1";

async function warmupCamera(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

type Props = { children: React.ReactNode };

const PermissionGate: React.FC<Props> = ({ children }) => {
  const initialReady = useMemo(() => localStorage.getItem(READY_KEY) === "1", []);
  const [ready, setReady] = useState(initialReady);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const handleStart = async () => {
    if (busy) return;
    setBusy(true);
    setMsg("");

    // 1) 비프 언락 (✅ 사용자 제스처 안에서 "실재생" 언락)
    const beepOk = await unlockBeep();
    if (!beepOk) {
      setMsg("비프음을 활성화하지 못했습니다. 다시 눌러주세요.");
      setBusy(false);
      return;
    }

    // ✅ (핵심) 언락 직후 테스트 삡 1회
    // - 일부 WebView는 '언락만'으로는 부족하고, 실제 재생이 1번 있어야 이후 스캔에서도 바로 재생됨
    const testOk = await playBeep();
    if (!testOk) {
      setMsg("비프음 재생이 차단되어 있습니다. 한 번 더 눌러주세요.");
      setBusy(false);
      return;
    }

    // 2) 카메라 권한 워밍업
    const camOk = await warmupCamera();
    if (!camOk) {
      setMsg("카메라 권한이 필요합니다. 권한을 허용하고 다시 눌러주세요.");
      setBusy(false);
      return;
    }

    localStorage.setItem(READY_KEY, "1");
    setReady(true);
    setBusy(false);
  };

  if (ready) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-black text-white">
      <div className="w-full max-w-sm rounded-2xl p-5 bg-white/10 border border-white/10">
        <div className="text-lg font-semibold">스캔 준비</div>
        <div className="mt-2 text-sm text-white/80">
          최초 1회만 비프음과 카메라 권한을 설정합니다.
        </div>

        {msg && <div className="mt-3 text-sm text-red-300">{msg}</div>}

        <button
          className="mt-5 h-11 w-full rounded-xl font-semibold bg-white text-black disabled:opacity-60"
          onClick={handleStart}
          disabled={busy}
        >
          {busy ? "설정 중..." : "시작하기"}
        </button>

        <div className="mt-3 text-[11px] text-white/60">
          비프음이 안 들리면 기기 볼륨/무음모드를 확인해 주세요.
        </div>
      </div>
    </div>
  );
};

export default PermissionGate;
