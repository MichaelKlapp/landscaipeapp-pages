## Contractor Portal v1 – Architecture + App Integration Notes

### Core idea
The portal is designed so your **mobile app** can later integrate by calling the same API endpoints that the portal uses.

The most important rule from your spec is:
- Contractors can mark a lead as **Interested** without seeing homeowner contact info.
- Contact info is **only unlocked** for the contractor the homeowner accepts.

### Lead + credit state machine (v1)
**Lead statuses**
- `open`: visible to matched contractors
- `assigned`: homeowner has accepted one contractor; only that contractor can view contact info
- (future) `closed`, `spam`, `cancelled`

**Interest (per contractor per lead)**
- `held`: contractor clicked Interested → reserves 1 credit for up to 4 days
- `withdrawn`: contractor withdrew interest (hold released)
- `expired`: hold expired after 4 days (hold released)
- `released`: homeowner selected another contractor (hold released)
- `captured`: homeowner accepted this contractor → credit is charged and contact info unlocks

**Credits**
- Credits are stored as a **ledger** of +/– entries. “Available” credits = ledger balance – number of active holds.
- This makes “refunds” simple and auditable (and prevents weird drift).

### API contract (current endpoints)
**Auth**
- `POST /api/auth/login` → `{ token, user }`
- `POST /api/auth/logout`
- `GET /api/me` → `{ user, credits }`

**Leads**
- `GET /api/leads` → returns matched leads (and assigned leads that belong to the contractor)
- `GET /api/leads/:id` → masked lead; full lead only if assigned to the contractor (or admin)
- `POST /api/leads/:id/interest` → creates a `held` interest if contractor has 1 available credit
- `POST /api/leads/:id/withdraw-interest` → sets interest to `withdrawn`
- `POST /api/leads/:id/questions` → templated question + server-side filters (blocks email/phone/link/contact prompts)

**Billing (demo)**
- `GET /api/billing`
- `POST /api/billing/buy-credits` (demo)

**Profile**
- `GET /api/profile`
- `POST /api/profile` (update company info, service ZIPs, categories)
- `POST /api/profile/photos` (multipart upload: `photo`, optional `isFeatured`)
- `DELETE /api/profile/photos/:photoId`
- `POST /api/profile/photos/:photoId/feature` (`{ isFeatured: boolean }`)
- `POST /api/profile/photos/:photoId/move` (`{ direction: "up" | "down" }`)

**App-facing (public)**
- `GET /api/public/contractors/:id` → contractor card payload (3 featured photos + up to 10 total)

**Admin**
- `GET /api/admin/contractors`
- `POST /api/admin/contractors/:id/add-credits`
- `POST /api/admin/leads/:id/accept` (simulates homeowner acceptance; in production the **app** calls this)

### Matching (v1 ZIP-based)
Lead is visible to a contractor if:
- lead ZIP is inside contractor `serviceZips`
- major categories overlap (if lead specifies them)
- required tags overlap (if lead specifies required tags)

### Future: radius matching (v2)
Add a ZIP centroid table and store contractor “base ZIP” + radius:
- Match if distance(leadZipCentroid, contractorBaseZipCentroid) ≤ radius
- Implementation options:
  - simple Haversine distance in code
  - Postgres + PostGIS `ST_DWithin` for scale

### Phone verification (homeowner)
For spam reduction, the **app** should verify phone (OTP) before creating/dispatching a lead.
In v1 demo data, homeowners have `phoneVerifiedAt`.

### Deploy notes (when ready)
This folder is currently built as:
- Node/Express server (`contractor-portal/server`) serving:
  - portal UI (`contractor-portal/public`)
  - API (`/api/*`)

For GitHub Pages you can’t run Node directly. When deploying, we’ll likely:
- Host API on a real server (Render/Fly/Railway/Vercel Functions/Supabase Edge Functions)
- Keep the portal UI static, pointing at the hosted API base URL

### Portfolio photos (v1 limits)
- Max **10** photos per contractor
- Max **3** featured photos (shown first in the app)


