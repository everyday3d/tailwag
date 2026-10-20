import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Dog,
  Upload,
  SlidersHorizontal,
  Library,
  Wand2,
  Scale,
  Eye,
  Box,
  Layers,
  Ruler,
  Shapes,
  Target,
  Package,
  Save,
  PartyPopper,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export const ONBOARDING_STORAGE_KEY = 'tailwag_onboarding_v1_seen';

export function hasSeenOnboarding(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    return true; // storage unavailable: do not nag on every launch
  }
}

function markOnboardingSeen() {
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
  } catch {
    // ignore storage errors
  }
}

type Placement = 'left' | 'right' | 'top' | 'bottom';

interface TourStep {
  /** Value of the data-tour attribute on the element to point at. Omit for a centered card. */
  target?: string;
  title: string;
  body: string;
  tips?: string[];
  icon: React.ReactNode;
  placement?: Placement;
}

const ICON = 'w-5 h-5';

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to TailWag Studio',
    body: 'Turn any photo into a multi-colour relief print. This quick tour shows each part of the screen and how to use it. It takes about a minute.',
    tips: ['Use the arrow keys or the buttons to move through the steps.', 'Press Esc to skip. You can replay it any time with the ? button at the top right.'],
    icon: <Dog className={ICON} />,
  },
  {
    target: 'load-image',
    title: '1. Load a photo',
    body: 'Start here. Pick the picture you want to print.',
    tips: ['Clear subjects with good contrast work best.', 'You can swap the photo later and keep your settings.'],
    icon: <Upload className={ICON} />,
    placement: 'bottom',
  },
  {
    target: 'project',
    title: 'Save and reopen your work',
    body: 'The folder and disk buttons save and open a project: your photo, filaments, swap layers and every setting in one file. Nothing is lost when you close the app.',
    tips: ['Ctrl+S saves and Ctrl+O opens.', 'Next time you start, TailWag offers to reopen your last project.'],
    icon: <Save className={ICON} />,
    placement: 'bottom',
  },  {
    target: 'prepress',
    title: '2. Tidy the photo (pre-press)',
    body: 'Adjust contrast, detail and smoothing before anything is solved. The 3D view updates as you move the sliders.',
    tips: ['If fur or fine texture looks noisy, raise smoothing.', 'The defaults are a good starting point.'],
    icon: <SlidersHorizontal className={ICON} />,
    placement: 'right',
  },
  {
    target: 'library',
    title: '3. Your filament library',
    body: 'List the spools you own. TailWag only builds recipes from filaments you have, and the badge on each spool shows how trustworthy its TD (see-through distance) is.',
    tips: ['Estimate = guessed from colour. Measured = read with a TD tool or calibrated.', 'Open the library to search a brand catalog or add your own spool.'],
    icon: <Library className={ICON} />,
    placement: 'right',
  },
  {
    target: 'solver',
    title: '4. Pick colours and solve',
    body: 'Choose how many colours to use, then let the auto-solver pick the best spools and the exact layers where each colour starts. Prefer full control? Switch to Manual and build the stack yourself.',
    tips: ['More colours means a closer match but more filament changes.', 'Drag spools into the list to reorder them.'],
    icon: <Wand2 className={ICON} />,
    placement: 'left',
  },
  {
    target: 'match-mode',
    title: 'Faithful or Vivid',
    body: 'Faithful picks colours that match your photo as closely as the plastic allows. Vivid pushes saturation for a bolder look.',
    tips: ['Faithful is the default and is what the accuracy report measures.'],
    icon: <Scale className={ICON} />,
    placement: 'bottom',
  },
  {
    target: 'view-modes',
    title: '5. Choose a view',
    body: 'Switch between the painted 3D print, a split wipe and the original photo. True colour shows colours without extra lighting; Studio light adds shading.',
    tips: ['Use Photo to compare against your original.'],
    icon: <Eye className={ICON} />,
    placement: 'bottom',
  },
  {
    target: 'viewport',
    title: '6. Inspect the 3D preview',
    body: 'This is a prediction of the printed result. Drag to rotate, scroll to zoom.',
    tips: ['Colours are predictions until you calibrate your filaments.'],
    icon: <Box className={ICON} />,
    placement: 'top',
  },
  {
    target: 'timeline',
    title: '7. The layer timeline',
    body: 'Each coloured block is a filament and the layers it prints. The dividers are the filament changes. Drag a divider to move where a colour change happens.',
    tips: ['Fewer, thicker blocks mean fewer swaps.'],
    icon: <Layers className={ICON} />,
    placement: 'top',
  },
  {
    target: 'dims',
    title: '8. Size and layers',
    body: 'Set the physical size, layer height, base thickness and total depth of the print.',
    tips: ['Standard is a 0.16 mm first layer and 0.08 mm layers.', 'Thicker total depth lets colours blend over more layers.'],
    icon: <Ruler className={ICON} />,
    placement: 'left',
  },
  {
    target: 'cad',
    title: '9. Shape and extras',
    body: 'Cut the print into a shape, add a frame, a keychain hole, magnet pockets, or turn it into a wall clock.',
    tips: ['These are optional. Leave them off for a plain rectangular plaque.'],
    icon: <Shapes className={ICON} />,
    placement: 'left',
  },
  {
    target: 'calibration',
    title: '10. Calibrate for exact colour',
    body: 'Open the ruler menu and choose Calibration plate. Print one small plate, photograph it, and TailWag measures how each of your filaments really looks. Predictions then use your real colours.',
    tips: ['Optional, but it is the biggest step toward print-matches-preview.'],
    icon: <Target className={ICON} />,
    placement: 'bottom',
  },
  {
    target: 'export',
    title: '11. Export and print',
    body: 'Export a .3MF for Bambu Studio or OrcaSlicer, or an STL with a swap guide for single-colour printers. The file is re-checked against the plan, and a fidelity report shows how close the print should look.',
    tips: ['Open the .3MF and slice without changing the layer settings.'],
    icon: <Package className={ICON} />,
    placement: 'bottom',
  },
  {
    title: 'You are ready',
    body: 'Load a photo, let the solver pick a recipe, check the preview, then export. Enjoy the print.',
    tips: ['Replay this tour any time with the ? button at the top right.'],
    icon: <PartyPopper className={ICON} />,
  },
];

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CARD_W = 340;
const PAD = 8;
const GAP = 64;
const EDGE = 12;

