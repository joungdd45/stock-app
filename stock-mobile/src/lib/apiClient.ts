/* C:\dev\stock-mobile\src\lib\apiClient.ts */

// 📦 src/lib/apiClient.ts
// 규칙: 운영에서는 VITE_API_BASE가 있으면 그걸 우선 사용, 없으면 Settings에서 저장한 serverUrl 사용
const ENV_BASE = (import.meta as any).env?.VITE_API_BASE as string | undefined

export function getBaseUrl(): string {
  const envBase = (ENV_BASE && ENV_BASE.trim()) || ""
  if (envBase) return envBase
  const saved = localStorage.getItem("serverUrl") || ""
  return saved
}

// ⚙️ 개발 편의용 목 응답 (서버가 꺼져있을 때만 사용)
// - 현재는 /health 만 지원. 필요하면 추후 확장.
function mockResponse(path: string) {
  if (path === "/health") {
    return {
      status: "ready",
      checks: { db: true, redis: true },
      timestamp: new Date().toISOString(),
      mock: true,
    }
  }
  throw new Error("목 응답 없음")
}

export async function apiGet(path: string, init?: RequestInit) {
  const baseUrl = getBaseUrl()

  // 서버주소가 비어있으면 /health만 목으로 허용
  if (!baseUrl) {
    if (path === "/health") return mockResponse(path)
    throw new Error("서버 주소가 설정되지 않았습니다.")
  }

  const url = `${baseUrl}${path}`

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      ...init,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`요청 실패: ${res.status} ${text}`)
    }

    return res.json()
  } catch (err) {
    // 서버가 꺼져있거나 네트워크 실패일 때 /health는 목으로 대체
    if (path === "/health") {
      return mockResponse(path)
    }
    // 그 외는 그대로 에러
    throw err
  }
}
