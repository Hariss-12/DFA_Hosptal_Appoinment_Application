/* === MODULE: api/axiosClient.js === */
/**
 * Centralized Axios HTTP Client (`src/api/axiosClient.js`)
 *
 * Configures:
 * - Base URL from VITE_API_BASE_URL or `/api`
 * - Automatic Bearer JWT header attachment
 * - Standardized error extraction for HTTP 409 DFA transition conflicts, 401/403 RBAC errors, and validation messages
 */

import axios from 'axios';

const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
  '/api';

const axiosClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

axiosClient.interceptors.request.use(
  (config) => {
    try {
      const token = localStorage.getItem('hospital_dfa_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Ignore storage access errors in restricted frames
    }
    return config;
  },
  (error) => Promise.reject(error)
);

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const apiErr = error.response?.data?.error || {};
    const formattedError = {
      status: status || 500,
      message: apiErr.message || error.message || 'Network or server error occurred.',
      code: apiErr.code || 'API_ERROR',
      currentState: apiErr.currentState || null,
      event: apiErr.event || null,
      isTerminal: Boolean(apiErr.isTerminal),
      allowedEvents: apiErr.allowedEvents || [],
    };
    return Promise.reject(formattedError);
  }
);

export default axiosClient;


/* === MODULE: context/AuthContext.jsx === */
/**
 * Authentication & Role-Based Session Context (`src/context/AuthContext.jsx`)
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axiosClient from '../api/axiosClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    try {
      const token = localStorage.getItem('hospital_dfa_token');
      if (!token) {
        setLoading(false);
        return;
      }
      const res = await axiosClient.get('/auth/me');
      setUser(res.data.data.user);
    } catch {
      try {
        localStorage.removeItem('hospital_dfa_token');
      } catch {
        // Ignore storage error
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const login = async (email, password) => {
    const res = await axiosClient.post('/auth/login', { email, password });
    const { token, user: loggedInUser } = res.data.data;
    try {
      localStorage.setItem('hospital_dfa_token', token);
    } catch {
      // Ignore storage error
    }
    setUser(loggedInUser);
    return loggedInUser;
  };

  const registerPatient = async (payload) => {
    const res = await axiosClient.post('/auth/register', payload);
    const { token, user: createdUser } = res.data.data;
    try {
      localStorage.setItem('hospital_dfa_token', token);
    } catch {
      // Ignore storage error
    }
    setUser(createdUser);
    return createdUser;
  };

  const logout = async () => {
    try {
      await axiosClient.post('/auth/logout');
    } catch {
      // Ignore logout network error
    } finally {
      try {
        localStorage.removeItem('hospital_dfa_token');
      } catch {
        // Ignore storage error
      }
      setUser(null);
    }
  };

  const updateProfile = async (payload) => {
    const res = await axiosClient.put('/auth/profile', payload);
    const updatedUser = res.data.data.user;
    setUser((prev) => ({ ...prev, ...updatedUser }));
    return updatedUser;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: Boolean(user),
        login,
        registerPatient,
        logout,
        updateProfile,
        refreshUser: loadSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return ctx;
}


/* === MODULE: components/HospitalComponents.jsx === */
/**
 * Reusable UI Components:
 * - Navbar (Role-based navigation bar)
 * - ProtectedRoute (Enforces authentication + role guard, redirects to /unauthorized on role mismatch)
 * - StatusBadge (Semantic hospital DFA state badge)
 * - DFAStateGraph (Interactive SVG state transition diagram highlighting current state & valid transitions)
 */

import React from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const STATE_STYLES = {
  REQUESTED: {
    bg: 'bg-amber-50 border-amber-300 text-amber-800',
    dot: 'bg-amber-500',
    label: 'REQUESTED (q0)',
  },
  CONFIRMED: {
    bg: 'bg-emerald-50 border-emerald-300 text-emerald-800',
    dot: 'bg-emerald-500',
    label: 'CONFIRMED',
  },
  RESCHEDULED: {
    bg: 'bg-sky-50 border-sky-300 text-sky-800',
    dot: 'bg-sky-500',
    label: 'RESCHEDULED',
  },
  CANCELLED: {
    bg: 'bg-rose-50 border-rose-300 text-rose-800',
    dot: 'bg-rose-500',
    label: 'CANCELLED (Terminal)',
  },
  REJECTED: {
    bg: 'bg-red-50 border-red-300 text-red-800',
    dot: 'bg-red-600',
    label: 'REJECTED (Terminal)',
  },
  COMPLETED: {
    bg: 'bg-indigo-50 border-indigo-300 text-indigo-800',
    dot: 'bg-indigo-600',
    label: 'COMPLETED (Terminal)',
  },
};

