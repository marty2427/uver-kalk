import React, { useState, useMemo, useRef, useLayoutEffect } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

// ════════════════════════════════════════════════════════════════════
//  POMOCNÉ FUNKCE
// ════════════════════════════════════════════════════════════════════

const fmtCZK = (v) =>
  new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(Math.round(v || 0));

const fmtNum = (v) => {
  if (v === null || v === undefined || isNaN(v)) return '';
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(v);
};

const fmtPct = (v) => `${v.toFixed(1).replace('.', ',')} %`;
const fmtPct2 = (v) => `${v.toFixed(2).replace('.', ',')} %`;

const parseNum = (s) => {
  if (s === null || s === undefined || s === '') return 0;
  // Ořezáváme bílé znaky, NBSP, narrow NBSP a mínus — všechny vstupy
  // této kalkulačky jsou věcně nezáporné částky, případné záporné hodnoty
  // by jen vyrobily nesmyslnou matematiku.
  const cleaned = String(s).replace(/[\s\u00A0\u202F-]/g, '').replace(',', '.');
  const n = Number(cleaned);
  return isNaN(n) || n < 0 ? 0 : n;
};

// ════════════════════════════════════════════════════════════════════
//  MATEMATIKA — ÚVĚR (anuita)
// ════════════════════════════════════════════════════════════════════

