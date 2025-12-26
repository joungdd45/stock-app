// src/lib/beep.ts
// public/beep.mp3를 전역으로 1회 "실재생" 언락해서 모든 스캔 페이지에서 재사용
// ✅ A 케이스(시작하기 눌러도 스캔 때 소리 안남 → 화면을 눌러야 소리남) 대응:
// - unlockBeep에서 muted/volume0 대신 "아주 작은 실제 재생"을 1회 수행
// - playBeep에서 실패 시 ready=false로 돌려 다음 호출에서 재-언락 유도

export const beepStore = {
    audio: null as HTMLAudioElement | null,
    ready: false,
    unlocking: false,
  };
  
  const BEEP_SRC = "/beep.mp3";
  
  // 언락용: 거의 안 들릴 정도의 초저볼륨 (기기 정책상 '실재생'으로 인정받기 위함)
  const UNLOCK_VOL = 0.05;
  
  function getAudio() {
    if (!beepStore.audio) {
      const a = new Audio(BEEP_SRC);
      a.preload = "auto";
      (a as any).playsInline = true;
      beepStore.audio = a;
    }
    return beepStore.audio!;
  }
  
  /**
   * ✅ 사용자 제스처(버튼 클릭) 안에서 호출해야 함
   * - 일부 WebView는 muted/volume0 재생을 "언락"으로 인정하지 않음
   * - 그래서 '아주 작은 볼륨으로 1번 실제 재생' 후 즉시 stop 처리
   */
  export async function unlockBeep(): Promise<boolean> {
    if (beepStore.unlocking) return beepStore.ready;
    beepStore.unlocking = true;
  
    try {
      const a = getAudio();
  
      const prevVol = a.volume;
      const prevMuted = a.muted;
  
      a.muted = false;
      a.volume = UNLOCK_VOL;
      a.currentTime = 0;
  
      await a.play(); // ✅ 실재생
      a.pause();
      a.currentTime = 0;
  
      a.volume = prevVol;
      a.muted = prevMuted;
  
      beepStore.ready = true;
      return true;
    } catch {
      beepStore.ready = false;
      return false;
    } finally {
      beepStore.unlocking = false;
    }
  }
  
  /**
   * 실제 비프 재생
   * - ready가 풀렸거나(세션 잠김) audio.play가 막히면 ready=false로 돌려 재-언락 유도
   */
  export async function playBeep(): Promise<boolean> {
    try {
      const a = getAudio();
  
      // ✅ 세션이 다시 잠겼으면 여기서 재-언락 시도
      if (!beepStore.ready) {
        const ok = await unlockBeep();
        if (!ok) return false;
      }
  
      a.currentTime = 0;
      await a.play();
      return true;
    } catch {
      beepStore.ready = false;
      return false;
    }
  }
  