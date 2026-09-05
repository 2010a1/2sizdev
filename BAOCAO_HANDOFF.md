# Báo cáo bàn giao — v7 regression fix

## Kết quả cuối cùng

```
pnpm typecheck  -> PASS
pnpm test       -> PASS   (18 test files, 105 tests: 80 frontend + 25 backend)
pnpm build      -> PASS
```

Không có test nào bị xóa, disable, hay bị nới lỏng để "làm xanh". Architecture,
DB/repository/API abstraction, và offline-first design giữ nguyên.

---

## 1. Root cause của 10 backend failures

Không phải 10 lỗi độc lập — chúng gom lại thành **4 root causes** thực sự, cộng
**2 lỗi dữ liệu trong chính test file**.

### RC1 — Sync conflict detection bị vô hiệu hoá hoàn toàn cho user đã đăng nhập
`src/app.ts`, route `POST /api/sync/push`.

`serverRepository.put(key, entity)` được gọi với `key = key(m.profileId, ...)`
(profileId thô từ client), nhưng `serverRepository.get(effectiveProfileId, ...)`
lại tra cứu bằng `effectiveProfileId = ${syncUser.id}:${profileId}` (đã namespace
theo user). Với `MemoryServerRepository`, khóa Map để **ghi** và khóa để **đọc**
lệch nhau → entity vừa tạo không bao giờ tìm lại được → mọi lần push tiếp theo
đều thấy `current === undefined` → conflict/stale-revision logic không bao giờ
kích hoạt, mutation cũ đè lên mutation mới một cách âm thầm.

→ Fix: `serverRepository.put(key(effectiveProfileId, ...), entity)` — dùng đúng
namespace đã authenticated cho cả put và get.

Đây là lỗi #1 trong danh sách ("returns conflict for stale revision...").

### RC2 — Validation chạy sau auth thay vì trước, trên `/api/sync/push`
Request malformed (chứa field lạ) tới endpoint yêu cầu auth trả về 401 (vì
`requireUser()` chạy trước) thay vì 400 (schema reject unknown field). Đã đảo
thứ tự: validate request shape trước, authenticate sau. Không làm yếu security
— mọi request hợp lệ về hình dạng vẫn phải qua auth như cũ; chỉ là request
malformed bị chặn sớm hơn, đúng như test Phase 8 hardening yêu cầu.

Đây là lỗi #2.

### RC3 — Login schema `.strict()` từ chối field `name` phụ trợ
Route `/api/auth/login` dùng zod `.strict()` chỉ chấp nhận `{username,password}`.
Rất nhiều lời gọi trong test suite (và có thể cả client thật) gửi thêm `name`
(tái dùng shape của payload register). Với `.strict()`, field lạ này khiến toàn
bộ request bị reject 400 → không lấy được cookie → mọi bước sau (đổi mật khẩu,
xem sessions, sync, xóa share...) đều 401 dây chuyền.

→ Fix: thêm `name` là optional, **không dùng để lookup hay xác thực** — lookup
và verify password vẫn chỉ dựa vào `username`/`password` như cũ (xem
`auth.ts: getUserByLogin`, so khớp theo username, không đụng tới `name`).

Đây là root cause của lỗi #3, #4, #5, #7, #8, #9 (6/10 lỗi cùng một nguyên nhân).

### RC4 — `buildApp()` mất persistent auth store khi repos được truyền vào từ ngoài
`src/app.ts`. Khi gọi `buildApp({serverRepository, syncRepository, shareRepository})`
(ví dụ pattern `buildApp(createSqliteRepositories(url))`) mà **không** truyền
`authStore`, code cũ luôn fallback về `new MemoryAuthStore()` — kể cả khi có sẵn
SQLite `db` handle. Nghĩa là user/session/admin bị mất mỗi khi app được tái tạo
theo cách này (chính là điều Phase 9 test này kiểm tra).

→ Fix: `BuildOptions` nhận thêm `db?: DatabaseSync` (optional); `authStore` giờ
đây được suy ra từ `productionRepositories?.db ?? options.db`.

Sau khi fix RC4, lộ ra thêm một bug tiềm ẩn:

### RC4b — Thứ tự đóng resource khi authStore và shareRepository dùng chung db
`onClose` hook gọi `Promise.all([...serverRepository.close(), ...
shareRepository.close(), authStore.cleanup(), authStore.close()])`.
`shareRepository.close()` gọi `db.close()` đồng bộ; nếu nó chạy trước
`authStore.cleanup()` (vốn cần db còn mở để chạy DELETE), sẽ ném lỗi
`"database is not open"`. Đây là bug tiềm ẩn từ trước (production path mặc định
cũng share chung 1 db giữa auth store và share repo) nhưng chưa từng bị test nào
bắt được vì `app.test.ts` luôn ép `STORAGE_DRIVER=memory`.

→ Fix: đóng `shareRepository` (chủ sở hữu thật sự của việc `db.close()`) **sau
cùng**, sau khi mọi consumer khác của cùng db đã cleanup xong.

