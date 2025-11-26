# Reports API 사용 가이드

재고 집계용 엔드포인트. 확정 전표만 집계하고, 종료일 포함 범위로 계산합니다.

- 기본 경로: `GET /reports/daily`
- 타임존 표기는 응답 메타 정보에서 `Asia/Seoul`로 표기

---

## 동작 요약

- 집계 대상 전표 조건
  - `committed = true`
  - `status ∈ {"입고완료","출고완료"}`
  - `confirmed_at`이 존재
- 날짜 필터
  - `DATE(confirmed_at)` 기준으로 **from_date ≤ 날짜 ≤ to_date** 포함
- 집계 모드
  1) **기본**: 일자별 합계와 `running_balance` 제공. `sku`로 특정 상품만 필터 가능
  2) **group_by=sku**: SKU별·일자별 집계와 SKU별 `running_balance` 제공  
     종료일에 이벤트가 없어도 **SKU별 0행을 자동 생성**해 검증 필드를 채움
- 검증 모드 `verify=true`
  - 종료일 행에 `product_quantity, closing_balance, diff` 추가
  - `diff = product_quantity - closing_balance`

---

## 파라미터

- `from_date` **(required)**: 시작일 `YYYY-MM-DD`
- `to_date` **(required)**: 종료일 `YYYY-MM-DD`  (포함)
- `sku` *(optional)*: 특정 SKU만 집계. `group_by=sku` 모드에서는 무시
- `group_by` *(optional)*: `"sku"` 입력 시 SKU별 그룹 집계
- `verify` *(optional, boolean)*: 검증 필드 포함
- `csv` *(optional, boolean)*: CSV 다운로드 응답

> 잘못된 기간(`from_date > to_date`)은 **200 + 빈 결과**로 반환

---

## 응답 스키마

### ReportResponse
- `from_date`: 요청 시작일
- `to_date`: 요청 종료일
- `timezone`: 표기용 타임존 문자열
- `sku`: 기본 모드에서의 필터 SKU
- `group_by`: `"sku"` 또는 `null`
- `rows`: `ReportRow[]`

### ReportRow
- `day` (YYYY-MM-DD)
- `sku` (group_by=sku 모드에서 채워짐)
- `inbound_qty`
- `outbound_qty`
- `net_qty` = inbound_qty - outbound_qty
- `running_balance` = 기간 내 누적 변화량
- `product_quantity` *(verify=true에서 종료일 행만)*
- `closing_balance` *(verify=true에서 종료일 행만)*
- `diff` = product_quantity - closing_balance *(verify=true에서 종료일 행만)*

---

## 사용 예시

### 1) 기본 모드(JSON, 단일 날짜, 검증 포함)
```
GET /reports/daily?from_date=2025-09-19&to_date=2025-09-19&sku=TEST-LEDGER-20001&verify=true
```

```json
{
  "from_date": "2025-09-19",
  "to_date": "2025-09-19",
  "timezone": "Asia/Seoul",
  "sku": "TEST-LEDGER-20001",
  "group_by": null,
  "rows": [
    {
      "day": "2025-09-19",
      "sku": "TEST-LEDGER-20001",
      "inbound_qty": 8,
      "outbound_qty": 102,
      "net_qty": -94,
      "running_balance": -94,
      "product_quantity": 50,
      "closing_balance": -94,
      "diff": 144
    }
  ]
}
```

### 2) SKU별 그룹(JSON, 검증 포함)
```
GET /reports/daily?from_date=2025-09-14&to_date=2025-09-20&group_by=sku&verify=true
```

예상 포인트
- 2025-09-14: `SKU-TEST-001`의 집계와 `running_balance=2`
- 2025-09-19: `TEST-LEDGER-20001`의 집계와 `running_balance=-94`
- 2025-09-20: 두 SKU 모두 검증 필드 채워짐  
  (`product_quantity, closing_balance, diff`)

### 3) SKU별 그룹(CSV 다운로드, 검증 포함)
```
curl "http://127.0.0.1:8000/reports/daily?from_date=2025-09-14&to_date=2025-09-20&group_by=sku&verify=true&csv=true" -OJ
```

CSV 예시(하단 두 줄)
```
day,sku,inbound_qty,outbound_qty,net_qty,running_balance,product_quantity,closing_balance,diff
2025-09-20,SKU-TEST-001,0,0,0,2,102,2,100
2025-09-20,TEST-LEDGER-20001,0,0,0,-94,50,-94,144
```

### 4) 엣지 케이스
```
GET /reports/daily?from_date=2025-09-23&to_date=2025-09-22
```

응답
```json
{
  "from_date": "2025-09-23",
  "to_date": "2025-09-22",
  "timezone": "Asia/Seoul",
  "sku": null,
  "group_by": null,
  "rows": []
}
```

---

## CSV 컬럼 정의

- 기본 모드:  
  `day, inbound_qty, outbound_qty, net_qty, running_balance`  
  `verify=true`인 경우 뒤에 `product_quantity, closing_balance, diff` 추가

- group_by=sku 모드:  
  `day, sku, inbound_qty, outbound_qty, net_qty, running_balance`  
  `verify=true`인 경우 뒤에 `product_quantity, closing_balance, diff` 추가

---

## 참고

- `running_balance`는 기간 내 변화량 누적치로, 시작 잔액은 0으로 가정
- `product_quantity`는 Product 테이블의 현재 수량
- `diff`가 0이 아니면 재고 데이터 불일치 가능성 존재
