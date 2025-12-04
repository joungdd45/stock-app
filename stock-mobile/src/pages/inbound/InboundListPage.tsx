/* C:\dev\stock-mobile\src\pages\inbound\InboundListPage.tsx */
/**
 * 입고관리 > 입고조회
 *  - draft 상태 전표 리스트 표시
 *  - 전표 터치 시:
 *    - barcode 있음  → 바코드 스캔 페이지로 이동
 *    - barcode 없음  → 바코드 등록 페이지로 이동
 *  - 전체 JSON(row)를 payload로 그대로 전달
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, Card, COLORS } from "../../components/layout/AppShell";
import {
  inboundAdapter,
  type InboundRegisterQueryListItemDto,
  type InboundRegisterQueryListResultDto,
} from "../../api/adapters/inbound.adapter";

interface InboundRow extends InboundRegisterQueryListItemDto {
  id: string; // 리스트 key
}

/** 전표번호 줄임표시: 20251202-00019 → 12-02 */
function formatInvoiceShort(raw: string): string {
  if (!raw) return raw;
  const code = raw.startsWith("INB-") ? raw.slice(4) : raw;
  if (code.length < 8) return raw;
  const mm = code.substring(4, 6);
  const dd = code.substring(6, 8);
  return `${mm}-${dd}`;
}

const InboundListPage: React.FC = () => {
  const nav = useNavigate();
  const [rows, setRows] = useState<InboundRow[]>([]);
  const [loading, setLoading] = useState(false);

  // 리스트 호출
  useEffect(() => {
    const fetchList = async () => {
      setLoading(true);
      try {
        const res = await inboundAdapter.registerQueryList({
          page: 1,
          size: 50,
        });

        if (!res.ok) {
          console.error("입고조회 실패:", res.error);
          setRows([]);
          return;
        }

        const dto: InboundRegisterQueryListResultDto = res.data;
        const items = dto.items ?? [];

        // draft 상태만 사용
        const filtered = items.filter((x) => x.status === "draft");

        const mapped: InboundRow[] = filtered.map((item) => ({
          ...item,
          id: `${item.header_id}-${item.item_id}`,
        }));

        setRows(mapped);
      } catch (err) {
        console.error("입고조회 예외:", err);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    fetchList();
  }, []);

  // 바코드 유무에 따라 스캔/등록 페이지 분기
  const goNext = (row: InboundRow) => {
    const json = encodeURIComponent(JSON.stringify(row));
    const barcode = (row.barcode ?? "").trim();

    if (barcode) {
      // ✅ 바코드가 있는 전표 → 스캔 페이지
      nav(`/inbound/scan-barcode?payload=${json}`);
    } else {
      // ✅ 바코드가 없는 전표 → 바코드 등록 페이지
      nav(`/inbound/register-barcode?payload=${json}`);
    }
  };

  return (
    <AppShell title="입고 조회">
      <div className="space-y-3">
        <Card className="p-3 pb-0">
          <div
            className="text-sm font-semibold mb-2"
            style={{ color: COLORS.main }}
          >
            입고 리스트
          </div>

          <div className="text-[11px] text-slate-500 mb-1">
            전표를 터치하면 바코드 스캔 또는 바코드 등록 화면으로 이동합니다
          </div>

          <div className="mt-2 px-1 pb-2">
            <div
              className="rounded-xl border bg-white"
              style={{ borderColor: COLORS.line }}
            >
              <table className="w-full text-[13px]">
                <thead
                  className="bg-slate-50"
                  style={{ color: COLORS.textGray }}
                >
                  <tr>
                    <th className="py-2 px-2 text-center rounded-tl-xl">
                      주문번호
                    </th>
                    <th className="py-2 px-2 text-center">상품명</th>
                    <th className="py-2 px-2 text-center rounded-tr-xl">
                      수량
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {loading && (
                    <tr>
                      <td
                        colSpan={3}
                        className="py-6 text-center text-xs"
                        style={{ color: "#94A3B8" }}
                      >
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
                        onClick={() => goNext(row)}
                      >
                        <td className="py-2 px-2 text-center text-[12px]">
                          {formatInvoiceShort(row.order_no)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <div className="leading-snug">{row.name}</div>
                        </td>
                        <td className="py-2 px-2 text-center font-semibold">
                          {row.qty}
                        </td>
                      </tr>
                    ))}

                  {!loading && rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="py-6 text-center text-xs"
                        style={{ color: "#94A3B8" }}
                      >
                        입고 내역이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
};

export default InboundListPage;