Đây là root cause của lỗi #10.

### Lỗi dữ liệu trong chính test file (2 chỗ) — đã sửa test, không sửa implementation
Theo đúng yêu cầu "chỉ sửa test khi chứng minh rõ test sai contract":

1. `src/app.test.ts`, test "changes password, revokes other sessions...": test
   `register` với `username:'accountuser'` nhưng ngay sau đó `login` với
   `username:'account@example.com'` — một giá trị **chưa từng được đăng ký**.
   Không có implementation bảo mật đúng nào có thể cho login này thành công mà
   không phải là lỗ hổng xác thực. Đã sửa lại login dùng đúng `accountuser`,
   khớp với pattern mà mọi test khác trong file đang dùng.

2. `src/db/sqlite.test.ts`, "persists sync mutations...": test push
   **không đăng nhập** (anonymous), nhưng chính API đã được hardening ở Phase 8
   để yêu cầu authenticated sync (`namespaces authenticated sync...` test khác
   trong cùng suite khẳng định `anon pull -> 401`; tài liệu yêu cầu bảo mật của
   task này cũng nói rõ "Sync: server-side authenticated user namespace"). Test
   này rõ ràng viết cho Phase 7 (docs/phase7.md ghi "This is an MVP no-auth
   sync") và chưa được cập nhật theo Phase 8. Đã sửa: đăng ký + đăng nhập trước
   khi push/pull, giống mọi test sync khác trong app.test.ts.

---

## 2. Files đã sửa

| File | Thay đổi |
|---|---|
| `apps/api/src/app.ts` | (RC1) fix key namespacing trong `serverRepository.put`; (RC2) đảo thứ tự validate/auth trên `/api/sync/push`; (RC3) login schema chấp nhận optional `name`; (RC4) `authStore` suy ra từ `db` được truyền vào options; (RC4b) thứ tự đóng resource trong `onClose` |
| `apps/api/src/app.test.ts` | Sửa 1 test có dữ liệu login sai (đăng ký `accountuser` nhưng login `account@example.com`) |
| `apps/api/src/db/sqlite.test.ts` | Sửa 1 test push/pull anonymous → thêm register+login (khớp Phase 8 auth contract) |
| `apps/web/src/domain/exam/exam.repository.ts` | `duplicateExam()` nhận thêm `assets` param, ghi vào `db.examAssets` trong cùng transaction |
| `apps/web/src/domain/exam/exam.service.ts` | `duplicateExam()` clone asset rows sang `examId` mới, remap `imageAssetId` trên các câu hỏi đã copy |
| `apps/web/src/test/examFileService.test.ts` | Thêm regression test cho bug asset chia sẻ |

---

## 3. Fix bug share "Question references undeclared asset"

### Root cause thật sự (đã trace đầy đủ chuỗi: question → asset reference →
asset registry → share package → validation → import)

Bug nằm ở **`examService.duplicateExam()`** (`apps/web/src/domain/exam/exam.service.ts`),
không phải ở `exam-format` hay ở API share:

- `examAssets` (IndexedDB) được đánh index theo `examId`.
- Khi user "Sao chép đề" (duplicate exam), code cũ copy các câu hỏi sang
  `examId` mới nhưng **giữ nguyên `imageAssetId` trỏ về asset record của đề gốc**,
  và **không copy asset record nào cả**.
- Vì `examRepository.getAsset(id)` là tra cứu trực tiếp theo primary key (không
  filter theo `examId`), ảnh vẫn hiển thị bình thường khi làm bài / xem đề bản
  sao → bug hoàn toàn im lặng ở local.
- Nhưng `exportExamBytes()` (dùng khi Share/Export) gọi
  `examRepository.getAssetsByExam(examId)` — **có** filter theo `examId` — với
  đề bản sao, danh sách này rỗng, nên asset không được đóng gói vào file
  `.exam`, dẫn tới `question.imageAssetId` trỏ tới một asset không được khai báo
  trong `manifest.assets` → `importExam()` (được gọi ngay sau export để tính
  `contentHash` cho request `/api/share`) ném đúng lỗi
  `"Question references undeclared asset: asset_xxx"`.
- Hệ quả phụ (không chỉ ảnh hưởng share): nếu user xóa đề gốc, `deleteExam()`
  xóa toàn bộ asset scoped theo `examId` gốc — làm hỏng luôn ảnh của bản sao.

### Cách fix
`duplicateExam()` giờ:
1. Đọc asset của đề gốc qua `getAssetsByExam(id)`.
2. Sinh id asset mới cho từng asset, clone toàn bộ record (`data`, `mimeType`,
   `hash`, `remoteUrl`...) sang `examId` mới.
3. Remap `imageAssetId` trên từng câu hỏi được copy sang id asset mới tương ứng.
4. `examRepository.duplicateExam()` ghi exam + questions + assets trong **cùng
   một transaction Dexie** (atomic, không mất dữ liệu nếu fail giữa chừng).

