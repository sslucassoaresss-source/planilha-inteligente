# Planilha Inteligente

A route and sales management SaaS built for field sales representatives who visit dozens of stores per cycle. Originally designed for a rep who covers 150+ stores across multiple cities, it replaces spreadsheets and WhatsApp notes with a single, mobile-friendly workflow: plan the route, visit the store, log the sale, track the commission.

**🔗 Live demo:** [planilha-inteligente-liart.vercel.app](https://planilha-inteligente-liart.vercel.app)
**Demo credentials:** `demo@planilhainteligente.com` / `Demo2026!`

> The demo runs on isolated, fictional data — every account is fully separated at the database level via Row Level Security (RLS), so no user can ever see another user's clients, visits, or routes.

---

## Overview

Sales reps who cover a large territory usually end up juggling a spreadsheet for client data, a notebook (or WhatsApp) for daily visit logs, and their own memory for who's owed a discount or which store hasn't been visited in a while. Planilha Inteligente puts all of that in one place, built around how a rep actually works day to day: cluster clients by city, plan multiple named routes per city, log each visit in seconds from the road, and see sales/commission numbers roll up automatically.

## Features

### 📊 Dashboard
- Monthly summary cards: visits, total sold, conversion rate, estimated commission
- Daily sales bar chart with hover tooltips
- Recent visits feed
- Live widget listing clients with an active fixed discount

### 👥 Clientes (Clients)
- Full CRUD with address, city, state, phone, and fixed discount (in R$, deducted once per visit total — not per item)
- Optional Google Maps coordinates (paste `lat, lng` directly from the Maps app) for pinpoint-accurate directions, with automatic fallback to the text address when coordinates aren't set
- Real-time search by name or city (accent- and case-insensitive)
- Inline quick-edit for discount values directly from the table
- Persistent notes field surfaced automatically during visit logging

### 🏢 Empresas (Companies)
- Manage the companies/brands the rep represents, each with its own commission percentage
- Optional manual commission override per sale item, for companies whose commission isn't a flat rate

### 🗺️ Rotas (Routes)
- Clients automatically grouped by city (case/whitespace normalized, so "Indaiatuba" and "indaiatuba" always merge into one group)
- **Multiple independently named routes per city** ("Route 1", "Route 2"...), so a rep visiting 30+ stores in one city can split them into manageable batches across different days
- Drag-and-drop reordering within a route (touch-friendly, works on mobile via SortableJS)
- One-tap "Open in Maps" per stop, using precise coordinates when available
- **Calendar view**: see the whole month at a glance, with every scheduled route shown on its date — click a route to jump straight to it in the list view
- Full client mobility between routes — a client can appear in multiple routes with no restriction, giving the rep total freedom to reorganize

### 🧾 Visitas (Visits)
- Type-ahead client search (no more scrolling a 150-option dropdown from the road)
- Multi-item sales per visit, each linked to a company, with automatic commission calculation (or manual override)
- Fixed client discount clearly broken down: subtotal → discount → final total
- Daily summary (visits today, purchases today, total sold today)
- Persistent client notes surfaced automatically when logging a visit

## Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript (ES6+, vanilla — no framework)
- **Backend:** [Supabase](https://supabase.com) (PostgreSQL, Auth, Row Level Security, Realtime-ready)
- **Hosting:** [Vercel](https://vercel.com)
- **Drag & drop:** [SortableJS](https://sortablejs.github.io/Sortable/)

## Project Structure

```
├── index.html              # Login
├── pages/                  # App pages (Dashboard, Clientes, Empresas, Rotas, Visitas)
├── js/                     # One module per page + supabase.js client + auth.js
├── css/                    # One stylesheet per page + shared style.css
└── README.md
```

## Running Locally

1. Clone the repo
2. Create a Supabase project and set up the schema (clients, companies, visits, sale items, routes, route-client links) with RLS policies scoped to `auth.uid() = user_id`
3. Update `js/supabase.js` with your project URL and public (anon) key
4. Serve the folder with any static file server (no build step required)

## About

Built by [Lucas Soares](https://www.linkedin.com/in/lucas-soares-8942a4405/) — a self-taught developer transitioning from six years in live TV/audiovisual production into web development. This project is in active production use by a real field sales rep, with ongoing feature development driven directly by real-world usage feedback.