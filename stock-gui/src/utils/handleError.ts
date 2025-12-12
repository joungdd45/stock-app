// 📄 src/utils/handleError.ts
import { toast } from "react-hot-toast";
import type { ApiError } from "@/api/hub/apiHub";
import { getFrontErrorMessage } from "@/api/hub/front_error_codes";

const FALLBACK_MESSAGE =
  "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

export function handleError(err?: ApiError | null) {
  if (!err) {
    toast.error(FALLBACK_MESSAGE);
    return;
  }

  // ✅ code 기준으로 항상 프론트 메시지 재매핑
  const message = err.code
    ? getFrontErrorMessage(err.code)
    : FALLBACK_MESSAGE;

  toast.error(message);
}