export function StatusBadge({ status }) {
  const style = STATE_STYLES[status] || {
    bg: 'bg-slate-100 border-slate-300 text-slate-700',
    dot: 'bg-slate-400',
    label: status || 'UNKNOWN',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${style.bg}`}
    >
      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

export function ProtectedRoute({ allowedRoles, children }) {
  const { user, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-sm font-medium text-teal-700 animate-pulse">
          Verifying hospital session &amp; role permissions...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
}

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();

  const getDashboardLink = () => {
    if (!user) return '/';
    if (user.role === 'Patient') return '/patient/dashboard';
    if (user.role === 'Doctor') return '/doctor/dashboard';
    if (user.role === 'Administrator') return '/admin/dashboard';
    return '/';
  };

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-700 text-white flex items-center justify-center font-bold text-lg">
              A+
            </div>
            <div>
              <span className="font-bold text-slate-900 tracking-tight block leading-none">
                Aegis Health
              </span>
              <span className="text-[11px] text-teal-700 font-mono">
                DFA Appointment System
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-4 text-sm font-medium text-slate-600">
            <Link to="/doctors" className="hover:text-teal-700 transition-colors">
              Doctor Directory
            </Link>
            <Link to="/dfa-visualizer" className="hover:text-teal-700 transition-colors">
              DFA Engine Visualizer
            </Link>
            {isAuthenticated && (
              <>
                <Link to={getDashboardLink()} className="hover:text-teal-700 transition-colors">
                  {user.role} Dashboard
                </Link>
                {user.role === 'Patient' && (
                  <Link to="/appointments/book" className="hover:text-teal-700 transition-colors">
                    Book Appointment
                  </Link>
                )}
                <Link to="/appointments/history" className="hover:text-teal-700 transition-colors">
                  Appointment History
                </Link>
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <>
              <Link
                to="/profile"
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
              >
                {user.name} ({user.role})
              </Link>
              <button
                type="button"
                onClick={logout}
                className="text-xs px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold border border-rose-200"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="text-sm font-medium text-slate-700 hover:text-teal-700 px-3 py-1.5"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="text-sm font-semibold bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 rounded-lg shadow-sm"
              >
                Patient Registration
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function DFAStateGraph({ activeState = 'REQUESTED', lastEvent = null, onSelectState }) {
  const nodes = [
    { id: 'REQUESTED', x: 110, y: 70, label: 'REQUESTED', sub: 'Initial (q0)', terminal: false },
    { id: 'CONFIRMED', x: 350, y: 70, label: 'CONFIRMED', sub: 'Active', terminal: false },
    { id: 'RESCHEDULED', x: 590, y: 70, label: 'RESCHEDULED', sub: 'Active', terminal: false },
    { id: 'REJECTED', x: 110, y: 230, label: 'REJECTED', sub: 'Terminal (F)', terminal: true },
    { id: 'CANCELLED', x: 350, y: 230, label: 'CANCELLED', sub: 'Terminal (F)', terminal: true },
    { id: 'COMPLETED', x: 590, y: 230, label: 'COMPLETED', sub: 'Terminal (F)', terminal: true },
  ];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Formal Automaton State Graph M = (Q, Σ, δ, q0, F)
          </h3>
          <p className="text-xs text-slate-500">
            Active State: <span className="font-mono font-semibold text-teal-700">{activeState}</span>
            {lastEvent ? ` | Last Input Symbol (σ): ${lastEvent}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-teal-600 inline-block" /> Current State
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-slate-200 border border-slate-400 inline-block" /> Active State
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-rose-100 border border-rose-400 inline-block" /> Terminal Lock (F)
          </span>
        </div>
      </div>

      <svg viewBox="0 0 700 295" className="w-full h-auto">
        <defs>
          <marker id="dfa-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 1 L 8 5 L 0 9 z" fill="#475569" />
          </marker>
        </defs>

        {/* Directed Edges */}
        <line x1="185" y1="70" x2="270" y2="70" stroke="#0f766e" strokeWidth="2" markerEnd="url(#dfa-arrow)" />
        <text x="227" y="60" textAnchor="middle" className="text-[10px] fill-teal-800 font-mono">APPROVE</text>

        <line x1="425" y1="58" x2="510" y2="58" stroke="#0284c7" strokeWidth="2" markerEnd="url(#dfa-arrow)" />
        <text x="467" y="49" textAnchor="middle" className="text-[10px] fill-sky-800 font-mono">RESCHEDULE</text>

        <line x1="515" y1="84" x2="430" y2="84" stroke="#0f766e" strokeWidth="2" markerEnd="url(#dfa-arrow)" />
        <text x="467" y="100" textAnchor="middle" className="text-[10px] fill-teal-800 font-mono">APPROVE</text>

        <line x1="110" y1="108" x2="110" y2="186" stroke="#dc2626" strokeWidth="2" markerEnd="url(#dfa-arrow)" />
        <text x="74" y="150" textAnchor="middle" className="text-[10px] fill-red-700 font-mono">REJECT</text>

        <line x1="160" y1="108" x2="310" y2="188" stroke="#e11d48" strokeWidth="1.75" strokeDasharray="4 3" markerEnd="url(#dfa-arrow)" />
        <line x1="350" y1="108" x2="350" y2="186" stroke="#e11d48" strokeWidth="2" markerEnd="url(#dfa-arrow)" />
        <text x="382" y="150" textAnchor="middle" className="text-[10px] fill-rose-700 font-mono">CANCEL</text>

        <line x1="545" y1="108" x2="395" y2="188" stroke="#e11d48" strokeWidth="1.75" strokeDasharray="4 3" markerEnd="url(#dfa-arrow)" />
        <line x1="420" y1="108" x2="565" y2="188" stroke="#4f46e5" strokeWidth="2" markerEnd="url(#dfa-arrow)" />
        <text x="538" y="148" textAnchor="middle" className="text-[10px] fill-indigo-700 font-mono">COMPLETE</text>

        {nodes.map((n) => {
          const isCurrent = n.id === activeState;
          const fill = isCurrent
            ? '#0f766e'
            : n.terminal
            ? '#fff1f2'
            : '#f8fafc';
          const stroke = isCurrent
            ? '#0d9488'
            : n.terminal
            ? '#f43f5e'
            : '#64748b';
          const textFill = isCurrent ? '#ffffff' : '#0f172a';
          const subFill = isCurrent ? '#ccfbf1' : '#64748b';

          return (
            <g
              key={n.id}
              onClick={() => onSelectState && onSelectState(n.id)}
              style={{ cursor: onSelectState ? 'pointer' : 'default' }}
            >
              <rect
                x={n.x - 74}
                y={n.y - 34}
                width="148"
                height="68"
                rx="34"
                fill={fill}
                stroke={stroke}
                strokeWidth={isCurrent ? '3' : '1.75'}
              />
              {n.terminal && (
                <rect
                  x={n.x - 68}
                  y={n.y - 28}
                  width="136"
                  height="56"
                  rx="28"
                  fill="none"
                  stroke={isCurrent ? '#99f6e4' : '#fda4af'}
                  strokeWidth="1.2"
                />
              )}
              <text
                x={n.x}
                y={n.y - 5}
                textAnchor="middle"
                fill={textFill}
                className="text-xs font-bold"
              >
                {n.label}
              </text>
              <text
                x={n.x}
                y={n.y + 13}
                textAnchor="middle"
                fill={subFill}
                className="text-[10px] font-mono"
              >
                {n.sub}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}


/* === MODULE: pages/LandingPage.jsx === */
import React from 'react';
import { Link } from 'react-router-dom';
import { DFAStateGraph } from '../components/HospitalComponents';

export default function LandingPage() {
  return (
    <div className="space-y-12 pb-12">
      <section className="bg-gradient-to-br from-teal-900 via-teal-800 to-slate-900 text-white rounded-2xl p-8 md:p-12 shadow-lg">
        <div className="max-w-3xl space-y-5">
          <span className="inline-block px-3 py-1 rounded-full bg-teal-700/60 border border-teal-400/30 text-xs font-mono uppercase tracking-wider">
            Deterministic Finite Automaton (DFA) Healthcare Platform
          </span>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight">
            Online Hospital Appointment Management System
          </h1>
          <p className="text-teal-100 text-base md:text-lg leading-relaxed">
            Every clinical appointment transitions deterministically through our formal 5-tuple
            state machine M = (Q, Σ, δ, q0, F) with strict role-based access control, optimistic
            concurrency locking, and immutable audit trails.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              to="/doctors"
              className="px-5 py-2.5 rounded-lg bg-white text-teal-900 font-bold text-sm hover:bg-teal-50 shadow"
            >
              Browse Specialist Doctors
            </Link>
            <Link
              to="/register"
              className="px-5 py-2.5 rounded-lg bg-teal-600 text-white font-semibold text-sm border border-teal-400/40 hover:bg-teal-500"
            >
              Register as Patient
            </Link>
            <Link
              to="/dfa-visualizer"
              className="px-5 py-2.5 rounded-lg bg-slate-800/80 text-teal-200 font-mono text-sm border border-slate-600 hover:bg-slate-800"
            >
              Inspect DFA Engine
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-mono uppercase text-teal-700 font-semibold mb-1">
            Formal Automaton Control
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">
            Zero Invalid State Transitions
          </h2>
          <p className="text-sm text-slate-600">
            All state changes pass through δ(q, σ). Invalid transitions and attempts to mutate
            terminal states (CANCELLED, REJECTED, COMPLETED) are rejected with HTTP 409 Conflict.
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-mono uppercase text-teal-700 font-semibold mb-1">
            Concurrency &amp; Double-Booking Guard
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">
            Atomic Slot &amp; Version Locking
          </h2>
          <p className="text-sm text-slate-600">
            Compound partial uniqueness indexes and document version keys (__v) prevent race-condition
            double bookings and concurrent status updates.
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-mono uppercase text-teal-700 font-semibold mb-1">
            Defense-in-Depth RBAC
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">
            Patient, Doctor &amp; Admin Isolation
          </h2>
          <p className="text-sm text-slate-600">
            Strict ownership verification prevents IDOR vulnerabilities while enforcing role-specific
            transition permissions across every endpoint.
          </p>
        </div>
      </section>

      <DFAStateGraph activeState="REQUESTED" />
    </div>
  );
}


/* === MODULE: pages/RegisterPage.jsx === */
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RegisterPage() {
  const { registerPatient } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    dateOfBirth: '',
    gender: 'Male',
    bloodGroup: 'O+',
    address: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.name.trim().length < 2) {
      setError('Full name must be at least 2 characters.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters with uppercase, lowercase, and a number.');
      return;
    }

    try {
      setSubmitting(true);
      await registerPatient(form);
      navigate('/patient/dashboard');
    } catch (err) {
      setError(err.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Patient Registration</h1>
      <p className="text-sm text-slate-500 mb-6">
        Create a secure patient portal account to book and manage hospital appointments.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
            <input
              type="text"
              name="name"
              required
              value={form.name}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="e.g., Giri Sellamuthu"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address *</label>
            <input
              type="email"
              name="email"
              required
              value={form.email}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="patient@example.com"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Password * (Min 8 chars, A-Z, a-z, 0-9)
            </label>
            <input
              type="password"
              name="password"
              required
              value={form.password}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
            <input
              type="text"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="+91-9840012345"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Date of Birth</label>
            <input
              type="date"
              name="dateOfBirth"
              value={form.dateOfBirth}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Gender</label>
            <select
              name="gender"
              value={form.gender}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Group</label>
            <input
              type="text"
              name="bloodGroup"
              value={form.bloodGroup}
              onChange={handleChange}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="O+"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Residential Address</label>
          <input
            type="text"
            name="address"
            value={form.address}
            onChange={handleChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Street, City, State"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm disabled:opacity-50"
        >
          {submitting ? 'Creating Patient Account...' : 'Complete Patient Registration'}
        </button>
      </form>

      <p className="text-xs text-slate-500 mt-4 text-center">
        Already registered?{' '}
        <Link to="/login" className="text-teal-700 font-semibold hover:underline">
          Sign in here
        </Link>
      </p>
    </div>
  );
}


/* === MODULE: pages/LoginPage.jsx === */
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      setSubmitting(true);
      const user = await login(email, password);
      if (user.role === 'Doctor') navigate('/doctor/dashboard');
      else if (user.role === 'Administrator') navigate('/admin/dashboard');
      else navigate('/patient/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemoAccount = (demoEmail) => {
    setEmail(demoEmail);
    setPassword('Hospital@123');
  };

  return (
    <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Hospital Portal Login</h1>
      <p className="text-sm text-slate-500 mb-6">
        Sign in as a Patient, Doctor, or Hospital Administrator.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="name@aegishealth.org"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm disabled:opacity-50"
        >
          {submitting ? 'Authenticating...' : 'Sign In'}
        </button>
      </form>

      <div className="mt-6 pt-5 border-t border-slate-200">
        <div className="text-xs font-semibold text-slate-500 mb-2">
          Quick Seeded Role Credentials (Password: Hospital@123)
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => fillDemoAccount('aravind.patient@aegishealth.org')}
            className="text-xs py-1.5 px-2 rounded bg-slate-100 hover:bg-teal-50 text-slate-700 font-medium border border-slate-200"
          >
            Patient Demo
          </button>
          <button
            type="button"
            onClick={() => fillDemoAccount('ananya.cardio@aegishealth.org')}
            className="text-xs py-1.5 px-2 rounded bg-slate-100 hover:bg-teal-50 text-slate-700 font-medium border border-slate-200"
          >
            Doctor Demo
          </button>
          <button
            type="button"
            onClick={() => fillDemoAccount('admin@aegishealth.org')}
            className="text-xs py-1.5 px-2 rounded bg-slate-100 hover:bg-teal-50 text-slate-700 font-medium border border-slate-200"
          >
            Admin Demo
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 mt-4 text-center">
        New patient?{' '}
        <Link to="/register" className="text-teal-700 font-semibold hover:underline">
          Create a patient account
        </Link>
      </p>
    </div>
  );
}


/* === MODULE: pages/PatientDashboard.jsx === */
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axiosClient from '../api/axiosClient';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, DFAStateGraph } from '../components/HospitalComponents';

export default function PatientDashboard() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [selectedApt, setSelectedApt] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (searchQuery.trim()) params.q = searchQuery.trim();
      const res = await axiosClient.get('/appointments', { params });
      const list = res.data.data.appointments || [];
      setAppointments(list);
      if (list.length > 0 && !selectedApt) {
        setSelectedApt(list[0]);
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery, selectedApt]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const handleCancelAppointment = async (apt) => {
    setFeedback({ type: '', text: '' });
    try {
      const res = await axiosClient.patch(`/appointments/${apt._id}/cancel`, {
        reason: 'Cancelled by patient from Patient Dashboard',
        expectedVersion: apt.__v,
      });
      setFeedback({
        type: 'success',
        text: res.data.message,
      });
      const updated = res.data.data.appointment;
      setSelectedApt(updated);
      fetchAppointments();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: `HTTP ${err.status}: ${err.message}`,
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <span className="text-xs font-mono uppercase text-teal-700 font-semibold">
            Patient Portal
          </span>
          <h1 className="text-2xl font-bold text-slate-900">Welcome, {user?.name}</h1>
          <p className="text-sm text-slate-500">
            Track your appointments, inspect live DFA states, reschedule, or cancel pending visits.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/appointments/book"
            className="px-4 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold shadow-sm"
          >
            + Book New Appointment
          </Link>
          <Link
            to="/appointments/history"
            className="px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold"
          >
            Full Audit History
          </Link>
        </div>
      </div>

      {feedback.text && (
        <div
          className={`p-4 rounded-xl border text-sm font-medium ${
            feedback.type === 'error'
              ? 'bg-rose-50 border-rose-300 text-rose-800'
              : 'bg-emerald-50 border-emerald-300 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {selectedApt && (
        <DFAStateGraph activeState={selectedApt.status} lastEvent={selectedApt.lastEvent} />
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">Your Appointments</h2>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Search code, doctor, reason..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">All DFA States</option>
              <option value="REQUESTED">REQUESTED</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="RESCHEDULED">RESCHEDULED</option>
              <option value="CANCELLED">CANCELLED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="COMPLETED">COMPLETED</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading appointments...</div>
        ) : appointments.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            No appointments found. Click &ldquo;+ Book New Appointment&rdquo; to schedule a visit.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-3 px-3">Code</th>
                  <th className="py-3 px-3">Doctor &amp; Dept</th>
                  <th className="py-3 px-3">Date &amp; Slot</th>
                  <th className="py-3 px-3">Reason</th>
                  <th className="py-3 px-3">DFA State</th>
                  <th className="py-3 px-3">Permitted DFA Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {appointments.map((apt) => {
                  const canReschedule = ['REQUESTED', 'CONFIRMED', 'RESCHEDULED'].includes(apt.status);
                  const canCancel = ['REQUESTED', 'CONFIRMED', 'RESCHEDULED'].includes(apt.status);
                  return (
                    <tr
                      key={apt._id}
                      onClick={() => setSelectedApt(apt)}
                      className={`hover:bg-slate-50 cursor-pointer ${
                        selectedApt?._id === apt._id ? 'bg-teal-50/40' : ''
                      }`}
                    >
                      <td className="py-3 px-3 font-mono text-xs font-semibold text-slate-800">
                        {apt.appointmentCode}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">{apt.doctorId?.name}</div>
                        <div className="text-xs text-slate-500">{apt.doctorId?.specialization}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900">{apt.appointmentDate}</div>
                        <div className="text-xs font-mono text-teal-700">{apt.timeSlot}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-600 max-w-xs truncate">{apt.reason}</td>
                      <td className="py-3 px-3">
                        <StatusBadge status={apt.status} />
                      </td>
                      <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-2">
                          {canReschedule && (
                            <Link
                              to={`/appointments/${apt._id}/reschedule`}
                              className="px-2.5 py-1 rounded bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-semibold"
                            >
                              RESCHEDULE
                            </Link>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => handleCancelAppointment(apt)}
                              className="px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold"
                            >
                              CANCEL
                            </button>
                          )}
                          <Link
                            to={`/appointments/history?appointmentId=${apt._id}`}
                            className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
                          >
                            Audit Log
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


/* === MODULE: pages/DoctorDashboard.jsx === */
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axiosClient from '../api/axiosClient';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, DFAStateGraph } from '../components/HospitalComponents';

export default function DoctorDashboard() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [doctorProfile, setDoctorProfile] = useState(null);
  const [selectedApt, setSelectedApt] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const [loading, setLoading] = useState(true);

  const loadDoctorWorkspace = useCallback(async () => {
    try {
      setLoading(true);
      const [meRes, aptRes] = await Promise.all([
        axiosClient.get('/auth/me'),
        axiosClient.get('/appointments', {
          params: statusFilter ? { status: statusFilter } : {},
        }),
      ]);
      setDoctorProfile(meRes.data.data.user.doctorProfile || null);
      const list = aptRes.data.data.appointments || [];
      setAppointments(list);
      if (list.length > 0 && !selectedApt) {
        setSelectedApt(list[0]);
      }
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, selectedApt]);

  useEffect(() => {
    loadDoctorWorkspace();
  }, [loadDoctorWorkspace]);

  const triggerDFAEvent = async (apt, endpoint, reasonText) => {
    setFeedback({ type: '', text: '' });
    try {
      const res = await axiosClient.patch(`/appointments/${apt._id}/${endpoint}`, {
        reason: reasonText,
        expectedVersion: apt.__v,
      });
      setFeedback({ type: 'success', text: res.data.message });
      setSelectedApt(res.data.data.appointment);
      loadDoctorWorkspace();
    } catch (err) {
      setFeedback({ type: 'error', text: `HTTP ${err.status}: ${err.message}` });
    }
  };

  const toggleDoctorAvailability = async () => {
    if (!doctorProfile) return;
    try {
      const res = await axiosClient.put(`/doctors/${doctorProfile._id}/availability`, {
        isAvailable: !doctorProfile.isAvailable,
      });
      setDoctorProfile(res.data.data.doctor);
      setFeedback({
        type: 'success',
        text: `Consultation availability updated to ${res.data.data.doctor.isAvailable ? 'ACTIVE' : 'PAUSED'}.`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <span className="text-xs font-mono uppercase text-teal-700 font-semibold">
            Clinical Doctor Console
          </span>
          <h1 className="text-2xl font-bold text-slate-900">{user?.name}</h1>
          <p className="text-sm text-slate-500">
            {doctorProfile
              ? `${doctorProfile.specialization} • ${doctorProfile.department} • Room ${doctorProfile.roomNumber}`
              : 'Execute DFA transitions (APPROVE, REJECT, COMPLETE, RESCHEDULE, CANCEL) on assigned patient appointments.'}
          </p>
        </div>

        {doctorProfile && (
          <button
            type="button"
            onClick={toggleDoctorAvailability}
            className={`px-4 py-2 rounded-lg text-xs font-bold border ${
              doctorProfile.isAvailable
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-rose-50 border-rose-300 text-rose-800'
            }`}
          >
            Status: {doctorProfile.isAvailable ? 'Available for Booking' : 'Unavailable'} (Toggle)
          </button>
        )}
      </div>

      {feedback.text && (
        <div
          className={`p-4 rounded-xl border text-sm font-medium ${
            feedback.type === 'error'
              ? 'bg-rose-50 border-rose-300 text-rose-800'
              : 'bg-emerald-50 border-emerald-300 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {selectedApt && (
        <DFAStateGraph activeState={selectedApt.status} lastEvent={selectedApt.lastEvent} />
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">Assigned Patient Appointments</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">All DFA States</option>
            <option value="REQUESTED">REQUESTED</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="RESCHEDULED">RESCHEDULED</option>
            <option value="CANCELLED">CANCELLED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="COMPLETED">COMPLETED</option>
          </select>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading assigned queue...</div>
        ) : appointments.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            No appointments matching the selected filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-3 px-3">Code</th>
                  <th className="py-3 px-3">Patient</th>
                  <th className="py-3 px-3">Date &amp; Slot</th>
                  <th className="py-3 px-3">Reason</th>
                  <th className="py-3 px-3">Current DFA State</th>
                  <th className="py-3 px-3">Doctor DFA Transitions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {appointments.map((apt) => {
                  const canApprove = ['REQUESTED', 'RESCHEDULED'].includes(apt.status);
                  const canReject = ['REQUESTED', 'RESCHEDULED'].includes(apt.status);
                  const canComplete = apt.status === 'CONFIRMED';
                  const canCancel = ['CONFIRMED', 'RESCHEDULED'].includes(apt.status);
                  const canReschedule = ['REQUESTED', 'CONFIRMED', 'RESCHEDULED'].includes(apt.status);

                  return (
                    <tr
                      key={apt._id}
                      onClick={() => setSelectedApt(apt)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="py-3 px-3 font-mono text-xs font-semibold">
                        {apt.appointmentCode}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">{apt.patientId?.name}</div>
                        <div className="text-xs text-slate-500">{apt.patientId?.email}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900">{apt.appointmentDate}</div>
                        <div className="text-xs font-mono text-teal-700">{apt.timeSlot}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-600 max-w-xs truncate">{apt.reason}</td>
                      <td className="py-3 px-3">
                        <StatusBadge status={apt.status} />
                      </td>
                      <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-1.5">
                          {canApprove && (
                            <button
                              type="button"
                              onClick={() =>
                                triggerDFAEvent(apt, 'approve', 'Approved by attending physician')
                              }
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                            >
                              APPROVE
                            </button>
                          )}
                          {canReject && (
                            <button
                              type="button"
                              onClick={() =>
                                triggerDFAEvent(apt, 'reject', 'Rejected due to emergency schedule conflict')
                              }
                              className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                            >
                              REJECT
                            </button>
                          )}
                          {canComplete && (
                            <button
                              type="button"
                              onClick={() =>
                                triggerDFAEvent(apt, 'complete', 'Clinical consultation completed')
                              }
                              className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
                            >
                              COMPLETE
                            </button>
                          )}
                          {canReschedule && (
                            <Link
                              to={`/appointments/${apt._id}/reschedule`}
                              className="px-2.5 py-1 rounded bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-semibold"
                            >
                              RESCHEDULE
                            </Link>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() =>
                                triggerDFAEvent(apt, 'cancel', 'Cancelled by attending physician')
                              }
                              className="px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold"
                            >
                              CANCEL
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


/* === MODULE: pages/AdminDashboard.jsx === */
import React, { useEffect, useState, useCallback } from 'react';
import axiosClient from '../api/axiosClient';
import { StatusBadge } from '../components/HospitalComponents';

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axiosClient.get('/admin/overview');
      setOverview(res.data.data);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  if (loading) {
    return <div className="py-12 text-center text-sm text-slate-500">Loading Hospital Administration Overview...</div>;
  }

  const metrics = overview?.metrics || {};
  const stateCounts = metrics.stateCounts || {};

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-xs font-mono uppercase text-teal-700 font-semibold">
          Hospital Administration &amp; Governance
        </span>
        <h1 className="text-2xl font-bold text-slate-900">Administrator Dashboard</h1>
        <p className="text-sm text-slate-500">
          Monitor hospital-wide appointment states, audit immutable DFA transition logs, and oversee clinical staff.
          Administrators cannot bypass DFA transition rules.
        </p>
      </div>

      {feedback.text && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {Object.entries(stateCounts).map(([state, count]) => (
          <div key={state} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-mono text-slate-500">{state}</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{count}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 mb-4">
          Recent Global DFA State Transition Audit Trail
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Actor &amp; Role</th>
                <th className="py-2.5 px-3">Previous State (q)</th>
                <th className="py-2.5 px-3">Event (σ)</th>
                <th className="py-2.5 px-3">Next State δ(q, σ)</th>
                <th className="py-2.5 px-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(overview?.recentHistory || []).map((h) => (
                <tr key={h._id}>
                  <td className="py-2.5 px-3 text-xs font-mono text-slate-500">
                    {new Date(h.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="font-semibold text-slate-900">{h.actorName}</span>{' '}
                    <span className="text-xs text-teal-700 font-mono">({h.actorRole})</span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-xs">{h.previousState}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded bg-slate-100 font-mono text-xs font-bold text-slate-800">
                      {h.event}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <StatusBadge status={h.nextState} />
                  </td>
                  <td className="py-2.5 px-3 text-xs text-slate-600">{h.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


/* === MODULE: pages/DoctorDirectoryPage.jsx === */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axiosClient from '../api/axiosClient';

export default function DoctorDirectoryPage() {
  const [doctors, setDoctors] = useState([]);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        setLoading(true);
        const params = {};
        if (search.trim()) params.q = search.trim();
        if (department) params.department = department;
        const res = await axiosClient.get('/doctors', { params });
        setDoctors(res.data.data.doctors || []);
      } finally {
        setLoading(false);
      }
    };
    fetchDoctors();
  }, [search, department]);

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hospital Specialist Directory</h1>
          <p className="text-sm text-slate-500">
            Browse verified attending physicians, check working days, and book available OPD slots.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search doctor or specialization..."
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All Departments</option>
            <option value="Cardiology">Cardiology</option>
            <option value="Neurology">Neurology</option>
            <option value="Orthopaedics">Orthopaedics</option>
            <option value="General Medicine">General Medicine</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-500">Loading specialist directory...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {doctors.map((doc) => (
            <div
              key={doc._id}
              className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-mono uppercase text-teal-700 font-semibold">
                      {doc.department} • Room {doc.roomNumber}
                    </span>
                    <h2 className="text-lg font-bold text-slate-900 mt-0.5">{doc.name}</h2>
                    <p className="text-xs text-slate-500">
                      {doc.qualification} • {doc.experienceYears} yrs experience
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                      doc.isAvailable
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {doc.isAvailable ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                <p className="text-sm text-slate-600 mt-3">{doc.bio}</p>
                <div className="mt-3 text-xs text-slate-500">
                  <strong>Consultation Fee:</strong> ₹{doc.consultationFee} |{' '}
                  <strong>Working Days:</strong> {(doc.availableDays || []).join(', ')}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  {(doc.availableSlots || []).length} daily slots configured
                </div>
                <Link
                  to={`/appointments/book?doctorId=${doc._id}`}
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                >
                  Select &amp; Check Slots
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


/* === MODULE: pages/BookAppointmentPage.jsx === */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axiosClient from '../api/axiosClient';

export default function BookAppointmentPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const initialDoctorId = searchParams.get('doctorId') || '';
  const defaultTomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState(initialDoctorId);
  const [appointmentDate, setAppointmentDate] = useState(defaultTomorrow);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [bookedSlots, setBookedSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [reason, setReason] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    axiosClient.get('/doctors').then((res) => {
      const list = res.data.data.doctors || [];
      setDoctors(list);
      if (!doctorId && list.length > 0) {
        setDoctorId(list[0]._id);
      }
    });
  }, [doctorId]);

  useEffect(() => {
    if (!doctorId || !appointmentDate) return;
    axiosClient
      .get(`/doctors/${doctorId}/slots`, { params: { date: appointmentDate } })
      .then((res) => {
        const slotData = res.data.data;
        setAvailableSlots(slotData.availableSlots || []);
        setBookedSlots(slotData.bookedSlots || []);
        setSelectedSlot(slotData.availableSlots?.[0] || '');
      })
      .catch((err) => {
        setError(err.message);
      });
  }, [doctorId, appointmentDate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!doctorId || !appointmentDate || !selectedSlot || !reason.trim()) {
      setError('Please select a doctor, date, available time slot, and clinical reason.');
      return;
    }

    try {
      setSubmitting(true);
      await axiosClient.post('/appointments', {
        doctorId,
        appointmentDate,
        timeSlot: selectedSlot,
        reason: reason.trim(),
        symptoms: symptoms.trim(),
      });
      navigate('/patient/dashboard');
    } catch (err) {
      setError(`HTTP ${err.status}: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-6">
      <div>
        <span className="text-xs font-mono uppercase text-teal-700 font-semibold">
          DFA Initial State Entry (q0 = REQUESTED)
        </span>
        <h1 className="text-2xl font-bold text-slate-900">Book Hospital Appointment</h1>
        <p className="text-sm text-slate-500">
          Select an attending specialist and a verified free slot. New bookings enter the DFA in
          state <code className="font-mono text-teal-700 font-bold">REQUESTED</code>.
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Select Specialist Doctor *
          </label>
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {doctors.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name} — {d.specialization} ({d.department}) • ₹{d.consultationFee}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Appointment Date (YYYY-MM-DD) *
          </label>
          <input
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={appointmentDate}
            onChange={(e) => setAppointmentDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">
            Available Time Slots ({availableSlots.length} free, {bookedSlots.length} booked) *
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {availableSlots.map((slot) => (
              <button
                type="button"
                key={slot}
                onClick={() => setSelectedSlot(slot)}
                className={`py-2 px-3 rounded-lg text-xs font-mono font-semibold border transition ${
                  selectedSlot === slot
                    ? 'bg-teal-700 text-white border-teal-700'
                    : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-teal-50'
                }`}
              >
                {slot}
              </button>
            ))}
            {bookedSlots.map((slot) => (
              <button
                type="button"
                key={slot}
                disabled
                className="py-2 px-3 rounded-lg text-xs font-mono bg-rose-50 text-rose-400 border border-rose-200 line-through cursor-not-allowed"
              >
                {slot} (Booked)
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Clinical Reason for Visit *
          </label>
          <input
            type="text"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="e.g., Annual cardiac screening and ECG evaluation"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Symptoms / Additional Notes
          </label>
          <textarea
            rows={2}
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Describe any symptoms or prior reports..."
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !selectedSlot}
          className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm disabled:opacity-50"
        >
          {submitting ? 'Submitting Booking Request...' : 'Confirm Booking'}
        </button>
      </form>
    </div>
  );
}


/* === MODULE: pages/RescheduleAppointmentPage.jsx === */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axiosClient from '../api/axiosClient';
import { StatusBadge } from '../components/HospitalComponents';

export default function RescheduleAppointmentPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [appointment, setAppointment] = useState(null);
  const [appointmentDate, setAppointmentDate] = useState('');
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    axiosClient
      .get(`/appointments/${id}`)
      .then((res) => {
        const apt = res.data.data.appointment;
        setAppointment(apt);
        setAppointmentDate(apt.appointmentDate);
        setSelectedSlot(apt.timeSlot);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    if (!appointment || !appointmentDate) return;
    const docId = appointment.doctorId?._id || appointment.doctorId;
    axiosClient
      .get(`/doctors/${docId}/slots`, { params: { date: appointmentDate } })
      .then((res) => {
        const slots = res.data.data.availableSlots || [];
        setAvailableSlots(slots);
        if (slots.length > 0 && !slots.includes(selectedSlot)) {
          setSelectedSlot(slots[0]);
        }
      })
      .catch((err) => setError(err.message));
  }, [appointment, appointmentDate, selectedSlot]);

  const handleReschedule = async (e) => {
    e.preventDefault();
    setError('');
    try {
      setSubmitting(true);
      await axiosClient.patch(`/appointments/${id}/reschedule`, {
        appointmentDate,
        timeSlot: selectedSlot,
        reason: reason.trim() || 'Rescheduled via portal',
        expectedVersion: appointment?.__v,
      });
      navigate(-1);
    } catch (err) {
      setError(`HTTP ${err.status}: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!appointment && !error) {
    return <div className="py-12 text-center text-sm text-slate-500">Loading appointment...</div>;
  }

  return (
    <div className="max-w-xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-6">
      <div>
        <span className="text-xs font-mono uppercase text-sky-700 font-semibold">
          DFA Transition Event: σ = RESCHEDULE → RESCHEDULED
        </span>
        <h1 className="text-2xl font-bold text-slate-900">Reschedule Appointment</h1>
        {appointment && (
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
            <span>Code: {appointment.appointmentCode}</span>
            <StatusBadge status={appointment.status} />
          </div>
        )}
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleReschedule} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            New Appointment Date (YYYY-MM-DD) *
          </label>
          <input
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={appointmentDate}
            onChange={(e) => setAppointmentDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">
            Select New Available Time Slot *
          </label>
          <div className="grid grid-cols-3 gap-2">
            {availableSlots.map((slot) => (
              <button
                type="button"
                key={slot}
                onClick={() => setSelectedSlot(slot)}
                className={`py-2 px-3 rounded-lg text-xs font-mono font-semibold border ${
                  selectedSlot === slot
                    ? 'bg-sky-700 text-white border-sky-700'
                    : 'bg-slate-50 text-slate-700 border-slate-300'
                }`}
              >
                {slot}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Reason for Rescheduling *
          </label>
          <input
            type="text"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="e.g., Travel schedule adjustment"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !selectedSlot}
          className="w-full py-2.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold text-sm disabled:opacity-50"
        >
          {submitting ? 'Applying DFA Transition...' : 'Trigger RESCHEDULE Event'}
        </button>
      </form>
    </div>
  );
}


/* === MODULE: pages/AppointmentHistoryPage.jsx === */
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axiosClient from '../api/axiosClient';
import { StatusBadge, DFAStateGraph } from '../components/HospitalComponents';

export default function AppointmentHistoryPage() {
  const [searchParams] = useSearchParams();
  const initialAptId = searchParams.get('appointmentId') || '';

  const [appointments, setAppointments] = useState([]);
  const [selectedId, setSelectedId] = useState(initialAptId);
  const [historyData, setHistoryData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axiosClient.get('/appointments').then((res) => {
      const list = res.data.data.appointments || [];
      setAppointments(list);
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0]._id);
      }
      setLoading(false);
    });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    axiosClient.get(`/appointments/${selectedId}/history`).then((res) => {
      setHistoryData(res.data.data);
    });
  }, [selectedId]);

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-mono uppercase text-teal-700 font-semibold">
            Immutable State Transition Log
          </span>
          <h1 className="text-2xl font-bold text-slate-900">Appointment State History</h1>
          <p className="text-sm text-slate-500">
            Every valid transition δ(q, σ) → q&apos; is recorded chronologically with actor role and version number.
          </p>
        </div>

        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {appointments.map((a) => (
            <option key={a._id} value={a._id}>
              {a.appointmentCode} — {a.doctorId?.name} ({a.appointmentDate} {a.timeSlot}) [{a.status}]
            </option>
          ))}
        </select>
      </div>

      {historyData && <DFAStateGraph activeState={historyData.currentState} />}

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 mb-4">
          Chronological Transition Trace ({historyData?.history?.length || 0} transitions)
        </h2>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading transition trace...</div>
        ) : !historyData?.history?.length ? (
          <div className="py-8 text-center text-sm text-slate-500">No history records found.</div>
        ) : (
          <div className="space-y-3">
            {historyData.history.map((item, idx) => (
              <div
                key={item._id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-bold">
                      Step #{idx + 1} (v{item.versionAfter})
                    </span>
                    <span className="font-semibold text-slate-700">{item.previousState}</span>
                    <span>──[{item.event}]──►</span>
                    <StatusBadge status={item.nextState} />
                  </div>
                  <p className="text-sm text-slate-800 font-medium">{item.reason}</p>
                  <p className="text-xs text-slate-500">
                    Triggered by <strong>{item.actorName}</strong> ({item.actorRole}) • Slot:{' '}
                    {item.appointmentDate} at {item.timeSlot}
                  </p>
                </div>
                <div className="text-xs font-mono text-slate-500">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


/* === MODULE: pages/DFAVisualizationPage.jsx === */
import React, { useEffect, useState } from 'react';
import axiosClient from '../api/axiosClient';
import { DFAStateGraph, StatusBadge } from '../components/HospitalComponents';

export default function DFAVisualizationPage() {
  const [definition, setDefinition] = useState(null);
  const [simState, setSimState] = useState('REQUESTED');
  const [simLastEvent, setSimLastEvent] = useState(null);
  const [simResult, setSimResult] = useState(null);

  useEffect(() => {
    axiosClient.get('/dfa/definition').then((res) => {
      setDefinition(res.data.data);
    });
  }, []);

  const triggerSimulatedEvent = (event) => {
    if (!definition) return;
    const isTerminal = definition.tuple.F.includes(simState);
    if (isTerminal) {
      setSimResult({
        valid: false,
        httpStatus: 409,
        message: `HTTP 409 Conflict: State '${simState}' is in terminal set F = {CANCELLED, REJECTED, COMPLETED}. No further transitions allowed.`,
      });
      return;
    }

    const match = definition.transitions.find(
      (t) => t.fromState === simState && t.event === event
    );

    if (!match) {
      setSimResult({
        valid: false,
        httpStatus: 409,
        message: `HTTP 409 Conflict: Transition δ(${simState}, ${event}) is undefined in the DFA transition table.`,
      });
      return;
    }

    setSimState(match.toState);
    setSimLastEvent(event);
    setSimResult({
      valid: true,
      httpStatus: 200,
      message: `Valid Transition: δ(${match.fromState}, ${event}) = ${match.toState}. Permitted Roles: ${match.allowedRoles.join(', ')}.`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <span className="text-xs font-mono uppercase text-teal-700 font-semibold">
          Formal Languages &amp; Automata Theory (FLAT) Module
        </span>
        <h1 className="text-2xl font-bold text-slate-900">
          Interactive Deterministic Finite Automaton (DFA) Visualizer
        </h1>
        <p className="text-sm text-slate-500">
          Click any state node or trigger an input symbol σ ∈ Σ to test how the backend DFA engine
          evaluates δ(q, σ) and rejects invalid or terminal transitions with HTTP 409 Conflict.
        </p>
      </div>

      <DFAStateGraph
        activeState={simState}
        lastEvent={simLastEvent}
        onSelectState={(s) => {
          setSimState(s);
          setSimLastEvent(null);
          setSimResult(null);
        }}
      />

      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-slate-800">Current Simulator State (q):</span>
            <StatusBadge status={simState} />
          </div>
          <button
            type="button"
            onClick={() => {
              setSimState('REQUESTED');
              setSimLastEvent(null);
              setSimResult(null);
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-mono font-semibold"
          >
            Reset to Initial State (q0 = REQUESTED)
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {['APPROVE', 'RESCHEDULE', 'CANCEL', 'REJECT', 'COMPLETE'].map((ev) => (
            <button
              key={ev}
              type="button"
              onClick={() => triggerSimulatedEvent(ev)}
              className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-mono font-bold"
            >
              Send Input σ = {ev}
            </button>
          ))}
        </div>

        {simResult && (
          <div
            className={`p-4 rounded-xl border text-sm font-mono ${
              simResult.valid
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : 'bg-rose-50 border-rose-300 text-rose-900'
            }`}
          >
            {simResult.message}
          </div>
        )}
      </div>
    </div>
  );
}


/* === MODULE: pages/ProfileSettingsPage.jsx === */
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function ProfileSettingsPage() {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    dateOfBirth: user?.dateOfBirth || '',
    gender: user?.gender || 'Male',
    bloodGroup: user?.bloodGroup || '',
    address: user?.address || '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      await updateProfile(form);
      setMessage('Profile settings updated successfully.');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-xl mx-auto bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Profile Settings</h1>
        <p className="text-sm text-slate-500">
          Account Email: <span className="font-mono">{user?.email}</span> | Role:{' '}
          <span className="font-mono font-semibold text-teal-700">{user?.role}</span> (Immutable)
        </p>
      </div>

      {message && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
          {message}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Group</label>
            <input
              type="text"
              value={form.bloodGroup}
              onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
          <input
            type="text"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
        >
          Save Profile Changes
        </button>
      </form>
    </div>
  );
}


/* === MODULE: pages/UnauthorizedPage.jsx === */
import { UnauthorizedPage } from './ErrorPages';
export default UnauthorizedPage;


/* === MODULE: pages/NotFoundPage.jsx === */
import { NotFoundPage } from './ErrorPages';
export default NotFoundPage;


/* === MODULE: App.jsx === */
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Navbar, ProtectedRoute } from './components/HospitalComponents';

import LandingPage from './pages/LandingPage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import PatientDashboard from './pages/PatientDashboard';
import DoctorDashboard from './pages/DoctorDashboard';
import AdminDashboard from './pages/AdminDashboard';
import DoctorDirectoryPage from './pages/DoctorDirectoryPage';
import BookAppointmentPage from './pages/BookAppointmentPage';
import RescheduleAppointmentPage from './pages/RescheduleAppointmentPage';
import AppointmentHistoryPage from './pages/AppointmentHistoryPage';
import DFAVisualizationPage from './pages/DFAVisualizationPage';
import ProfileSettingsPage from './pages/ProfileSettingsPage';
import { UnauthorizedPage, NotFoundPage } from './pages/ErrorPages';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
          <Navbar />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/doctors" element={<DoctorDirectoryPage />} />
              <Route path="/dfa-visualizer" element={<DFAVisualizationPage />} />
              <Route path="/unauthorized" element={<UnauthorizedPage />} />

              {/* Role-Protected Dashboards */}
              <Route
                path="/patient/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['Patient']}>
                    <PatientDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/doctor/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['Doctor']}>
                    <DoctorDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/dashboard"
                element={
                  <ProtectedRoute allowedRoles={['Administrator']}>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Protected Appointment & Profile Routes */}
              <Route
                path="/appointments/book"
                element={
                  <ProtectedRoute allowedRoles={['Patient', 'Administrator']}>
                    <BookAppointmentPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/appointments/:id/reschedule"
                element={
                  <ProtectedRoute allowedRoles={['Patient', 'Doctor', 'Administrator']}>
                    <RescheduleAppointmentPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/appointments/history"
                element={
                  <ProtectedRoute allowedRoles={['Patient', 'Doctor', 'Administrator']}>
                    <AppointmentHistoryPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute allowedRoles={['Patient', 'Doctor', 'Administrator']}>
                    <ProfileSettingsPage />
                  </ProtectedRoute>
                }
              />

              {/* 404 Fallback */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}


/* === MODULE: main.jsx === */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
