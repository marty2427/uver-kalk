# Úvěrová kalkulačka (uver-kalk)

Interaktivní kalkulačka v Reactu se třemi moduly:

- **Hypotéka** — měsíční splátka, LTV, DSTI/DTI, amortizační rozpis, grafy.
- **Srovnání dvou úvěrů** — který je celkově výhodnější.
- **Úvěr vs. investice** — kdy se vyplatí investovat místo splacení hotově (break-even výnos, citlivostní matice).

Postaveno na **Vite 6 + React 18 + Recharts**, připraveno k nasazení na **Cloudflare Pages**.

## Vývoj lokálně

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # produkční build do ./dist
npm run preview  # náhled produkčního buildu
```

## Nasazení na Cloudflare Pages

V Cloudflare dashboardu → **Workers & Pages → Create → Pages → Connect to Git** a nastav:

| Nastavení | Hodnota |
| --- | --- |
| Framework preset | `Vite` (nebo `None`) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `20` (čte se z `.node-version`) |

## „Ten klasický problém“ — a jak je tady ošéfovaný

Nejčastější důvody, proč Vite build na Cloudflare spadne nebo ukáže bílou stránku, a jak je tenhle repo řeší:

1. **Vite 7 + stará Node = spadlý build.** Vite 7 vyžaduje Node ≥ 20.19; Cloudflare často jede na starší Node a build padá (`crypto.hash is not a function`). → Záměrně používáme **Vite 6**, navíc je Node pinnutá v `.node-version` a `.nvmrc` na `20`.
2. **Bílá stránka / 404 na assetech.** Špatná `base` cesta. → `vite.config.js` má `base: './'` (relativní cesty k assetům fungují na root i podadresáři).
3. **404 po refreshi / na přímém odkazu (SPA).** → `public/_redirects` s pravidlem `/*  /index.html  200` pošle všechny cesty do SPA.
4. **Špatný výstupní adresář.** → Build jde do `dist` (default Vite), což je přesně to, co Cloudflare očekává.

## Struktura

```
.
├── index.html
├── vite.config.js
├── package.json
├── .node-version / .nvmrc      # pin Node 20 pro Cloudflare
├── public/
│   └── _redirects              # SPA fallback
└── src/
    ├── main.jsx                # vstupní bod
    └── CreditCalculator.jsx    # celá kalkulačka
```

## Disclaimer

Kalkulačka slouží k orientačním modelovým výpočtům, nejde o investiční ani úvěrové doporučení.
