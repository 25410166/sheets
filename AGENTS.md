# AGENTS.md — CSheet (CookApps Child App)

## 1. Hệ sinh thái và Quan hệ với Dự án Cốt lõi
- **Dự án Cốt lõi (Core Platform)**: CookApps Web tại `F:\Projects\CookApps` (Next.js, Prisma, PostgreSQL, Cloudflare R2).
- **Dự án Hiện tại (Child App)**: CSheet tại `F:\Projects\OFFICE\sheets` (Tauri 2 + React/Vite + Univer Spreadsheet).
- **Định danh trong hệ thống**:
  - `APP_SLUG`: `csheet`
  - `APP_NAME`: `CSheet` / `CookApps Sheet`
  - `IDENTIFIER`: `net.cookapps.csheet`
  - `SCHEME`: `cookapps-csheet://`
  - `DEEP_LINK_EVENT`: `csheet:deeplink`

Skill file tham chiếu:
- [.agents/skills/cookapps-child-app-auth/SKILL.md](file:///F:/Projects/OFFICE/sheets/.agents/skills/cookapps-child-app-auth/SKILL.md)

---

## 2. Kiến trúc Xác thực & Bảo mật (Auth & Security)
- **Cơ chế**: Single Sign-On (SSO) qua CookApps Web (`/desktop-login`), PKCE RFC 7636, Ed25519 device proof, offline lease token 7 ngày.
- **Bypass CORS**: Mọi request lên `https://cookapps.net` từ frontend PHẢI đi qua lệnh Rust `native_fetch` (`src-tauri/src/lib.rs`). Tuyệt đối không dùng browser `fetch()` trực tiếp từ WebView2 lên máy chủ CookApps.
- **Không lưu server secret**: App chỉ lưu Ed25519 Public Key để verify offline lease. Private key của thiết bị được lưu trong local secure store.
- **Đăng ký URI Scheme Windows**: Khi chạy debug/dev, chạy script `scripts/register_scheme.ps1` để Windows nhận diện `cookapps-csheet://`.

---

## 3. Bản đồ Thư mục & Modules
- `apps/web`: Ứng dụng frontend React/Vite, chứa giao diện bảng tính Univer và rào chắn bản quyền `src/desk-auth/DeskAuthGate.tsx`.
- `packages/sheets-auth`: SDK xác thực CSheet (`AuthService`, `crypto`, `SecureAuthStore`).
- `src-tauri`: Ứng dụng desktop Tauri 2 (Rust).
  - `src-tauri/src/lib.rs`: Chứa `native_fetch`, plugin `single-instance`, plugin `deep-link`, và file association handlers.
  - `src-tauri/tauri.conf.json`: Cấu hình cửa sổ, permissions, và scheme `cookapps-csheet`.
- `vendor/univer-revamp`: Git submodule chứa core engine spreadsheet (Univer fork).

---

## 4. Quy trình Phát triển & Kiểm tra (Commands)
```bash
# Cài đặt dependencies
pnpm install

# Chạy frontend web
pnpm dev:web

# Chạy desktop app Tauri
pnpm tauri dev

# Đăng ký scheme dev trên Windows (chạy 1 lần khi test login dev)
powershell -ExecutionPolicy Bypass -File scripts/register_scheme.ps1

# Kiểm tra chất lượng trước khi commit
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:unit
```