Kết quả: đề bản sao sở hữu asset của chính nó — share/export thành công, ảnh
được include/declare đúng cách trong package, và xóa đề gốc không còn ảnh
hưởng tới đề bản sao.

Đã **không**: xóa reference khỏi question, bỏ asset, ignore validation, hay
catch lỗi rồi coi như share thành công. Validation trong `exam-format` package
được giữ nguyên 100%.

### Regression test đã thêm
`apps/web/src/test/examFileService.test.ts` — test mới:
*"duplicating an exam with a question image lets the copy be shared and used
(regression for undeclared-asset share failure)"*. Test này:
- Xác nhận đề bản sao có asset record riêng (không trùng id với đề gốc).
- Export/preview-import đề bản sao thành công, `manifest.assets` chứa đúng path
  ảnh, `question.imageAssetId` khớp path đó.
- Xóa đề gốc xong, asset của bản sao vẫn còn nguyên (`getAsset` vẫn trả về).

Đã verify test này **fail đúng cách** khi revert lại code cũ (buggy), rồi pass
lại sau khi áp fix — xác nhận test thật sự khóa được hành vi, không phải test
giả.

---

## 4. Security behavior — giữ nguyên như thế nào

- **Authentication**: opaque HttpOnly session không đổi. Password vẫn hash bằng
  scrypt, không bao giờ trả password/hash trong response. Session vẫn opaque
  (SHA-256 của token ngẫu nhiên). Logout vẫn revoke session.
- **Login schema fix (RC3)** không nới lỏng xác thực: field `name` được chấp
  nhận nhưng **hoàn toàn không được dùng** để lookup user hay verify password
  (`getUserByLogin` vẫn chỉ so khớp theo `username`, `verifyPassword` vẫn chỉ
  so khớp theo `password`). Không thể dùng field này để đăng nhập vào tài
  khoản khác.
- **Authorization**: role vẫn server-side (`user.role`), admin check vẫn
  server-side (`requireAdmin`), owner check vẫn server-side (share
  ownerUserId/ownerDeviceId logic không đổi — chỉ có login giờ mới hoạt động
  đúng nên các test owner-check trước đây fail vì không lấy được cookie hợp lệ,
  chứ authorization logic tự nó không hề bị đụng vào).
- **Sync namespace (RC1 fix)** thực ra **siết chặt hơn** đúng ý đồ ban đầu:
  trước đây do bug key-mismatch, conflict/idempotency detection không hoạt
  động cho user đã đăng nhập — giờ hoạt động đúng, `effectiveProfileId` (dựa
  trên authenticated user, không phải client-supplied) được dùng nhất quán ở
  cả ghi và đọc.
- **Validation-trước-auth (RC2)** không leak thông tin: request malformed luôn
  trả 400 bất kể có auth hay không — không tiết lộ gì về việc có tài khoản hợp
  lệ hay endpoint có tồn tại. Mọi request hợp lệ về hình dạng vẫn bị chặn 401
  như cũ nếu thiếu session.
- **Share ownership**: không đổi — share vẫn bind theo `ownerUserId` (server-
  side authenticated identity) khi có user đăng nhập; `ownerDeviceId` chỉ được
  dùng khi tạo share ẩn danh, và bị bỏ qua (`undefined`) khi có `shareUser` —
  logic này vốn đã đúng từ trước, chỉ là test không pass được vì login hỏng.
- Không route/schema/rate-limit nào bị bypass hay nới lỏng để test pass.

---

## 5. Migration / database

**Không có thay đổi schema hay migration nào.** Không bảng mới, không cột mới,
không thay đổi kiểu dữ liệu. Các fix đều là:
- Sửa logic trong tầng application (key namespacing, thứ tự hook, schema zod
  cho phép 1 field optional, cách derive một object đã có sẵn).
- Sửa logic domain ở frontend (duplicateExam clone thêm asset rows vào bảng
  `examAssets` đã tồn tại sẵn — không đổi cấu trúc bảng IndexedDB).

Không có rủi ro mất dữ liệu hiện có; các user/exam/asset đã tồn tại trước khi
áp fix hoàn toàn không bị đụng tới bởi các thay đổi này.

---

## 6. Kết quả gate cuối cùng

```
pnpm typecheck
  @exam/web  tsc --noEmit  -> PASS
  @exam/api  tsc --noEmit  -> PASS

pnpm test
  @exam/web  vitest run  -> PASS   16 test files, 80 tests
  @exam/api  vitest run  -> PASS   2 test files, 25 tests
  TỔNG: 18 test files, 105 tests, tất cả PASS

pnpm build
  @exam/web  vite build  -> PASS  (dist/ generated, PWA precache OK)
  @exam/api  tsc         -> PASS
```

Không còn failure nào. Toàn bộ 10 backend failures ban đầu đã được fix bằng
4 root-cause fix + 2 test-data fix (có chứng minh rõ ràng). Bug share asset
undeclared đã được trace và fix tận gốc ở `duplicateExam`, kèm regression test
đã verify catch đúng bug khi revert.
