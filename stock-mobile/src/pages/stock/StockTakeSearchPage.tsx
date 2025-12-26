/* C:\dev\stock-mobile\src\pages\stock\StockTakeSearchPage.tsx */
/**
 * 재고실사 > 상품선택 페이지 (서버 검색 버전)
 * - /stock/take/search?barcode=...
 * - 검색: /api/products/register/search?q=...&page=1&size=50&active_only=true
 * - 상품 터치 → 바코드 등록(/api/inbound/process/register-barcode)
 * - 완료 후 /stock/take/scan?barcode=... 복귀
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppShell, Card, COLORS } from "../../components/layout/AppShell";
import { stockAdapter } from "../../api/adapters/stock.adapter";
import { productsAdapter, type ProductListItem } from "../../api/adapters/products.adapter";
import { handleError } from "../../utils/handleError";

type AnyProduct = ProductListItem & {
  is_active?: boolean; // 서버 응답 호환(있어도 되고 없어도 됨)
};

type Row = AnyProduct & { id: string };

const DEFAULT_SIZE = 50;

const StockTakeSearchPage: React.FC = () => {
  const nav = useNavigate();
  const { search } = useLocation();
  const sp = useMemo(() => new URLSearchParams(search), [search]);

  const barcode = (sp.get("barcode") ?? "").trim();

  const [keyword, setKeyword] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState<number>(0);

  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  // ✅ 검색어 변경 중 “이전 요청” 결과가 뒤늦게 도착해 덮어쓰는 것 방지
  const reqSeqRef = useRef(0);
  const lastQueryRef = useRef<string>("");

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1200);
  };

  const extractItems = (data: any): any[] => {
    if (!data) return [];
    return (
      data?.items ??
      data?.result?.items ??
      data?.data?.result?.items ??
      data?.data?.items ??
      []
    );
  };

  const extractCount = (data: any): number => {
    if (!data) return 0;
    const c =
      data?.count ??
      data?.result?.count ??
      data?.data?.result?.count ??
      data?.data?.count ??
      0;
    return Number(c || 0);
  };

  const isActive = (x: Row) => {
    const s = (x as any).status;
    const a = (x as any).is_active;
    if (typeof s === "boolean") return s;
    if (typeof a === "boolean") return a;
    return true;
  };

  const canMore = rows.length < count;

  const runSearch = async (opts: { q: string; nextPage: number; append: boolean }) => {
    const q = String(opts.q ?? "").trim();

    // ✅ q 없으면 호출 자체를 안 함 (422 방지)
    if (!q) {
      setRows([]);
      setCount(0);
      setPage(1);
      lastQueryRef.current = "";
      return;
    }

    // ✅ 요청 시퀀스
    const mySeq = ++reqSeqRef.current;
    lastQueryRef.current = q;

    setLoading(true);
    try {
      // ✅ 올바른 시그니처: 객체로 전달 → 쿼리 q가 반드시 붙음
      const res = await productsAdapter.searchItems({
        q,
        page: opts.nextPage,
        size: DEFAULT_SIZE,
        active_only: true,
      });

      if (!aliveRef.current) return;
      if (mySeq !== reqSeqRef.current) return; // 더 최신 요청이 있으면 무시

      if (!res.ok) {
        handleError(res.error);

        // 첫 페이지 실패면 비우기
        if (!opts.append) {
          setRows([]);
          setCount(0);
          setPage(1);
        }
        return;
      }

      const raw: any = res.data as any;
      const items = extractItems(raw);
      const total = extractCount(raw);

      const mapped: Row[] = (items ?? [])
        .map((x: any, idx: number) => ({
          ...(x as AnyProduct),
          id: `${String(x?.sku ?? "")}-${opts.nextPage}-${idx}`,
        }))
        .filter((x) => !!String(x.sku ?? "").trim() && !!String(x.name ?? "").trim())
        .filter((x) => isActive(x));

      setCount(total);

      if (opts.append) {
        setRows((prev) => {
          // ✅ 혹시 중복 sku가 섞이면 제거(안전)
          const next = [...prev, ...mapped];
          const seen = new Set<string>();
          return next.filter((r) => {
            const key = String(r.sku);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        });
        setPage(opts.nextPage);
      } else {
        setRows(mapped);
        setPage(opts.nextPage);
      }
    } catch (e) {
      if (!aliveRef.current) return;
      if (mySeq !== reqSeqRef.current) return;
      handleError(e);

      if (!opts.append) {
        setRows([]);
        setCount(0);
        setPage(1);
      }
    } finally {
      if (!aliveRef.current) return;
      if (mySeq !== reqSeqRef.current) return;
      setLoading(false);
    }
  };

  // 최초 진입 안내
  useEffect(() => {
    aliveRef.current = true;

    if (!barcode) showToast("바코드 정보가 없습니다.");

    return () => {
      aliveRef.current = false;
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keyword 디바운스 검색 (300ms)
  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    debounceRef.current = window.setTimeout(() => {
      void runSearch({ q: keyword, nextPage: 1, append: false });
    }, 300);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const onPick = async (row: Row) => {
    if (!barcode) {
      showToast("바코드 정보가 없습니다.");
      return;
    }

    try {
      const res = await stockAdapter.registerBarcodeForSku({
        barcode,
        sku: String(row.sku),
        name: String(row.name),
      });

      if (!res.ok) {
        handleError(res.error);
        showToast("바코드 등록에 실패했습니다.");
        return;
      }

      showToast("바코드 등록 완료");
      nav(`/stock/take/scan?barcode=${encodeURIComponent(barcode)}`);
    } catch (e) {
      handleError(e);
      showToast("바코드 등록 중 오류가 발생했습니다.");
    }
  };

  return (
    <AppShell title="재고실사 상품선택">
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-white text-sm shadow-md"
          style={{ backgroundColor: "#e53935" }}
        >
          {toast}
        </div>
      )}

      <div className="space-y-3">
        <Card className="p-3">
          <div className="text-sm font-semibold mb-2" style={{ color: COLORS.main }}>
            상품 검색
          </div>

          <div className="text-[11px] mb-2" style={{ color: COLORS.textGray }}>
            바코드:{" "}
            <span style={{ color: COLORS.main, fontWeight: 700 }}>
              {barcode || "-"}
            </span>
          </div>

          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="상품명 또는 SKU 입력 (예: 올리브영)"
            className="w-full h-11 rounded-xl border-2 px-3 text-sm outline-none"
            style={{ borderColor: COLORS.line }}
          />

          <div className="mt-2 text-[10px]" style={{ color: COLORS.textGray }}>
            {keyword.trim()
              ? `검색결과: ${rows.length} / 전체 ${count}`
              : "검색어를 입력하면 결과가 표시됩니다."}
          </div>
        </Card>

        <Card className="p-3 pb-0">
          <div className="text-[11px] text-slate-500 mb-2">
            상품을 터치하면 해당 SKU에 바코드가 매핑됩니다.
          </div>

          <div className="mt-2 px-1 pb-3">
            <div className="rounded-xl border bg-white" style={{ borderColor: COLORS.line }}>
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50" style={{ color: COLORS.textGray }}>
                  <tr>
                    <th className="py-2 px-2 text-left rounded-tl-xl">상품명</th>
                    <th className="py-2 px-2 text-center rounded-tr-xl">SKU</th>
                  </tr>
                </thead>

                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={2} className="py-6 text-center text-xs" style={{ color: "#94A3B8" }}>
                        불러오는 중...
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    rows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-t cursor-pointer active:bg-slate-100"
                        style={{ borderColor: COLORS.line }}
                        onClick={() => onPick(row)}
                      >
                        <td className="py-2 px-2">
                          <div className="leading-snug">{row.name}</div>
                        </td>
                        <td className="py-2 px-2 text-center text-[11px]" style={{ color: COLORS.textGray }}>
                          {row.sku}
                        </td>
                      </tr>
                    ))}

                  {!loading && keyword.trim() && rows.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-6 text-center text-xs" style={{ color: "#94A3B8" }}>
                        검색 결과가 없습니다.
                      </td>
                    </tr>
                  )}

                  {!loading && !keyword.trim() && (
                    <tr>
                      <td colSpan={2} className="py-6 text-center text-xs" style={{ color: "#94A3B8" }}>
                        검색어를 입력해 주세요.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {!loading && canMore && (
              <div className="mt-3">
                <button
                  className="h-11 w-full rounded-xl font-semibold text-white"
                  style={{ backgroundColor: COLORS.main }}
                  onClick={() => runSearch({ q: keyword, nextPage: page + 1, append: true })}
                >
                  더 보기 (+{DEFAULT_SIZE})
                </button>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-3">
          <button
            className="h-11 w-full rounded-xl font-semibold text-white"
            style={{ backgroundColor: COLORS.main }}
            onClick={() => nav(`/stock/take/scan?barcode=${encodeURIComponent(barcode)}`)}
          >
            스캔 화면으로 돌아가기
          </button>
        </Card>
      </div>
    </AppShell>
  );
};

export default StockTakeSearchPage;
