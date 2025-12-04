/* C:\dev\stock-mobile\src\main.tsx */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("root 엘리먼트를 찾을 수 없습니다. index.html에 <div id=\"root\"></div>가 있어야 합니다.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
