// 📄 src/utils/handleError.ts
// 역할:
//  - 페이지/컴포넌트에서 에러를 "한 곳"으로 보내기 위한 래퍼
// 원칙:
//  - UI(토스트/alert) 직접 출력 금지
//  - 실제 출력/메시지 매핑은 apiHub(handleError + front_error_codes)가 담당

import type { ApiError } from "@/api/hub/apiHub";
import { handleError as hubHandleError } from "@/api/hub/apiHub";

export function handleError(err: ApiError | unknown) {
  // apiHub.handleError는 내부에서 최종 메시지 정리 + 전역 토스트 호출까지 담당
  // 여기서는 그냥 위임만 한다.
  hubHandleError(err as any);
}
