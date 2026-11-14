# Online Hospital Appointment Management System Using DFA (Deterministic Finite Automaton)

A complete, full-stack, security-hardened Hospital Appointment Management System built with **React + Vite**, **Node.js + Express**, **MongoDB / Mongoose**, and a formal **Deterministic Finite Automaton (DFA) Engine**.

---

## 1. Formal DFA Specification

The appointment lifecycle is governed by the formal 5-tuple $M = (Q, \Sigma, \delta, q_0, F)$:

- **States ($Q$)**: `REQUESTED`, `CONFIRMED`, `RESCHEDULED`, `CANCELLED`, `REJECTED`, `COMPLETED`
- **Input Alphabet ($\Sigma$)**: `APPROVE`, `RESCHEDULE`, `CANCEL`, `REJECT`, `COMPLETE`
- **Initial State ($q_0$)**: `REQUESTED`
- **Terminal / Accepting States ($F$)**: `CANCELLED`, `REJECTED`, `COMPLETED`

### Transition Function $\delta(q, \sigma)$

| Current State ($q$) | Input Event ($\sigma$) | Next State $\delta(q, \sigma)$ | Permitted Roles |
| :--- | :--- | :--- | :--- |
| `REQUESTED` | `APPROVE` | `CONFIRMED` | Doctor, Administrator |
| `REQUESTED` | `REJECT` | `REJECTED` (Terminal) | Doctor, Administrator |
| `REQUESTED` | `RESCHEDULE` | `RESCHEDULED` | Patient, Doctor, Administrator |
| `REQUESTED` | `CANCEL` | `CANCELLED` (Terminal) | Patient, Administrator |
| `CONFIRMED` | `RESCHEDULE` | `RESCHEDULED` | Patient, Doctor, Administrator |
| `CONFIRMED` | `CANCEL` | `CANCELLED` (Terminal) | Patient, Doctor, Administrator |
| `CONFIRMED` | `COMPLETE` | `COMPLETED` (Terminal) | Doctor, Administrator |
| `RESCHEDULED` | `APPROVE` | `CONFIRMED` | Doctor, Administrator |
| `RESCHEDULED` | `REJECT` | `REJECTED` (Terminal) | Doctor, Administrator |
| `RESCHEDULED` | `RESCHEDULE` | `RESCHEDULED` | Patient, Doctor, Administrator |
| `RESCHEDULED` | `CANCEL` | `CANCELLED` (Terminal) | Patient, Doctor, Administrator |
| `CANCELLED` / `REJECTED` / `COMPLETED` | Any Event | **Rejected (`HTTP 409 Conflict`)** | None (Terminal State Lock) |

---

## 2. Execution & Testing Instructions

### Backend Setup & Automated Tests
```bash
cd backend
cp .env.example .env
npm run seed
npm start
```

Configure `MONGODB_URI` in `backend/.env` with your MongoDB Atlas connection string and
set `USE_LOCAL_DB=false` to persist application data in Atlas. URL-encode any special
characters in the database password. Set `USE_LOCAL_DB=true` only when intentionally
using the local JSON store.

### Run All Automated Test Suites (DFA Unit, Auth, Integration, Security Audit, 15-Step E2E)
```bash
cd backend
npm test
```

### Frontend Setup & Production Build
```bash
cd frontend
npm run dev
npm run build
```

### Default Seeded Credentials (Password for all: `Hospital@123`)
- **Patient**: `aravind.patient@aegishealth.org`
- **Doctor (Cardiology)**: `ananya.cardio@aegishealth.org`
- **Doctor (Neurology)**: `rajeshwar.neuro@aegishealth.org`
- **Administrator**: `admin@aegishealth.org`
