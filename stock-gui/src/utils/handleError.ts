// 📄 src/utils/handleError.ts
import { toast } from "react-hot-toast";
import type { ApiError } from "@/api/hub/apiHub";

export function handleError(err: ApiError) {
  toast.error(err?.message ?? "처리 중 오류가 발생했습니다.");
}