function annuityMonthly(principal, annualRatePct, years) {
  if (years <= 0 || principal <= 0) return 0;
  const months = years * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

function amortize(principal, annualRatePct, years) {
  const months = Math.max(0, Math.round(years * 12));
  const r = annualRatePct / 100 / 12;
  const baseM = annuityMonthly(principal, annualRatePct, years);

  let balance = principal;
  let cumInt = 0;
  let cumPrin = 0;
  const yearly = [{
    year: 0, balance, interest: 0, principal: 0,
    cumInterest: 0, cumPrincipal: 0, totalPaid: 0,
  }];
  let yInt = 0, yPrin = 0, yTotal = 0;

  for (let m = 1; m <= months && balance > 0.01; m++) {
    const interest = balance * r;
    let principalPaid = baseM - interest;
    if (principalPaid < 0) principalPaid = 0;
    if (principalPaid > balance) principalPaid = balance;
    balance -= principalPaid;
    const monthPaid = baseM;

    cumInt += interest;
    cumPrin += principalPaid;
    yInt += interest;
    yPrin += principalPaid;
    yTotal += monthPaid;

    if (m % 12 === 0 || balance <= 0.01) {
      yearly.push({
        year: Math.ceil(m / 12),
        balance: Math.max(0, balance),
        interest: yInt,
        principal: yPrin,
        cumInterest: cumInt,
        cumPrincipal: cumPrin,
        totalPaid: yTotal,
      });
      yInt = 0; yPrin = 0; yTotal = 0;
      if (balance <= 0.01) break;
    }
  }

  return {
    yearly,
    baseMonthly: baseM,
    totalInterest: cumInt,
    totalPrincipal: cumPrin,
    totalPaid: cumInt + cumPrin,
  };
}

// ════════════════════════════════════════════════════════════════════
//  MATEMATIKA — ÚVĚR vs INVESTICE
// ════════════════════════════════════════════════════════════════════

function simulateLoanVsInvest({ price, cash, loanRate, loanYears, investReturn, mode }) {
  const months = Math.max(1, Math.round(loanYears * 12));
  const r_inv = Math.pow(1 + investReturn / 100, 1 / 12) - 1;
  const r_loan = loanRate / 100 / 12;
  const loanAmount = price;
  const M = annuityMonthly(loanAmount, loanRate, loanYears);

  let p1 = Math.max(0, cash - price);
  let p2 = cash;
  let loanBalance = loanAmount;

  const data = [{
    year: 0, p1, p2, loanBalance,
    netWealth1: p1, netWealth2: p2 - loanBalance, monthlyM: M,
  }];

  for (let m = 1; m <= months; m++) {
    p1 *= 1 + r_inv;
    p2 *= 1 + r_inv;

    if (mode === 'income') {
      p1 += M;
    } else {
      p2 -= M;
      if (p2 < 0) p2 = 0;
    }

    const interest = loanBalance * r_loan;
    let principalPaid = M - interest;
    if (principalPaid > loanBalance) principalPaid = loanBalance;
    loanBalance -= principalPaid;
    if (loanBalance < 0) loanBalance = 0;

    if (m % 12 === 0 || m === months) {
      data.push({
        year: +(m / 12).toFixed(4),
        p1, p2, loanBalance,
        netWealth1: p1,
        netWealth2: p2 - loanBalance,
        monthlyM: M,
      });
    }
  }

  return { data, monthlyPayment: M, loanAmount };
}

function findBreakEvenReturn(params) {
  const compare = (r) => {
    const sim = simulateLoanVsInvest({ ...params, investReturn: r });
    const final = sim.data[sim.data.length - 1];
    return final.netWealth2 - final.netWealth1;
  };
  let low = -5;
  let high = 30;
  let safety = 0;
  while (compare(high) < 0 && high < 200 && safety < 30) { high *= 1.5; safety++; }
  if (compare(high) < 0) return null;
  if (compare(low) >= 0) return low;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (compare(mid) < 0) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

// ════════════════════════════════════════════════════════════════════
//  UI KOMPONENTY
// ════════════════════════════════════════════════════════════════════

function ChevronToggle({ open }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <span style={{
        color: '#A84E2E', fontSize: '11px', textTransform: 'uppercase',
        letterSpacing: '0.18em', fontWeight: 500,
      }}>
        {open ? 'Skrýt' : 'Zobrazit'}
      </span>
      <span style={{
        width: '40px', height: '40px', borderRadius: '9999px',
        backgroundColor: '#FFFFFF', border: '1px solid rgba(217, 119, 87, 0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 6px rgba(217, 119, 87, 0.15)',
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="#D97757" strokeWidth="1.75"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  );
}

function ModernToggle({ value, onChange, options }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', padding: '6px',
      backgroundColor: '#F0E5D0', borderRadius: '9999px',
      border: '2px solid #A47148', boxShadow: 'inset 0 2px 5px rgba(60,40,20,0.12)',
      flexWrap: 'wrap', gap: '4px',
    }}>
      {options.map((opt, idx) => {
        const isActive = value === opt.value;
        const isHover = hoverIdx === idx;
        const activeStyle = {
          background: 'linear-gradient(180deg, #D87358 0%, #BE5530 100%)',
          color: '#FFFFFF',
          textShadow: '0 1px 3px rgba(70, 25, 5, 0.55)',
          border: '1.5px solid #9A4623',
          boxShadow: '0 5px 18px rgba(190, 85, 48, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.25)',
          fontWeight: 800,
        };
        const inactiveStyle = {
          background: isHover ? 'rgba(255, 255, 255, 0.75)' : 'transparent',
          color: '#1C1917', border: '1.5px solid transparent',
          boxShadow: 'none', textShadow: 'none', fontWeight: 700,
        };
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
            style={{
              padding: '12px 28px', fontSize: '15px', letterSpacing: '0.02em',
              whiteSpace: 'nowrap', borderRadius: '9999px', cursor: 'pointer',
              transition: 'all 220ms ease', fontFamily: "'Inter', system-ui, sans-serif",
              ...(isActive ? activeStyle : inactiveStyle),
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function NumberInput({ label, value, onChange, suffix, hint }) {
  const inputRef = useRef(null);
  const cursorTarget = useRef(null);

  useLayoutEffect(() => {
    if (cursorTarget.current !== null && inputRef.current) {
      const formatted = fmtNum(value);
      let pos = 0;
      let digits = 0;
      while (digits < cursorTarget.current && pos < formatted.length) {
        if (/\d/.test(formatted[pos])) digits++;
        pos++;
      }
      inputRef.current.setSelectionRange(pos, pos);
      cursorTarget.current = null;
    }
  });

  const handleChange = (e) => {
    const newVal = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    const digitsBeforeCursor = (newVal.slice(0, cursorPos).match(/\d/g) || []).length;
    cursorTarget.current = digitsBeforeCursor;
    onChange(parseNum(newVal));
  };

  return (
    <div>
      <label style={{
        display: 'block', fontSize: '11px', textTransform: 'uppercase',
        letterSpacing: '0.18em', color: '#78716C', marginBottom: '8px', fontWeight: 500,
      }}>
        {label}
      </label>
      <div className="ms-input-wrapper" style={{
        display: 'flex', alignItems: 'stretch', backgroundColor: '#FFFFFF',
        border: '1px solid #E5DDD0', borderRadius: '6px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)', transition: 'all 0.2s ease',
      }}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={fmtNum(value)}
          onFocus={(e) => setTimeout(() => e.target.select(), 0)}
          onChange={handleChange}
          style={{
            flex: 1, background: 'transparent', padding: '12px 14px', color: '#1C1917',
            outline: 'none', fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: '22px', fontVariantNumeric: 'tabular-nums',
            border: 'none', minWidth: 0, width: '100%',
          }}
        />
        {suffix && (
          <span style={{
            padding: '0 14px', display: 'flex', alignItems: 'center', color: '#A47148',
            fontSize: '14px', borderLeft: '1px solid #E5DDD0', fontWeight: 500,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <p style={{
          fontSize: '11px', color: '#78716C', marginTop: '8px',
          lineHeight: 1.4, fontStyle: 'italic',
        }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function PremiumSlider({ label, value, onChange, min, max, step = 1, suffix, hint }) {
  const pct = ((value - min) / (max - min)) * 100;
  const safePct = Math.min(100, Math.max(0, pct));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px' }}>
        <label style={{
          fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em',
          color: '#78716C', fontWeight: 500,
        }}>
          {label}
        </label>
        <span style={{
          fontFamily: "'Playfair Display', Georgia, serif", fontSize: '20px',
          color: '#1C1917', fontVariantNumeric: 'tabular-nums',
        }}>
          {value.toLocaleString('cs-CZ', { maximumFractionDigits: step < 1 ? 2 : 0 })}
          <span style={{ marginLeft: '6px', fontSize: '12px', color: '#A47148', fontWeight: 500 }}>
            {suffix}
          </span>
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ '--val': `${safePct}%` }}
        className="premium-slider"
      />
      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: '10px',
        color: '#A8A29E', marginTop: '6px', fontVariantNumeric: 'tabular-nums',
      }}>
        <span>{min}</span><span>{max}</span>
      </div>
      {hint && (
        <p style={{
          fontSize: '11px', color: '#78716C', marginTop: '8px',
          lineHeight: 1.4, fontStyle: 'italic',
        }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value, accent = 'neutral', sub }) {
  const borderColors = {
    neutral: '#D4C5B0', gold: '#A47148', green: '#6B8E4E',
    orange: '#D97757', blue: '#4A6FA5', red: '#C2410C',
  };
  const valueColors = {
    neutral: '#1C1917', gold: '#7A5734', green: '#4F6B3A',
    orange: '#A84E2E', blue: '#2E4A7A', red: '#9A2E0B',
  };
  return (
    <div style={{
      backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0',
      borderLeft: `4px solid ${borderColors[accent]}`, borderRadius: '6px',
      padding: '18px', boxShadow: '0 1px 3px rgba(60,40,20,0.04)',
      display: 'flex', flexDirection: 'column', minWidth: 0,
    }}>
      <div style={{
        fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.15em',
        color: '#57534E', marginBottom: '10px', fontWeight: 600,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: 'clamp(1.1rem, 2vw, 1.65rem)', fontWeight: 700,
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.15,
        textAlign: 'right', color: valueColors[accent],
        wordBreak: 'normal', overflowWrap: 'break-word',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontSize: '11px', color: '#78716C', marginTop: '8px',
          fontStyle: 'italic', textAlign: 'right',
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, titleNode, children }) {
  return (
    <section style={{
      backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0',
      borderRadius: '8px', padding: '32px 28px',
      boxShadow: '0 1px 3px rgba(60,40,20,0.04)',
      height: '100%', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        {titleNode ? titleNode : (
          <h3 style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: 'clamp(1.75rem, 2.5vw, 2.15rem)', color: '#1C1917',
            letterSpacing: '-0.01em', fontWeight: 700, margin: 0, lineHeight: 1.15,
          }}>
            {title}
          </h3>
        )}
        <div style={{
          marginTop: '14px', marginLeft: 'auto', marginRight: 'auto',
          width: '72px', height: '3px', backgroundColor: '#D97757',
          borderRadius: '9999px',
        }} />
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '20px',
        flex: 1, justifyContent: 'space-around',
      }}>
        {children}
      </div>
    </section>
  );
}

// Editovatelný titulek bez přerušované čáry — fokus zvýrazněn jen jemně.
function EditableTitle({ value, onChange }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => { setFocused(true); e.target.select(); }}
      onBlur={() => setFocused(false)}
      style={{
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: 'clamp(1.75rem, 2.5vw, 2.15rem)',
        color: '#1C1917', letterSpacing: '-0.01em', fontWeight: 700,
        textAlign: 'center', width: '100%', background: 'transparent',
        border: 'none', outline: 'none', padding: '4px 6px',
        lineHeight: 1.15, borderRadius: '6px',
        boxShadow: focused ? '0 0 0 2px rgba(217, 119, 87, 0.25)' : 'none',
        transition: 'box-shadow 0.18s ease',
      }}
    />
  );
}

function ChartTooltipBase({ active, payload, label, labelPrefix = 'Rok', secondary }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0', borderRadius: '6px',
      padding: '12px 16px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', minWidth: '220px',
    }}>
      <div style={{
        color: '#A84E2E', fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: '14px', marginBottom: '8px', borderBottom: '1px solid #F0EBE0',
        paddingBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span>{labelPrefix} {label}</span>
        {secondary && (
          <span style={{ fontSize: '10px', color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
            {secondary}
          </span>
        )}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{
          fontSize: '12px', display: 'flex', alignItems: 'center', gap: '12px',
          fontVariantNumeric: 'tabular-nums', margin: '4px 0',
        }}>
          <span style={{
            display: 'inline-block', width: '10px', height: '10px',
            borderRadius: '9999px', background: p.color, flexShrink: 0,
          }} />
          <span style={{ color: '#57534E' }}>{p.name}:</span>
          <span style={{ fontWeight: 500, marginLeft: 'auto', color: '#1C1917' }}>
            {fmtCZK(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

const yAxisFmt = (v) =>
  v >= 1_000_000_000 ? `${(v / 1_000_000_000).toFixed(1)} mld.`
  : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)} mil.`
  : v >= 1000 ? `${(v / 1000).toFixed(0)} tis.`
  : v;

// ════════════════════════════════════════════════════════════════════
//  GLOBÁLNÍ CSS
// ════════════════════════════════════════════════════════════════════
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700;800&display=swap');

      .ms-container { max-width: 1400px; margin: 0 auto; padding: 40px 20px; }
      @media (min-width: 768px) { .ms-container { padding: 56px 40px; } }

      .ms-inputs-grid {
        display: grid; grid-template-columns: 1fr; gap: 20px; margin-bottom: 96px;
      }
      @media (min-width: 900px) {
        .ms-inputs-grid {
          grid-template-columns: 1fr 1fr; gap: 24px; align-items: start;
        }
      }

      .ms-input-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

      .ms-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      @media (min-width: 720px) {
        .ms-stats-grid { grid-template-columns: repeat(4, 1fr); gap: 16px; }
      }
      .ms-stats-grid-3 { display: grid; grid-template-columns: 1fr; gap: 14px; }
      @media (min-width: 720px) {
        .ms-stats-grid-3 { grid-template-columns: repeat(3, 1fr); gap: 16px; }
      }

      .ms-input-wrapper:focus-within {
        border-color: #D97757 !important;
        box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.15) !important;
      }

      .premium-slider {
        -webkit-appearance: none; appearance: none;
        width: 100%; height: 24px; background: transparent; outline: none;
        cursor: pointer; padding: 0; margin: 0;
      }
      .premium-slider::-webkit-slider-runnable-track {
        height: 10px; border-radius: 999px;
        background: linear-gradient(to right,
          #BE5530 0%, #D97757 var(--val, 0%),
          #EADFCB var(--val, 0%), #EADFCB 100%);
      }
      .premium-slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 24px; height: 24px; border-radius: 50%;
        background: #ffffff; border: 3px solid #D97757; cursor: grab;
        box-shadow: 0 3px 10px rgba(217, 119, 87, 0.35);
        transition: transform 0.15s ease; margin-top: -7px;
      }
      .premium-slider::-webkit-slider-thumb:hover { transform: scale(1.08); }
      .premium-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.12); }
      .premium-slider::-moz-range-track {
        height: 10px; border-radius: 999px; background: #EADFCB;
      }
      .premium-slider::-moz-range-progress {
        height: 10px; border-radius: 999px;
        background: linear-gradient(to right, #BE5530, #D97757);
      }
      .premium-slider::-moz-range-thumb {
        width: 22px; height: 22px; border-radius: 50%;
        background: #ffffff; border: 3px solid #D97757; cursor: grab;
        box-shadow: 0 3px 10px rgba(217, 119, 87, 0.35);
      }

      input[type=number]::-webkit-inner-spin-button,
      input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      input[type=number] { -moz-appearance: textfield; }

      .ms-hero-title {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: clamp(2.5rem, 6vw, 4.5rem);
        color: #1C1917; letter-spacing: -0.02em; line-height: 1.05;
        margin: 0; text-align: center; font-weight: 600;
      }
      .ms-hero-underline {
        margin: 24px auto 0; height: 3px; width: 100%; max-width: 1400px;
        background: linear-gradient(to right,
          transparent 0%, #D97757 15%, #BE5530 50%, #D97757 85%, transparent 100%);
        border-radius: 9999px; box-shadow: 0 1px 3px rgba(217, 119, 87, 0.25);
      }
      .ms-result-amount {
        font-family: 'Playfair Display', Georgia, serif;
        font-size: clamp(2.5rem, 6vw, 4rem); font-weight: 700; color: #1C1917;
        font-variant-numeric: tabular-nums; line-height: 1; word-break: break-word;
      }
      .ms-bg-dots {
        position: fixed; inset: 0; pointer-events: none;
        background-image: radial-gradient(circle at 1px 1px, rgba(28, 25, 23, 0.22) 1px, transparent 0);
        background-size: 22px 22px; z-index: 0;
      }
      .ms-section-title {
        font-family: 'Playfair Display', Georgia, serif; font-size: 1.5rem;
        color: #1C1917; letter-spacing: -0.01em; font-weight: 600;
        display: flex; align-items: center; gap: 12px; margin: 0;
      }
      .ms-table-base { width: 100%; font-size: 15px; border-collapse: collapse; }
      .ms-table-base th { padding: 14px; font-weight: 600; text-align: center; }
      .ms-table-base td {
        padding: 14px; text-align: center;
        font-family: 'Playfair Display', Georgia, serif; font-variant-numeric: tabular-nums;
      }
      @media (max-width: 720px) {
        .ms-table-base { font-size: 12px; }
        .ms-table-base th, .ms-table-base td { padding: 8px 4px; }
      }

      /* LTV / DSTI / DTI indikátor pilulky */
      .ms-ltv-pill {
        display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px;
        border-radius: 9999px; font-size: 13px; font-weight: 600;
        letter-spacing: 0.05em; font-variant-numeric: tabular-nums;
      }
      .ms-ltv-pill.green { background: rgba(107, 142, 78, 0.15); color: #4F6B3A; border: 1px solid rgba(107, 142, 78, 0.3); }
      .ms-ltv-pill.yellow { background: rgba(212, 169, 80, 0.18); color: #7A5734; border: 1px solid rgba(164, 113, 72, 0.3); }
      .ms-ltv-pill.red { background: rgba(194, 65, 12, 0.12); color: #9A2E0B; border: 1px solid rgba(194, 65, 12, 0.3); }

      /* Sensitivity matrix */
      .ms-sens-table { width: 100%; border-collapse: separate; border-spacing: 0; }
      .ms-sens-table th, .ms-sens-table td {
        padding: 12px 8px; text-align: center; font-size: 13px;
        font-variant-numeric: tabular-nums;
      }
      .ms-sens-table th {
        background: #FBF7EE; color: #A84E2E;
        text-transform: uppercase; letter-spacing: 0.12em; font-size: 11px;
        font-weight: 600;
      }
      .ms-sens-table td.ms-cell-rowhead {
        background: #FBF7EE; color: #A84E2E; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.12em; font-size: 11px;
      }
    `}</style>
  );
}

// ════════════════════════════════════════════════════════════════════
//  MODUL 1 — HYPOTÉKA
// ════════════════════════════════════════════════════════════════════
function MortgageModule() {
  const [price, setPrice] = useState(5_000_000);
  const [ownFunds, setOwnFunds] = useState(1_000_000);
  const [rate, setRate] = useState(4.5);
  const [years, setYears] = useState(30);
  const [tableOpen, setTableOpen] = useState(false);

  // DSTI/DTI
  const [dstiOpen, setDstiOpen] = useState(false);
  const [income, setIncome] = useState(60_000);
  const [otherMonthly, setOtherMonthly] = useState(0);
  const [existingDebt, setExistingDebt] = useState(0);

  const loanAmount = Math.max(0, price - ownFunds);
  const ltv = price > 0 ? (loanAmount / price) * 100 : 0;
  const ltvClass = ltv <= 80 ? 'green' : ltv <= 90 ? 'yellow' : 'red';

  const scenario = useMemo(
    () => amortize(loanAmount, rate, years),
    [loanAmount, rate, years],
  );

  const rpsnApprox = (Math.pow(1 + rate / 100 / 12, 12) - 1) * 100;

  // Skladba měsíční splátky v čase — průměrná měsíční jistina a úrok pro daný rok.
  const splitChartData = useMemo(() =>
    scenario.yearly.slice(1).map((y) => ({
      year: y.year,
      Jistina: y.principal / 12,
      Úrok: y.interest / 12,
    })),
    [scenario],
  );

  // DSTI / DTI ratios
  const dstiVal = income > 0 ? ((scenario.baseMonthly + otherMonthly) / income) * 100 : 0;
  const dtiVal = income > 0 ? (loanAmount + existingDebt) / (income * 12) : 0;
  const dstiClass = dstiVal <= 40 ? 'green' : dstiVal <= 50 ? 'yellow' : 'red';
  const dtiClass = dtiVal <= 8 ? 'green' : dtiVal <= 9.5 ? 'yellow' : 'red';

  return (
    <>
      <div className="ms-inputs-grid">
        <SectionCard title="Nemovitost a financování">
          <NumberInput
            label="Cena nemovitosti"
            value={price}
            onChange={setPrice}
            suffix="Kč"
          />
          <NumberInput
            label="Vlastní zdroje"
            value={ownFunds}
            onChange={setOwnFunds}
            suffix="Kč"
            hint="Co zaplatíte ze svého — zbytek je výše úvěru."
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#78716C', fontWeight: 500, marginBottom: '6px' }}>
                Výše úvěru
              </div>
              <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '24px', color: '#1C1917', fontVariantNumeric: 'tabular-nums' }}>
                {fmtCZK(loanAmount)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#78716C', fontWeight: 500, marginBottom: '6px' }}>
                LTV
              </div>
              <span className={`ms-ltv-pill ${ltvClass}`}>
                {fmtPct(ltv)}
              </span>
            </div>
          </div>
          {ltv > 90 && (
            <p style={{ fontSize: '12px', color: '#9A2E0B', lineHeight: 1.5, margin: 0, fontStyle: 'italic' }}>
              ⚠ Banky obvykle nepůjčí nad 90 % LTV, případně za výrazně vyšší sazbu. Zvažte vyšší vlastní zdroje.
            </p>
          )}
        </SectionCard>

        <SectionCard title="Parametry úvěru">
          <PremiumSlider
            label="Úroková sazba"
            value={rate}
            onChange={setRate}
            min={2} max={8} step={0.1}
            suffix="% p.a."
            hint="Aktuální tržní hodnota se pohybuje kolem 4,5–5,5 % (pro fixaci 3–5 let)."
          />
          <PremiumSlider
            label="Doba splatnosti"
            value={years}
            onChange={setYears}
            min={5} max={30} step={1}
            suffix="let"
          />
        </SectionCard>
      </div>

      {/* HERO — měsíční splátka */}
      <div style={{
        background: 'linear-gradient(135deg, #FBF4E7 0%, #FFFFFF 50%, #FBF4E7 100%)',
        border: '1px solid #D9C5A0', borderRadius: '10px',
        padding: '36px 24px', boxShadow: '0 4px 20px rgba(217, 119, 87, 0.12)',
        textAlign: 'center', marginTop: '128px', marginBottom: '24px',
      }}>
        <div style={{
          fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.3em',
          color: '#A84E2E', marginBottom: '14px', fontWeight: 500,
        }}>
          Měsíční splátka
        </div>
        <div className="ms-result-amount">{fmtCZK(Math.ceil(scenario.baseMonthly))}</div>
        <div style={{
          marginTop: '20px', display: 'flex', flexWrap: 'wrap',
          justifyContent: 'center', gap: '12px 32px', fontSize: '14px', color: '#57534E',
        }}>
          <span>Výše úvěru <span style={{ color: '#1C1917' }}>{fmtCZK(loanAmount)}</span></span>
          <span>Sazba <span style={{ color: '#1C1917' }}>{fmtPct(rate)} p.a.</span></span>
          <span>Splatnost <span style={{ color: '#1C1917' }}>{years} let</span></span>
        </div>
      </div>

      {/* STAT KARTY */}
      <div className="ms-stats-grid" style={{ marginBottom: '24px' }}>
        <StatCard
          label="Celkem zaplaceno"
          value={fmtCZK(scenario.totalPaid)}
          accent="neutral"
          sub="Za úvěr (úmor + úrok)"
        />
        <StatCard
          label="Z toho úroky"
          value={fmtCZK(scenario.totalInterest)}
          accent="orange"
          sub={loanAmount > 0 ? `${fmtPct(scenario.totalInterest / loanAmount * 100)} z jistiny` : '—'}
        />
        <StatCard
          label="RPSN (orientačně)"
          value={fmtPct2(rpsnApprox)}
          accent="gold"
          sub="Efektivní roční sazba"
        />
        <StatCard
          label="LTV"
          value={fmtPct(ltv)}
          accent={ltv <= 80 ? 'green' : ltv <= 90 ? 'gold' : 'red'}
          sub={ltv <= 80 ? 'Optimální pásmo' : ltv <= 90 ? 'Vyšší riziková přirážka' : 'Banky obvykle nepůjčí'}
        />
      </div>

      {/* GRAF — skladba měsíční splátky v čase */}
      <div style={{
        backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0', borderRadius: '10px',
        padding: '24px', boxShadow: '0 1px 3px rgba(60,40,20,0.04)', marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 className="ms-section-title">
            <span style={{ width: '24px', height: '1px', backgroundColor: '#D97757' }} />
            Skladba měsíční splátky v čase
          </h3>
          <div style={{ fontSize: '11px', color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
            {years} let · {fmtPct(rate)} p.a.
          </div>
        </div>
        <p style={{ fontSize: '13px', color: '#57534E', margin: '4px 0 18px', lineHeight: 1.5 }}>
          Každý sloupec ukazuje, jak se vaše stejně velká měsíční splátka rozkládá v daném roce. Začátek úvěru = velká část jde na úroky (bance), konec = naopak skoro celá na jistinu (dluh klesá rychleji).
        </p>
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={splitChartData} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#EADFCB" />
            <XAxis dataKey="year" stroke="#A8A29E" tick={{ fill: '#78716C', fontSize: 11 }}
                   label={{ value: 'Rok', position: 'insideBottom', offset: -3, fill: '#78716C', fontSize: 11 }} />
            <YAxis stroke="#A8A29E" tick={{ fill: '#78716C', fontSize: 11 }} tickFormatter={yAxisFmt} />
            <Tooltip content={<ChartTooltipBase />} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="square" />
            <Area type="monotone" dataKey="Jistina" stackId="1" name="Jistina (úmor)"
                  stroke="#6B8E4E" fill="#A8C28B" fillOpacity={0.9} />
            <Area type="monotone" dataKey="Úrok" stackId="1" name="Úrok bance"
                  stroke="#A84E2E" fill="#E8A78A" fillOpacity={0.9} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* GRAF — zůstatek úvěru */}
      <div style={{
        backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0', borderRadius: '10px',
        padding: '24px', boxShadow: '0 1px 3px rgba(60,40,20,0.04)', marginBottom: '24px',
      }}>
        <h3 className="ms-section-title" style={{ marginBottom: '20px' }}>
          <span style={{ width: '24px', height: '1px', backgroundColor: '#D97757' }} />
          Zůstatek úvěru v čase
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart
            data={scenario.yearly.map((y) => ({ year: y.year, balance: y.balance }))}
            margin={{ top: 10, right: 30, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="2 4" stroke="#EADFCB" />
            <XAxis dataKey="year" stroke="#A8A29E" tick={{ fill: '#78716C', fontSize: 11 }} />
            <YAxis stroke="#A8A29E" tick={{ fill: '#78716C', fontSize: 11 }} tickFormatter={yAxisFmt} />
            <Tooltip content={<ChartTooltipBase />} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="line" />
            <Line type="monotone" dataKey="balance" name="Zůstatek úvěru"
                  stroke="#D97757" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* DSTI / DTI — rozklikávací */}
      <div style={{
        backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0', borderRadius: '10px',
        boxShadow: '0 1px 3px rgba(60,40,20,0.04)', overflow: 'hidden', marginBottom: '24px',
      }}>
        <button
          onClick={() => setDstiOpen(!dstiOpen)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '20px 24px', background: 'transparent', border: 'none', cursor: 'pointer',
            transition: 'background-color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#FBF7EE')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <span className="ms-section-title" style={{ fontSize: '1.25rem' }}>
            <span style={{ width: '24px', height: '1px', backgroundColor: '#D97757' }} />
            DSTI / DTI — bankovní ukazatele
          </span>
          <ChevronToggle open={dstiOpen} />
        </button>
        {dstiOpen && (
          <div style={{ borderTop: '1px solid #E5DDD0', padding: '24px 28px' }}>
            <p style={{ fontSize: '14px', color: '#44403C', lineHeight: 1.65, marginTop: 0, marginBottom: '20px' }}>
              Banky posuzují, zda si můžete úvěr dovolit, podle dvou poměrů:{' '}
              <strong style={{ color: '#1C1917' }}>DSTI</strong> (Debt Service to Income) = podíl všech měsíčních splátek na čistém měsíčním příjmu;{' '}
              <strong style={{ color: '#1C1917' }}>DTI</strong> (Debt to Income) = poměr celkového dluhu k ročnímu čistému příjmu.
              Limity ČNB byly v roce 2023 zrušeny jako závazné, ale banky podle nich stále scoringují.
            </p>

            <div className="ms-input-row" style={{ marginBottom: '16px' }}>
              <NumberInput
                label="Čistý měsíční příjem (domácnost)"
                value={income}
                onChange={setIncome}
                suffix="Kč/měs"
                hint="Součet čistých příjmů všech žadatelů."
              />
              <NumberInput
                label="Stávající měsíční splátky"
                value={otherMonthly}
                onChange={setOtherMonthly}
                suffix="Kč/měs"
                hint="Jiné úvěry, leasing, kreditky (min. splátka)."
              />
            </div>
            <div style={{ marginBottom: '24px' }}>
              <NumberInput
                label="Celkové stávající dluhy (jistiny)"
                value={existingDebt}
                onChange={setExistingDebt}
                suffix="Kč"
                hint="Součet všech zůstatků jiných úvěrů — pro výpočet DTI."
              />
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: '1fr', gap: '16px',
            }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px',
              }}>
                <div style={{
                  backgroundColor: '#FBF7EE', border: '1px solid #E5DDD0',
                  borderRadius: '6px', padding: '18px',
                }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#A84E2E', fontWeight: 600, marginBottom: '10px' }}>
                    DSTI
                  </div>
                  <div style={{
                    fontFamily: "'Playfair Display', Georgia, serif", fontSize: '28px',
                    color: '#1C1917', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                    marginBottom: '12px',
                  }}>
                    {income > 0 ? fmtPct(dstiVal) : '—'}
                  </div>
                  <span className={`ms-ltv-pill ${dstiClass}`} style={{ fontSize: '11px' }}>
                    {dstiVal <= 40 ? '✓ Optimální (do 40 %)'
                      : dstiVal <= 50 ? '⚠ Vyšší zátěž (40–50 %)'
                      : '✗ Banka pravděpodobně odmítne (nad 50 %)'}
                  </span>
                  <p style={{ fontSize: '11px', color: '#78716C', lineHeight: 1.5, marginTop: '10px', marginBottom: 0 }}>
                    (Nová splátka {fmtCZK(scenario.baseMonthly)} + stávající {fmtCZK(otherMonthly)}) ÷ příjem {fmtCZK(income)}
                  </p>
                </div>

                <div style={{
                  backgroundColor: '#FBF7EE', border: '1px solid #E5DDD0',
                  borderRadius: '6px', padding: '18px',
                }}>
                  <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#A84E2E', fontWeight: 600, marginBottom: '10px' }}>
                    DTI
                  </div>
                  <div style={{
                    fontFamily: "'Playfair Display', Georgia, serif", fontSize: '28px',
                    color: '#1C1917', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                    marginBottom: '12px',
                  }}>
                    {income > 0 ? `${dtiVal.toFixed(1).replace('.', ',')}×` : '—'}
                  </div>
                  <span className={`ms-ltv-pill ${dtiClass}`} style={{ fontSize: '11px' }}>
                    {dtiVal <= 8 ? '✓ Optimální (do 8×)'
                      : dtiVal <= 9.5 ? '⚠ Vyšší riziko (8–9,5×)'
                      : '✗ Vysoká zadluženost (nad 9,5×)'}
                  </span>
                  <p style={{ fontSize: '11px', color: '#78716C', lineHeight: 1.5, marginTop: '10px', marginBottom: 0 }}>
                    (Úvěr {fmtCZK(loanAmount)} + stávající {fmtCZK(existingDebt)}) ÷ roční příjem {fmtCZK(income * 12)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* TABULKA */}
      <div style={{
        backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0', borderRadius: '10px',
        boxShadow: '0 1px 3px rgba(60,40,20,0.04)', overflow: 'hidden',
      }}>
        <button
          onClick={() => setTableOpen(!tableOpen)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '20px 24px', background: 'transparent', border: 'none', cursor: 'pointer',
            transition: 'background-color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#FBF7EE')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <span className="ms-section-title" style={{ fontSize: '1.25rem' }}>
            <span style={{ width: '24px', height: '1px', backgroundColor: '#D97757' }} />
            Amortizační rozpis po letech
          </span>
          <ChevronToggle open={tableOpen} />
        </button>
        {tableOpen && (
          <div style={{ overflowX: 'auto', borderTop: '1px solid #E5DDD0' }}>
            <table className="ms-table-base" style={{ tableLayout: 'fixed', minWidth: '640px' }}>
              <thead style={{ backgroundColor: '#FBF7EE' }}>
                <tr style={{ color: '#A84E2E', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                  <th style={{ width: '10%' }}>Rok</th>
                  <th style={{ width: '22%' }}>Splaceno</th>
                  <th style={{ width: '22%' }}>Úmor</th>
                  <th style={{ width: '22%' }}>Úroky</th>
                  <th style={{ width: '24%' }}>Zůstatek</th>
                </tr>
              </thead>
              <tbody>
                {scenario.yearly.slice(1).map((row, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #F0EBE0', backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#FBF9F3' }}>
                    <td style={{ color: '#78716C', fontWeight: 500 }}>{row.year}</td>
                    <td style={{ color: '#44403C' }}>{fmtCZK(row.totalPaid)}</td>
                    <td style={{ color: '#4F6B3A' }}>{fmtCZK(row.principal)}</td>
                    <td style={{ color: '#A84E2E' }}>{fmtCZK(row.interest)}</td>
                    <td style={{ color: '#1C1917', fontWeight: 500 }}>{fmtCZK(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
//  KOMPONENTA SLOUPCE PRO SROVNÁNÍ — EXTRAHOVANÁ VEN!
//  (původně byla uvnitř LoanComparisonModule a re-mountovala se na každém renderu
//   → input ztrácel focus po každém keystroke. Teď je stabilní.)
// ════════════════════════════════════════════════════════════════════
function LoanColumn({ loan, setLoan, result, accentBorder }) {
  const update = (patch) => setLoan({ ...loan, ...patch });
  return (
    <SectionCard titleNode={
      <EditableTitle value={loan.name} onChange={(v) => update({ name: v })} />
    }>
      <NumberInput
        label="Výše úvěru"
        value={loan.amount}
        onChange={(v) => update({ amount: v })}
        suffix="Kč"
      />
      <PremiumSlider
        label="Úroková sazba"
        value={loan.rate}
        onChange={(v) => update({ rate: v })}
        min={2} max={10} step={0.1}
        suffix="% p.a."
      />
      <PremiumSlider
        label="Doba splatnosti"
        value={loan.years}
        onChange={(v) => update({ years: v })}
        min={1} max={30} step={1}
        suffix="let"
      />
      <div style={{
        padding: '18px', backgroundColor: '#FBF7EE', borderRadius: '6px',
        borderLeft: `4px solid ${accentBorder}`,
      }}>
        <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#A84E2E', fontWeight: 600, marginBottom: '8px' }}>
          Měsíční splátka
        </div>
        <div style={{
          fontFamily: "'Playfair Display', Georgia, serif", fontSize: '28px',
          color: '#1C1917', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
        }}>
          {fmtCZK(result.baseMonthly)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: '10px', fontSize: '12px', color: '#57534E' }}>
          <span>Celkem: <strong style={{ color: '#1C1917' }}>{fmtCZK(result.totalPaid)}</strong></span>
          <span>Z toho úroky: <strong style={{ color: '#A84E2E' }}>{fmtCZK(result.totalInterest)}</strong></span>
        </div>
      </div>
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════════
//  MODUL 2 — SROVNÁNÍ DVOU ÚVĚRŮ
// ════════════════════════════════════════════════════════════════════
function LoanComparisonModule() {
  const [loanA, setLoanA] = useState({
    name: 'Úvěr A', amount: 1_000_000, rate: 5, years: 10,
  });
  const [loanB, setLoanB] = useState({
    name: 'Úvěr B', amount: 1_000_000, rate: 6, years: 10,
  });

  const resA = useMemo(() => amortize(loanA.amount, loanA.rate, loanA.years), [loanA]);
  const resB = useMemo(() => amortize(loanB.amount, loanB.rate, loanB.years), [loanB]);

  const diff = resA.totalPaid - resB.totalPaid;
  const winnerName = diff > 0 ? loanB.name : loanA.name;
  const loserName = diff > 0 ? loanA.name : loanB.name;
  const savings = Math.abs(diff);
  const monthlyDiff = resA.baseMonthly - resB.baseMonthly;

  // Vývoj zůstatků — sjednocená data pro graf
  const balanceChartData = useMemo(() => {
    const maxLen = Math.max(resA.yearly.length, resB.yearly.length);
    const arr = [];
    for (let i = 0; i < maxLen; i++) {
      arr.push({
        year: i,
        [loanA.name]: resA.yearly[i]?.balance ?? null,
        [loanB.name]: resB.yearly[i]?.balance ?? null,
      });
    }
    return arr;
  }, [resA, resB, loanA.name, loanB.name]);

  return (
    <>
      <div className="ms-inputs-grid">
        <LoanColumn loan={loanA} setLoan={setLoanA} result={resA} accentBorder="#6B8E4E" />
        <LoanColumn loan={loanB} setLoan={setLoanB} result={resB} accentBorder="#D97757" />
      </div>

      {/* HERO — kdo vyhrává */}
      <div style={{
        background: 'linear-gradient(135deg, #FBF4E7 0%, #FFFFFF 50%, #FBF4E7 100%)',
        border: '1px solid #D9C5A0', borderRadius: '10px',
        padding: '36px 24px', boxShadow: '0 4px 20px rgba(217, 119, 87, 0.12)',
        textAlign: 'center', marginTop: '128px', marginBottom: '24px',
      }}>
        {savings > 1 ? (
          <>
            <div style={{
              fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.3em',
              color: '#A84E2E', marginBottom: '14px', fontWeight: 500,
            }}>
              Výhodnější je <strong style={{ color: '#1C1917' }}>{winnerName}</strong>
            </div>
            <div className="ms-result-amount">{fmtCZK(savings)}</div>
            <div style={{ marginTop: '12px', fontSize: '14px', color: '#57534E' }}>
              o tolik celkem méně než {loserName}
            </div>
          </>
        ) : (
          <>
            <div style={{
              fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.3em',
              color: '#A84E2E', marginBottom: '14px', fontWeight: 500,
            }}>
              Úvěry jsou prakticky srovnatelné
            </div>
            <div className="ms-result-amount">{fmtCZK(0)}</div>
          </>
        )}
        <div style={{
          marginTop: '24px', display: 'flex', flexWrap: 'wrap',
          justifyContent: 'center', gap: '12px 32px', fontSize: '14px', color: '#57534E',
        }}>
          <span>
            Rozdíl měsíční splátky{' '}
            <span style={{ color: monthlyDiff === 0 ? '#1C1917' : (monthlyDiff > 0 ? '#A84E2E' : '#4F6B3A'), fontWeight: 500 }}>
              {monthlyDiff === 0 ? '0' : `${monthlyDiff > 0 ? '+' : ''}${fmtCZK(monthlyDiff)}`}
              <span style={{ color: '#78716C', fontWeight: 400 }}> ({loanA.name} − {loanB.name})</span>
            </span>
          </span>
        </div>
      </div>

      {/* STAT KARTY */}
      <div className="ms-stats-grid" style={{ marginBottom: '24px' }}>
        <StatCard
          label={`${loanA.name} — celkem`}
          value={fmtCZK(resA.totalPaid)}
          accent={diff <= 0 ? 'green' : 'neutral'}
          sub={`${loanA.years} let při ${fmtPct(loanA.rate)}`}
        />
        <StatCard
          label={`${loanA.name} — úroky`}
          value={fmtCZK(resA.totalInterest)}
          accent="orange"
          sub={loanA.amount > 0 ? `${fmtPct(resA.totalInterest / loanA.amount * 100)} z jistiny` : '—'}
        />
        <StatCard
          label={`${loanB.name} — celkem`}
          value={fmtCZK(resB.totalPaid)}
          accent={diff > 0 ? 'green' : 'neutral'}
          sub={`${loanB.years} let při ${fmtPct(loanB.rate)}`}
        />
        <StatCard
          label={`${loanB.name} — úroky`}
          value={fmtCZK(resB.totalInterest)}
          accent="orange"
          sub={loanB.amount > 0 ? `${fmtPct(resB.totalInterest / loanB.amount * 100)} z jistiny` : '—'}
        />
      </div>

      {/* GRAF — vývoj zůstatků */}
      <div style={{
        backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0', borderRadius: '10px',
        padding: '24px', boxShadow: '0 1px 3px rgba(60,40,20,0.04)', marginBottom: '24px',
      }}>
        <h3 className="ms-section-title" style={{ marginBottom: '20px' }}>
          <span style={{ width: '24px', height: '1px', backgroundColor: '#D97757' }} />
          Vývoj zůstatků obou úvěrů
        </h3>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={balanceChartData} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#EADFCB" />
            <XAxis dataKey="year" stroke="#A8A29E" tick={{ fill: '#78716C', fontSize: 11 }} />
            <YAxis stroke="#A8A29E" tick={{ fill: '#78716C', fontSize: 11 }} tickFormatter={yAxisFmt} />
            <Tooltip content={<ChartTooltipBase />} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="line" />
            <Line type="monotone" dataKey={loanA.name} stroke="#6B8E4E" strokeWidth={2.5} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey={loanB.name} stroke="#D97757" strokeWidth={2.5} dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
//  MODUL 3 — ÚVĚR vs INVESTICE
// ════════════════════════════════════════════════════════════════════
function LoanVsInvestModule() {
  const [amount, setAmount] = useState(1_000_000);
  const [loanRate, setLoanRate] = useState(5);
  const [loanYears, setLoanYears] = useState(10);
  const [investReturn, setInvestReturn] = useState(9);

  const sim = useMemo(
    () => simulateLoanVsInvest({
      price: amount, cash: amount, loanRate, loanYears, investReturn, mode: 'income',
    }),
    [amount, loanRate, loanYears, investReturn],
  );

  const final = sim.data[sim.data.length - 1];
  const diff = final.netWealth2 - final.netWealth1;
  const winner = diff > 0 ? 'Úvěr (a investice)' : 'Hotovost';

  const breakEven = useMemo(
    () => amount > 0
      ? findBreakEvenReturn({ price: amount, cash: amount, loanRate, loanYears, mode: 'income' })
      : null,
    [amount, loanRate, loanYears],
  );

  // Rozdíl scénářů v čase — jedna křivka s gradientovou výplní (zelená nad nulou, červená pod).
  const diffChartData = useMemo(
    () => sim.data.map((d) => ({ year: d.year, diff: d.netWealth2 - d.netWealth1 })),
    [sim],
  );
  const diffMax = Math.max(0, ...diffChartData.map((d) => d.diff));
  const diffMin = Math.min(0, ...diffChartData.map((d) => d.diff));
  const gradientOffset = diffMax <= 0
    ? 0
    : diffMin >= 0
      ? 1
      : diffMax / (diffMax - diffMin);

  // Senzitivní matice
  const returnRow = [5, 7, 9, 11];
  const rateCol = [3, 4, 5, 6];
  const matrix = useMemo(() => {
    return returnRow.map((r) => ({
      ret: r,
      cells: rateCol.map((lr) => {
        const s = simulateLoanVsInvest({
          price: amount, cash: amount, loanRate: lr, loanYears, investReturn: r, mode: 'income',
        });
        const f = s.data[s.data.length - 1];
        return { rate: lr, diff: f.netWealth2 - f.netWealth1 };
      }),
    }));
  }, [amount, loanYears]);

  // Růst investice ve scénáři 2 (čistý zisk z portfolia bez započtení úvěru)
  const investGrowth = final.p2 - amount;

  return (
    <>
      <div className="ms-inputs-grid">
        <SectionCard title="Pořízení a úvěr">
          <NumberInput
            label="Částka"
            value={amount}
            onChange={setAmount}
            suffix="Kč"
            hint="Cena pořizovaného i vaše disponibilní hotovost — pro férové srovnání musí být stejné."
          />
          <PremiumSlider
            label="Úroková sazba úvěru"
            value={loanRate}
            onChange={setLoanRate}
            min={2} max={15} step={0.1}
            suffix="% p.a."
            hint="Spotřebitelský úvěr 6–10 %, hypotéka 4–6 %, auto úvěr 5–9 %."
          />
          <PremiumSlider
            label="Doba splácení"
            value={loanYears}
            onChange={setLoanYears}
            min={1} max={25} step={1}
            suffix="let"
          />
        </SectionCard>

        <SectionCard title="Investice">
          <PremiumSlider
            label="Očekávaný výnos investice"
            value={investReturn}
            onChange={setInvestReturn}
            min={3} max={12} step={0.5}
            suffix="% p.a."
            hint="📈 MSCI World za posledních ~30 let ~9 % p.a. (1987–2025, v USD). Konzervativnější odhad 6–7 %."
          />
          <div style={{
            backgroundColor: '#FBF7EE', borderRadius: '6px', padding: '18px',
            border: '1px solid #E5DDD0',
          }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#A84E2E', fontWeight: 600, marginBottom: '12px' }}>
              Jak to funguje
            </div>
            <p style={{ fontSize: '13px', color: '#44403C', lineHeight: 1.6, margin: 0 }}>
              <strong style={{ color: '#1C1917' }}>Scénář 1 — Hotovost:</strong> zaplatíte hotově, peníze v investici nejsou, ale měsíčně investujete částku rovnou splátce úvěru (férové srovnání cashflow).<br/><br/>
              <strong style={{ color: '#1C1917' }}>Scénář 2 — Úvěr:</strong> vezmete si úvěr na celou částku, hotovost necháte investovanou, úvěr splácíte z příjmů.
            </p>
          </div>
        </SectionCard>
      </div>

      {/* HERO */}
      <div style={{
        background: diff > 0
          ? 'linear-gradient(135deg, #F0F6E8 0%, #FFFFFF 50%, #F0F6E8 100%)'
          : 'linear-gradient(135deg, #FBF4E7 0%, #FFFFFF 50%, #FBF4E7 100%)',
        border: `1px solid ${diff > 0 ? '#C5D9A8' : '#D9C5A0'}`,
        borderRadius: '10px',
        padding: '36px 24px',
        boxShadow: `0 4px 20px ${diff > 0 ? 'rgba(107, 142, 78, 0.15)' : 'rgba(217, 119, 87, 0.12)'}`,
        textAlign: 'center', marginTop: '128px', marginBottom: '24px',
      }}>
        <div style={{
          fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.3em',
          color: diff > 0 ? '#4F6B3A' : '#A84E2E',
          marginBottom: '14px', fontWeight: 500,
        }}>
          Po {loanYears} letech vyhrává <strong style={{ color: '#1C1917' }}>{winner}</strong>
        </div>
        <div className="ms-result-amount">{fmtCZK(Math.abs(diff))}</div>
        <div style={{ marginTop: '12px', fontSize: '14px', color: '#57534E' }}>
          o tolik <strong>více</strong> v majetku oproti druhému scénáři
        </div>
        <div style={{
          marginTop: '24px', display: 'flex', flexWrap: 'wrap',
          justifyContent: 'center', gap: '16px',
        }}>
          <div style={{
            padding: '14px 20px', backgroundColor: '#FFFFFF',
            border: diff <= 0 ? '2px solid #6B8E4E' : '1px solid #E5DDD0',
            borderRadius: '8px', textAlign: 'left', minWidth: '220px',
          }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#57534E', fontWeight: 600, marginBottom: '6px' }}>
              Scénář 1 — Hotovost
            </div>
            <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', color: '#1C1917', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
              {fmtCZK(final.netWealth1)}
            </div>
            <div style={{ fontSize: '11px', color: '#78716C', marginTop: '4px', fontStyle: 'italic' }}>
              Portfolio na konci
            </div>
          </div>
          <div style={{
            padding: '14px 20px', backgroundColor: '#FFFFFF',
            border: diff > 0 ? '2px solid #6B8E4E' : '1px solid #E5DDD0',
            borderRadius: '8px', textAlign: 'left', minWidth: '220px',
          }}>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.18em', color: '#57534E', fontWeight: 600, marginBottom: '6px' }}>
              Scénář 2 — Úvěr
            </div>
            <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', color: '#1C1917', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
              {fmtCZK(final.netWealth2)}
            </div>
            <div style={{ fontSize: '11px', color: '#78716C', marginTop: '4px', fontStyle: 'italic' }}>
              Portfolio − zbytek úvěru
            </div>
          </div>
        </div>
      </div>

      {/* STAT KARTY */}
      <div className="ms-stats-grid" style={{ marginBottom: '24px' }}>
        <StatCard
          label="Měsíční splátka úvěru"
          value={fmtCZK(sim.monthlyPayment)}
          accent="neutral"
          sub={`Po ${loanYears} let`}
        />
        <StatCard
          label="Celkové úroky bance"
          value={fmtCZK(sim.monthlyPayment * loanYears * 12 - amount)}
          accent="orange"
          sub="Cena úvěru"
        />
        <StatCard
          label="Zisk z investice"
          value={fmtCZK(Math.max(0, investGrowth))}
          accent="green"
          sub={`Scénář 2, hodnota portfolia na konci ${fmtCZK(final.p2)}`}
        />
        <StatCard
          label="Break-even výnos"
          value={breakEven === null ? '—' : fmtPct2(breakEven)}
          accent={breakEven !== null && investReturn > breakEven ? 'green' : 'gold'}
          sub={breakEven === null
            ? 'Úvěr se nevyplatí ani při extrémním výnosu'
            : investReturn > breakEven
              ? `Váš odhad (${fmtPct(investReturn)}) je nad hranicí`
              : `Váš odhad (${fmtPct(investReturn)}) je pod hranicí`}
        />
      </div>

      {/* GRAF — rozdíl scénářů v čase */}
      <div style={{
        backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0', borderRadius: '10px',
        padding: '24px', boxShadow: '0 1px 3px rgba(60,40,20,0.04)', marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 className="ms-section-title">
            <span style={{ width: '24px', height: '1px', backgroundColor: '#D97757' }} />
            Rozdíl scénářů v čase
          </h3>
          <div style={{ fontSize: '11px', color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
            výnos {fmtPct(investReturn)} · úvěr {fmtPct(loanRate)}
          </div>
        </div>
        <p style={{ fontSize: '13px', color: '#57534E', margin: '4px 0 18px', lineHeight: 1.5 }}>
          Nad nulou = úvěr je výhodnější o tu částku. Pod nulou = hotovost vyhrává. Kde křivka protne nulu, je <strong>break-even bod</strong> — kdy se rozhodnutí převrací.
        </p>
        <ResponsiveContainer width="100%" height={380}>
          <AreaChart data={diffChartData} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="diffGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset={0} stopColor="#6B8E4E" stopOpacity={0.5} />
                <stop offset={gradientOffset} stopColor="#6B8E4E" stopOpacity={0.05} />
                <stop offset={gradientOffset} stopColor="#C2410C" stopOpacity={0.05} />
                <stop offset={1} stopColor="#C2410C" stopOpacity={0.5} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="#EADFCB" />
            <XAxis dataKey="year" stroke="#A8A29E" tick={{ fill: '#78716C', fontSize: 11 }}
                   label={{ value: 'Rok', position: 'insideBottom', offset: -3, fill: '#78716C', fontSize: 11 }} />
            <YAxis stroke="#A8A29E" tick={{ fill: '#78716C', fontSize: 11 }} tickFormatter={yAxisFmt} />
            <Tooltip
              formatter={(v) => fmtCZK(v)}
              labelFormatter={(l) => `Rok ${l}`}
              contentStyle={{
                backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0',
                borderRadius: '6px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
              }}
              labelStyle={{ color: '#A84E2E', fontFamily: "'Playfair Display', serif" }}
            />
            <ReferenceLine y={0} stroke="#78716C" strokeWidth={1.5} strokeDasharray="4 4" />
            <Area
              type="monotone"
              dataKey="diff"
              name="Rozdíl (úvěr − hotovost)"
              stroke="#D97757"
              strokeWidth={2.5}
              fill="url(#diffGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* SENZITIVNÍ MATICE */}
      <div style={{
        backgroundColor: '#FFFFFF', border: '1px solid #E5DDD0', borderRadius: '10px',
        padding: '24px', boxShadow: '0 1px 3px rgba(60,40,20,0.04)', marginBottom: '24px',
      }}>
        <h3 className="ms-section-title" style={{ marginBottom: '8px' }}>
          <span style={{ width: '24px', height: '1px', backgroundColor: '#D97757' }} />
          Citlivost: kdy se úvěr vyplatí?
        </h3>
        <p style={{ fontSize: '13px', color: '#57534E', marginBottom: '20px', lineHeight: 1.55 }}>
          Buňky ukazují <strong>rozdíl scénáře úvěr − hotovost</strong> po {loanYears} letech.
          Zelená = úvěr vyhrává, červená = hotovost vyhrává.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="ms-sens-table" style={{ minWidth: '560px' }}>
            <thead>
              <tr>
                <th style={{ borderTopLeftRadius: '6px' }}>Výnos \ Sazba</th>
                {rateCol.map((c, i) => (
                  <th key={c} style={i === rateCol.length - 1 ? { borderTopRightRadius: '6px' } : {}}>
                    {fmtPct(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, ri) => (
                <tr key={row.ret}>
                  <td className="ms-cell-rowhead" style={ri === matrix.length - 1 ? { borderBottomLeftRadius: '6px' } : {}}>
                    {fmtPct(row.ret)}
                  </td>
                  {row.cells.map((c, ci) => {
                    const positive = c.diff > 0;
                    const magnitude = Math.min(1, Math.abs(c.diff) / (amount * 0.5));
                    const bg = positive
                      ? `rgba(107, 142, 78, ${0.12 + magnitude * 0.35})`
                      : `rgba(194, 65, 12, ${0.10 + magnitude * 0.30})`;
                    const color = positive ? '#4F6B3A' : '#9A2E0B';
                    const isLastRow = ri === matrix.length - 1;
                    const isLastCol = ci === row.cells.length - 1;
                    return (
                      <td key={c.rate} style={{
                        background: bg, color, fontWeight: 600,
                        borderBottomRightRadius: isLastRow && isLastCol ? '6px' : 0,
                      }}>
                        {positive ? '+' : '−'} {fmtCZK(Math.abs(c.diff))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
//  HLAVNÍ KOMPONENTA
// ════════════════════════════════════════════════════════════════════
export default function CreditCalculator() {
  const [activeModule, setActiveModule] = useState('mortgage');

  const titles = {
    mortgage: 'Hypoteční kalkulačka',
    compare: 'Srovnání dvou úvěrů',
    vs_invest: 'Úvěr vs. investice',
  };

  return (
    <div style={{
      minHeight: '100vh', color: '#1C1917',
      background: 'radial-gradient(ellipse at top, #FAF8F2 0%, #F5F1E8 100%)',
      fontFamily: "'Inter', system-ui, sans-serif", position: 'relative',
    }}>
      <GlobalStyles />
      <div className="ms-bg-dots" />

      <div className="ms-container" style={{ position: 'relative', zIndex: 1 }}>
        <header style={{ marginBottom: '40px' }}>
          <h1 className="ms-hero-title">{titles[activeModule]}</h1>
          <div className="ms-hero-underline" />
        </header>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '40px' }}>
          <ModernToggle
            value={activeModule}
            onChange={setActiveModule}
            options={[
              { value: 'mortgage', label: 'Hypotéka' },
              { value: 'compare', label: 'Srovnání' },
              { value: 'vs_invest', label: 'Úvěr vs. investice' },
            ]}
          />
        </div>

        {activeModule === 'mortgage' && <MortgageModule />}
        {activeModule === 'compare' && <LoanComparisonModule />}
        {activeModule === 'vs_invest' && <LoanVsInvestModule />}

        <footer style={{ marginTop: '64px', paddingTop: '32px', borderTop: '1px solid #E5DDD0', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#78716C', lineHeight: 1.6, maxWidth: '720px', margin: '0 auto' }}>
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.2em', color: '#57534E' }}>Upozornění ·</span>{' '}
            Kalkulačka slouží k orientačním modelovým výpočtům. Výpočet předpokládá konstantní úrokovou sazbu a inflaci
            po celou dobu, anuitní splátky a — v modulu Úvěr vs. investice — konstantní výnos investice bez volatility a bez zdanění.
            Nezohledňuje pojištění schopnosti splácet, vedení účtu, odhad nemovitosti, poplatek za zpracování úvěru
            ani případné refinancování po skončení fixace. Nejedná se o investiční ani úvěrové doporučení.
          </p>
        </footer>
      </div>
    </div>
  );
}