function readRect(target?: string): Rect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function sameRect(a: Rect | null, b: Rect | null) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function bestPlacement(rect: Rect, cardH: number, hint?: Placement): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const room: Record<Placement, number> = {
    right: vw - (rect.left + rect.width) - EDGE - CARD_W - GAP,
    left: rect.left - EDGE - CARD_W - GAP,
    bottom: vh - (rect.top + rect.height) - EDGE - cardH - GAP,
    top: rect.top - EDGE - cardH - GAP,
  };
  if (hint && room[hint] >= 0) return hint;
  return (Object.keys(room) as Placement[]).sort((a, b) => room[b] - room[a])[0];
}

interface Layout {
  card: { left: number; top: number };
  arrow: { d: string; ex: number; ey: number } | null;
}

function computeLayout(rect: Rect | null, cardH: number, hint?: Placement): Layout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect) {
    return { card: { left: (vw - CARD_W) / 2, top: Math.max(EDGE, (vh - cardH) / 2) }, arrow: null };
  }
  const t = { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };
  const side = bestPlacement(t, cardH, hint);
  let left: number;
  let top: number;
  if (side === 'right') {
    left = t.left + t.width + GAP;
    top = t.top + t.height / 2 - cardH / 2;
  } else if (side === 'left') {
    left = t.left - GAP - CARD_W;
    top = t.top + t.height / 2 - cardH / 2;
  } else if (side === 'bottom') {
    left = t.left + t.width / 2 - CARD_W / 2;
    top = t.top + t.height + GAP;
  } else {
    left = t.left + t.width / 2 - CARD_W / 2;
    top = t.top - GAP - cardH;
  }
  left = clamp(left, EDGE, vw - CARD_W - EDGE);
  top = clamp(top, EDGE, vh - cardH - EDGE);

  // Arrow: from the card edge nearest the target to the target's nearest edge, with a gentle curve.
  const cx = t.left + t.width / 2;
  const cy = t.top + t.height / 2;
  const sx = clamp(cx, left, left + CARD_W);
  const sy = clamp(cy, top, top + cardH);
  let startX = sx;
  let startY = sy;
  // Snap the start onto the card border (if the target centre is inside the card's span, project outward).
  if (side === 'right') startX = left;
  else if (side === 'left') startX = left + CARD_W;
  else if (side === 'bottom') startY = top;
  else startY = top + cardH;
  let ex = clamp(startX, t.left, t.left + t.width);
  let ey = clamp(startY, t.top, t.top + t.height);
  // If the card centre is level with the target, aim at the target centre edge for a straighter arrow.
  if (side === 'right' || side === 'left') ey = clamp(startY, t.top + 12, t.top + t.height - 12);
  else ex = clamp(startX, t.left + 12, t.left + t.width - 12);
  const dx = ex - startX;
  const dy = ey - startY;
  const len = Math.max(1, Math.hypot(dx, dy));
  // Pull the end back so the arrowhead does not sit on the highlight border.
  ex -= (dx / len) * 4;
  ey -= (dy / len) * 4;
  const mx = (startX + ex) / 2 - (dy / len) * Math.min(28, len * 0.25);
  const my = (startY + ey) / 2 + (dx / len) * Math.min(28, len * 0.25);
  return { card: { left, top }, arrow: { d: `M ${startX} ${startY} Q ${mx} ${my} ${ex} ${ey}`, ex, ey } };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingTour: React.FC<Props> = ({ isOpen, onClose }) => {
  // Development-only deep link (?tourstep=N) used to inspect a single step; ignored in production builds.
  const [step, setStep] = useState(() => {
    if (typeof window === 'undefined') return 0;
    if (!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return 0;
    const n = Number(new URLSearchParams(window.location.search).get('tourstep'));
    return Number.isInteger(n) && n >= 0 && n < TOUR_STEPS.length ? n : 0;
  });
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(240);
  const [, setTick] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const current = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;

  const finish = useCallback(() => {
    markOnboardingSeen();
    setStep(0);
    onClose();
  }, [onClose]);

  const go = useCallback(
    (delta: number) => {
      const next = step + delta;
      if (next < 0) return;
      if (next >= TOUR_STEPS.length) {
        finish();
        return;
      }
      setStep(next);
    },
    [step, finish]
  );

  // Bring the target into view (local scrolling only), then track its rectangle.
  useEffect(() => {
    if (!isOpen) return;
    const sel = current.target;
    if (sel) {
      const el = document.querySelector<HTMLElement>(`[data-tour="${sel}"]`);
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    setRect(readRect(sel));
    let alive = true;
    const poll = window.setInterval(() => {
      if (!alive) return;
      const next = readRect(sel);
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    }, 200);
    const onResize = () => setTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, step, current.target]);

  useLayoutEffect(() => {
    if (!isOpen || !cardRef.current) return;
    const h = cardRef.current.offsetHeight;
    if (Math.abs(h - cardH) > 1) setCardH(h);
  });

  useEffect(() => {
    if (!isOpen) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, go, finish, step]);

  if (!isOpen) return null;

  const layout = computeLayout(rect, cardH, current.placement);
  const hole = rect
    ? { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Guided tour">
      <style>{`
        @keyframes tw-tour-dash { to { stroke-dashoffset: -24; } }
        @keyframes tw-tour-pulse { 0%,100% { box-shadow: 0 0 0 9999px rgba(5,8,14,.72), 0 0 0 3px rgba(251,146,60,.95), 0 0 18px 4px rgba(251,146,60,.55); }
          50% { box-shadow: 0 0 0 9999px rgba(5,8,14,.72), 0 0 0 3px rgba(251,191,36,1), 0 0 30px 10px rgba(251,146,60,.35); } }
        @keyframes tw-tour-bob { 0%,100% { transform: translate(0,0); } 50% { transform: translate(3px,3px); } }
      `}</style>

      {/* Dimmed backdrop. With a target, the spotlight box casts the dimming instead. */}
      {!hole && <div className="absolute inset-0 bg-[#05080e]/75" onClick={finish} />}
      {hole && (
        <>
          <div className="absolute inset-0" onClick={finish} />
          <div
            className="absolute rounded-xl pointer-events-none"
            style={{
              left: hole.left,
              top: hole.top,
              width: hole.width,
              height: hole.height,
              animation: 'tw-tour-pulse 1.8s ease-in-out infinite',
            }}
          />
        </>
      )}

      {/* Arrow from the card to the highlighted area */}
      {layout.arrow && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          <defs>
            <marker id="tw-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#fb923c" />
            </marker>
          </defs>
          <path d={layout.arrow.d} fill="none" stroke="#0b0e14" strokeWidth="6" strokeLinecap="round" opacity="0.6" />
          <path
            d={layout.arrow.d}
            fill="none"
            stroke="#fb923c"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="8 6"
            markerEnd="url(#tw-arrow)"
            style={{ animation: 'tw-tour-dash 0.8s linear infinite' }}
          />
        </svg>
      )}

      {/* Explanation card */}
      <div
        ref={cardRef}
        className="absolute bg-[#121722] border border-orange-500/50 rounded-2xl shadow-2xl shadow-black/60 p-4 flex flex-col gap-2.5 text-slate-200"
        style={{ left: layout.card.left, top: layout.card.top, width: CARD_W }}
      >
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white">
            {current.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-orange-400">
              Step {step + 1} of {TOUR_STEPS.length}
            </div>
            <h2 className="text-sm font-extrabold text-white leading-tight">{current.title}</h2>
          </div>
          <button
            onClick={finish}
            aria-label="Skip tour"
            title="Skip tour"
            className="text-slate-500 hover:text-white transition"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">{current.body}</p>

        {current.tips && current.tips.length > 0 && (
          <ul className="flex flex-col gap-1">
            {current.tips.map((t, i) => (
              <li key={i} className="text-[11px] text-slate-400 flex gap-1.5">
                <span className="text-orange-400 shrink-0">&gt;</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-1 pt-0.5" aria-hidden="true">
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-4 bg-orange-400' : i < step ? 'w-1.5 bg-orange-400/50' : 'w-1.5 bg-slate-700'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between pt-1">
          <button onClick={finish} className="text-[11px] text-slate-500 hover:text-slate-300 underline transition">
            {last ? 'Close' : 'Skip tour'}
          </button>
          <div className="flex items-center gap-1.5">
            {step > 0 && (
              <button
                onClick={() => go(-1)}
                className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold transition"
              >
                <ChevronLeft size={13} /> Back
              </button>
            )}
            <button
              ref={nextRef}
              onClick={() => go(1)}
              className="flex items-center gap-0.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-xs font-bold text-white transition"
            >
              {last ? 'Start using TailWag' : step === 0 ? 'Start the tour' : 'Next'} {!last && <ChevronRight size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Lucide icons imported above are only used inside TOUR_STEPS; keep the unused-import linter quiet if one is added.
void [Save, Library, Wand2, Scale, Eye, Box, Layers, Ruler, Shapes, Target, Package, SlidersHorizontal];
