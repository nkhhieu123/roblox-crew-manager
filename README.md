# Roblox Crew Manager & Activity Tracker

Website quản lý thành viên Crew Roblox: tải ảnh chụp danh sách Members → AI Vision đọc dữ liệu → lưu Snapshot vào database → **so sánh với các snapshot trước** → áp dụng điều kiện → phân loại PASS / FAIL / WARNING / PENDING / EXEMPT → xuất danh sách vi phạm.

**Công nghệ:** Next.js 16 (App Router, TypeScript) · Tailwind CSS + shadcn/ui · Supabase PostgreSQL + Storage · Vercel AI Gateway (AI Vision OCR) · Vercel.

---

## Mục lục
1. [Tính năng](#1-tính-năng)
2. [Cách hệ thống tính toán](#2-cách-hệ-thống-tính-toán)
3. [Cấu hình Supabase](#3-cấu-hình-supabase)
4. [Cấu hình OCR (AI Vision)](#4-cấu-hình-ocr-ai-vision)
5. [Chạy trên máy](#5-chạy-trên-máy)
6. [Deploy lên Vercel](#6-deploy-lên-vercel)
7. [Hướng dẫn cho 2 quản lý](#7-hướng-dẫn-cho-2-quản-lý)
8. [Bảo mật](#8-bảo-mật)
9. [Cấu trúc mã nguồn](#9-cấu-trúc-mã-nguồn)

---

## 1. Tính năng

| Trang | Chức năng |
|---|---|
| **Dashboard** | Tổng thành viên, PASS / FAIL / PENDING, chưa có dữ liệu mới, tổng KM & Donate phát sinh, snapshot gần nhất; biểu đồ KM/Donate/hoạt động theo ngày, tỷ lệ đạt, top thành viên, danh sách cần xử lý |
| **Upload Screenshot** | Kéo thả nhiều ảnh PNG/JPG, xem trước, quét OCR từng ảnh, bảng kết quả sửa trực tiếp, cảnh báo dữ liệu chưa chắc chắn, gợi ý sửa Username gõ sai, gộp trùng giữa các ảnh, nhập thủ công |
| **Members** | Tìm kiếm, lọc theo trạng thái, sắp xếp theo KM / Donate / vi phạm; trang chi tiết có biểu đồ lịch sử, bảng so sánh từng snapshot, lịch sử đánh giá, miễn điều kiện, ghi chú nội bộ, gộp hồ sơ do OCR đọc sai |
| **Violations** | Danh sách FAIL (tùy chọn kèm WARNING): KM/Donate đạt vs yêu cầu, khoảng đánh giá, lý do, thời điểm phát hiện, số lần liên tiếp; lọc ngày / số lần / đã xử lý; xuất **Excel** & **CSV**; sao chép Username; đánh dấu đã xử lý + ghi chú |
| **Snapshots History** | Toàn bộ snapshot (không bao giờ tự xóa), ảnh gốc, sửa / xác thực dữ liệu, đánh giá lại, xóa có xác nhận |
| **Requirements** | Nhiều bộ điều kiện, chế độ ANY / ALL / CUSTOM (AND/OR lồng nhau), chu kỳ 6/12/24/48h hoặc tự nhập, ngưỡng WARNING, phạm vi áp dụng, ngoại lệ; mỗi lần sửa tạo phiên bản mới |
| **Settings** | Mốc reset Weekly KM, múi giờ, loại Donate mặc định, dung sai snapshot gốc, bật/tắt lưu ảnh; **nhật ký thao tác** của 2 quản lý |

## 2. Cách hệ thống tính toán

- **Định danh bằng Username** (không phân biệt hoa/thường), không dùng Display Name.
- **Mỗi lần upload = 1 Snapshot mới**, gắn thời điểm dữ liệu + thời điểm upload + người upload. Snapshot cũ không bị ghi đè.
- **Hoạt động phát sinh = Snapshot sau − Snapshot trước.** Với chu kỳ W giờ, snapshot gốc là snapshot mới nhất cũ hơn ít nhất `W × (1 − dung sai)` giờ. Nếu khoảng cách thực tế dài hơn chu kỳ, yêu cầu được nhân theo tỷ lệ (VD: 48h → yêu cầu ×2).
- **Đồng hồ reset trong ảnh:** AI đọc đồng hồ đếm ngược (VD `Resets in 2d 05:12:33`) ⇒ **mốc reset chính xác = thời điểm dữ liệu + đếm ngược**, lưu theo từng snapshot. Có thể sửa tay ở bước lưu; nếu lệch > 15 phút so với ảnh trước, hệ thống cảnh báo. Ảnh không có đồng hồ mới dùng mốc thứ/giờ trong Settings.
- **Weekly KM reset:** hệ thống cộng dồn qua mọi snapshot trung gian. Nếu khoảng đánh giá đi qua mốc reset (cấu hình ở Settings) hoặc KM bị giảm, chỉ biết mức tăng **tối thiểu** (= giá trị sau reset) → nếu mức tối thiểu đã đạt thì PASS, nếu chưa thì **PENDING**, không bao giờ kết luận FAIL.
- **Donate:** chọn loại chỉ số khi upload — *tích lũy* (tính phần tăng thêm) hoặc *theo tuần* (xử lý reset như KM). Donate tích lũy bị giảm → đánh dấu bất thường, PENDING. Hai snapshot khác loại Donate → không so sánh.
- **Thiếu dữ liệu → PENDING**: không có snapshot đủ cũ, không có trong snapshot mới, số không đọc được, dòng OCR chưa xác thực.
- **Logic 3 trạng thái (đúng / sai / chưa rõ)** cho AND/OR: VD `KM ≥ 5000 OR Donate ≥ 100` với KM chưa rõ nhưng Donate = 150 → PASS; Donate = 0 → PENDING.
- **WARNING**: không đạt nhưng đạt ≥ X% yêu cầu (cấu hình).
- **Lịch sử bất biến**: mỗi lần đánh giá lưu bản sao điều kiện + cài đặt đã dùng. Đánh giá lại cùng snapshot tạo bản ghi mới, bản cũ được đánh dấu "đã thay thế" nhưng vẫn giữ.
- **Vi phạm liên tiếp**: FAIL → +1 so với lần đánh giá trước; PENDING giữ nguyên; PASS/WARNING/EXEMPT → về 0.

## 3. Cấu hình Supabase

1. Tạo project tại <https://supabase.com/dashboard> (chọn region gần Việt Nam, VD Singapore).
2. Vào **SQL Editor** → chạy lần lượt 2 file:
   - `supabase/migrations/20261122000000_init.sql` (bảng, index, RLS, bucket `snapshots`)
   - `supabase/migrations/20261122000100_save_snapshot_fn.sql` (hàm lưu snapshot nguyên tử)
   - `supabase/migrations/20261122000200_reset_countdown.sql` (lưu đồng hồ reset tuần)

   Hoặc dùng Supabase CLI: `npx supabase link --project-ref <ref>` rồi `npx supabase db push`.
3. Vào **Project Settings → API** lấy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**bí mật**, chỉ dùng phía server)
4. Kiểm tra **Storage** có bucket `snapshots` ở chế độ **Private** (migration tạo sẵn).

> RLS được bật trên mọi bảng và không có policy nào ⇒ anon key không đọc/ghi được gì. Mọi truy cập đi qua server Next.js bằng service role sau khi kiểm tra đăng nhập.

## 4. Cấu hình OCR (AI Vision)

OCR dùng **Vercel AI Gateway** qua AI SDK — đổi model chỉ bằng biến môi trường, không cần sửa code.

- **Trên Vercel:** vào Dashboard → **AI Gateway** để bật; project trên Vercel tự xác thực bằng OIDC, không cần key.
- **Chạy local / ngoài Vercel:** tạo API key ở **AI Gateway → API Keys**, đặt vào `AI_GATEWAY_API_KEY`.
- `OCR_MODEL` (mặc định `anthropic/claude-sonnet-5.5`) — bất kỳ model có khả năng đọc ảnh trên AI Gateway, dạng `provider/model`.

Cách OCR hoạt động: model trả về **chuỗi nguyên văn** của từng ô; server tự parse số (`10.000`, `10,000`, `1.2K`…). Ô không đọc được → để trống; ký tự lạ hoặc model báo không chắc → dòng được đánh dấu **Cần kiểm tra** và không được dùng để so sánh cho tới khi quản lý tick **Xác thực**.

Mẹo chụp ảnh: chụp toàn màn hình, không thu nhỏ; nếu danh sách dài thì cuộn và chụp nhiều ảnh (hệ thống tự gộp người trùng giữa các ảnh).

## 5. Chạy trên máy

```bash
npm install
cp .env.example .env.local   # rồi điền giá trị
npm run dev                  # http://localhost:3000
npm test                     # unit test engine + OCR parser
```

## 6. Deploy lên Vercel

1. Push repo lên GitHub (đã có).
2. <https://vercel.com/new> → Import repository → Framework: Next.js (tự nhận).
3. **Environment Variables** — thêm tất cả biến trong `.env.example`:

   | Biến | Ghi chú |
   |---|---|
   | `SUPABASE_URL` | từ Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | từ Supabase, **không** thêm tiền tố `NEXT_PUBLIC_` |
   | `SUPABASE_STORAGE_BUCKET` | `snapshots` |
   | `MANAGER_1_NAME`, `MANAGER_1_PASSWORD` | quản lý 1 |
   | `MANAGER_2_NAME`, `MANAGER_2_PASSWORD` | quản lý 2 |
   | `AUTH_SECRET` | chuỗi ngẫu nhiên ≥ 32 ký tự: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `OCR_MODEL` | tùy chọn |
   | `AI_GATEWAY_API_KEY` | không cần nếu dùng OIDC trên Vercel |

4. Deploy. Hoặc bằng CLI: `npm i -g vercel && vercel link && vercel env add … && vercel --prod`.
5. Đổi mật khẩu quản lý = sửa biến môi trường rồi **Redeploy**. Đổi `AUTH_SECRET` sẽ đăng xuất mọi phiên.

## 7. Hướng dẫn cho 2 quản lý

**Lần đầu**
1. Đăng nhập bằng tên + mật khẩu riêng của mình (mọi thao tác được ghi tên người làm).
2. Vào **Settings**: kiểm tra mốc reset Weekly KM của game (mặc định Thứ hai 00:00 giờ VN) và loại Donate.
3. Vào **Requirements** → *Bộ điều kiện mới* (VD: 24h, ANY, KM ≥ 5.000 hoặc Donate ≥ 100). Bộ đầu tiên tự được áp dụng.

**Hằng ngày**
1. **Upload Screenshot** → kéo ảnh → *Quét OCR*.
2. Rà bảng kết quả: sửa ô sai, xử lý dòng vàng (*Cần kiểm tra*), bấm gợi ý "Có phải …?" nếu Username bị đọc sai, tick **Xác thực**.
3. Chỉnh *Thời điểm dữ liệu* nếu ảnh được chụp trước đó → **Lưu snapshot**. Hệ thống tự so sánh & đánh giá.
4. Lần upload đầu tiên mọi người sẽ là **PENDING** (chưa có gì để so sánh) — đó là đúng. Từ lần thứ hai (cách ≥ chu kỳ) mới có PASS/FAIL.
5. Mở **Violations** → xuất Excel/CSV hoặc *Sao chép Username* → nhắc nhở → *Đánh dấu đã xử lý* kèm ghi chú.

**Làm việc chung**
- Hai người thấy cùng một dữ liệu; trang tự làm mới (~15 giây) khi người kia thay đổi gì đó.
- Mọi upload / sửa dữ liệu / đổi điều kiện / xử lý vi phạm đều xem được ở **Settings → Nhật ký thao tác**.
- Sửa điều kiện không làm thay đổi kết quả cũ; bấm **Đánh giá lại ngay** để áp dụng cho snapshot mới nhất.
- Xóa snapshot / thành viên / bộ điều kiện luôn có hộp thoại xác nhận.

## 8. Bảo mật

- Toàn bộ trang và API yêu cầu phiên đăng nhập (cookie HttpOnly ký HS256, 30 ngày); sai mật khẩu bị trễ 0.8s để chống dò.
- API key / service role chỉ nằm trong Environment Variables phía server, không gửi xuống trình duyệt.
- Database bật RLS, không có policy công khai; bucket ảnh ở chế độ private, ảnh xem qua signed URL 1 giờ.
- File CSV/Excel được chống formula injection.
- Trang không cho công cụ tìm kiếm index (`robots: noindex`).

## 9. Cấu trúc mã nguồn

```
src/
  lib/engine/        # Logic thuần (có unit test): parse số, reset tuần, so sánh snapshot, luật AND/OR
  lib/server/        # Supabase, phiên đăng nhập, OCR, chạy đánh giá, violations, audit log
  app/login/         # Đăng nhập
  app/(app)/         # Dashboard, upload, members, violations, snapshots, requirements, settings
  app/api/           # /api/ocr, /api/export/violations, /api/sync
  proxy.ts           # Chặn truy cập khi chưa đăng nhập
supabase/migrations/ # Schema + hàm save_snapshot
```
