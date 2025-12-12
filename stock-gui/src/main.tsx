// 📄 src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./index.css";

// =============================
// 전역 에러 바운더리
// =============================
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { error };
  }

  componentDidCatch(error: any, info: any) {
    console.error("[RootErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      const message =
        this.state.error?.message || "알 수 없는 전역 렌더 오류가 발생했습니다.";
      const stack = this.state.error?.stack || "";

      return (
        <div style={{ padding: 16, fontFamily: "system-ui, sans-serif", background: "#f9f9f9" }}>
          <h1 style={{ color: "#c00", fontSize: 18, marginBottom: 8 }}>
            😵 전역 렌더 오류
          </h1>
          <p style={{ color: "#444" }}>
            아래 메시지를 복사해 보내주면 원인 파일과 라인을 바로 잡아줄게.
          </p>
          <pre
            style={{
              marginTop: 12,
              whiteSpace: "pre-wrap",
              background: "#fff",
              border: "1px solid #ddd",
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.4,
              color: "#222",
            }}
          >
            {message + "\n\n" + stack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

// =============================
// 앱 부트스트랩
// =============================
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      {/* ✅ 전역 토스트는 main에만 1개 */}
      <Toaster
        position="top-center"
        toastOptions={{ duration: 3000 }}
      />

      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>
);
