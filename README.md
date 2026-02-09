# BAO TQ (thay n8n)

Mục tiêu: thay thế workflow n8n bằng chương trình chạy được trên server (CLI + scheduler), dễ thêm nhiều workflow sau này.

## Cấu trúc thư mục

- `config/workflows/*.json`: cấu hình từng workflow (mỗi file = 1 workflow)
- `src/workflows/transforms/*`: hàm transform theo từng nguồn (vd `sohu`)
- `src/lib/googleSheets.ts`: đọc + upsert dữ liệu lên Google Sheets
- `src/scheduler.ts`: chạy theo cron (giống Schedule Trigger trong n8n)
- `src/workflows/sources/*`: nguồn lấy dữ liệu (HTTP hoặc mở web headless)

## Chuẩn bị Google Sheets API

1. Tạo Service Account trên Google Cloud, enable **Google Sheets API**
2. Tải JSON key của service account
3. Chia sẻ (Share) Google Sheet cho email service account (quyền Editor)

## Cấu hình môi trường

Tạo file `.env` (tham khảo `.env.example`)

Khuyến nghị: đặt toàn bộ JSON của service account vào biến:

- `GOOGLE_SERVICE_ACCOUNT_JSON` = nội dung JSON (1 dòng)

Hoặc dùng cách chuẩn của Google:

- `GOOGLE_APPLICATION_CREDENTIALS` = đường dẫn file JSON (trên server/Docker mount vào)

Gợi ý với Docker Compose: đặt file key tại `secrets/google-service-account.json` (đã `.gitignore`), compose sẽ mount vào `/run/secrets/google-service-account.json`.

## Chạy local

```bash
npm install
npx playwright install chromium
npm run dev -- list
npm run dev -- preview sohu 5
npm run dev -- preview sina 5
npm run dev -- preview fxbaogao 5
npm run dev -- run sohu
npm run dev -- run sina
npm run dev -- run fxbaogao
npm run dev -- schedule
```

## Chạy production (build)

```bash
npm run build
node dist/index.js run sohu
node dist/index.js schedule
```

## Docker (server)

```bash
docker compose up -d --build
```

## Thêm workflow mới

1. Tạo file `config/workflows/<id>.json` (copy từ `config/workflows/sohu.json`)
2. Nếu cần transform riêng, tạo file `src/workflows/transforms/<name>.ts` và khai báo trong `src/workflows/transforms/index.ts`
3. Chạy thử: `npm run dev -- run <id>`

## Lưu ý Google Sheets

- Dòng 1 của sheet phải là header; chương trình sẽ upsert theo `keyColumn` (vd `link`).
- Tên cột match theo header (có hỗ trợ match thêm bản `trim()` để tránh lỗi khoảng trắng thừa).

## Lưu ý scrape (headless)

- Workflow `sohu` hiện đang lấy link theo selector `ul.news[data-spm="top-news1"] a.titleStyle` trên `https://www.sohu.com/` và fetch từng bài để lấy `h1`, `#news-time`, `div.area > span:last-child`, `meta[name="description"]`, `og:image`.
- Nếu site chặn/rate-limit, dùng `detailDelayMs`, `detailRetries`, `waitBetweenTriesMs` trong file workflow.

## Workflow `gamelook`

- Config: `config/workflows/gamelook.json` (sheet tab `gamelook`, cột: `link`, `title`, `posting_date`, `description`, `extracted_at`, `image`)
- Nguồn: list page `http://www.gamelook.com.cn/page/{page}/` lấy link theo selector `h2.item-title a`, sau đó fetch từng bài để lấy `h1`, meta description, ảnh trong `div.entry img` (ưu tiên `data-original`).
