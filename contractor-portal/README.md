## LandscAIpe Contractor Portal (v1)

This folder contains a **self-contained** contractor portal (frontend + API server + seed database) that can later be connected to the mobile app.

### What’s implemented (v1)
- **Login** (demo auth)
- **Dashboard / Leads / Billing / Profile / Admin** screens
- **Lead interest hold → homeowner acceptance → credit capture** model:
  - Contractor clicks **Interested**: reserves (holds) 1 lead credit for up to **4 days**
  - Homeowner accepts a contractor (simulated via Admin endpoint for now): **winner’s contact info unlocks** and their credit is **captured**
  - Other interested contractors get their held credit **released**
- **Ask Question** is **templated** + content filtered server-side to prevent sharing contact info
- **Matching v1**: contractor receives leads only if lead ZIP is in their Service ZIP list and categories overlap

### Run locally
From repo root:

```powershell
cd .\contractor-portal\server
npm install
npm run dev
```

Then open:
- `http://localhost:3030`

### Demo logins
- Contractor: `contractor@example.com` / `password`
- Contractor: `contractor2@example.com` / `password`
- Admin: `admin@landscaipeapp.com` / `TestPasword`

### Next step when you’re ready
When you restart the app lead system, we’ll replace the JSON datastore with a real DB (Postgres/Supabase) and have the app create leads + accept contractors via the same API contract.


