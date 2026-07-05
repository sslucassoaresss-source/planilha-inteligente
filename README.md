# 📊 Planilha Inteligente

A multi-tenant SaaS web application built for field sales representatives to manage clients, plan visit routes, log sales, and track commissions — replacing manual spreadsheets and messaging apps.

**🔗 Live demo:** [planilha-inteligente-liart.vercel.app](https://planilha-inteligente-liart.vercel.app)
**🔐 Demo login:** `demo@planilhainteligente.com` / `Demo2026!`

> This is a real client project. The demo above runs on an isolated demo account with fictional data — no real client information is exposed.

---

## 🖼️ Preview

_Add 2-3 screenshots or a short GIF here (Dashboard, Clients, Routes) once available._

---

## 🎯 Why this project

Built for a sales representative who manages 30–40 store visits a day across multiple cities, and represents several partner companies — each with its own commission rate. The goal was to replace scattered Excel sheets and WhatsApp notes with a single, reliable system.

---

## ✨ Features

- **Authentication** — Supabase Auth, session-based access control
- **Clients** — full CRUD, per-client fixed discount, quick inline discount editing
- **Companies** — each partner company has its own commission percentage
- **Routes** — clients auto-grouped by city, persistent & manually curated once a visit date is set, drag-and-drop reordering, Google Maps integration
- **Visits** — multi-item sales per visit (one visit can include sales from multiple partner companies), automatic discount application
- **Dashboard** — daily/monthly KPIs, sales chart, commission calculated per company
- **Multi-tenant architecture** — Row Level Security ensures each user only ever sees their own data

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript (ES6+, native modules — no framework/build step)
- **Backend:** Supabase (PostgreSQL, Auth, Row Level Security, Realtime)
- **Hosting:** Vercel
- **Version control:** Git / GitHub

---

## 🗄️ Data Model (simplified)

```
clientes      → client profiles, fixed discount, notes
empresas      → partner companies, each with its own commission %
rotas         → one row per city per month, with a defined visit date
rota_clientes → ordered, persistent list of clients within a route
visitas       → one row per visit (client, date, purchase status)
itens_venda   → one or more sale line items per visit, linked to a company
```

Every table is protected with Row Level Security policies scoped to `auth.uid()`, so the same codebase safely serves multiple independent users.

---

## 🚀 Running locally

```bash
git clone https://github.com/sslucassoaresss-source/planilha-inteligente.git
cd planilha-inteligente
```

Open `index.html` with a local static server (e.g. VS Code's Live Server extension). No build step or dependencies required — it's plain HTML/CSS/JS with ES modules.

---

## 👤 Author

**Lucas Soares de Sousa**
Frontend / Full-Stack Developer — [LinkedIn](https://www.linkedin.com/in/lucas-soares-8942a4405/) · [Email](mailto:sslucassoares.s.s@icloud.com)