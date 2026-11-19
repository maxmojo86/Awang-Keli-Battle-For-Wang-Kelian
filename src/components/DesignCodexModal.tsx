import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { resolveAssetUrl } from '../utils/assetUrl';

export interface DesignPlate {
  id: string;
  title: string;
  subtitle: string;
  src: string;
}

export const DESIGN_PLATES: DesignPlate[] = [
  {
    id: 'overview',
    title: 'Game Design Overview',
    subtitle: 'Awang Keli: Battle for Wang Kelian · Core fantasy & evolution',
    src: resolveAssetUrl('assets/aistudio/ChatGPT_Image_Nov_17__2026__03_53_00_PM_9939185b.png'),
  },
  {
    id: 'gameplay',
    title: '2.5D Elevated Gameplay View',
    subtitle: 'Directional 2D sprites on 3D lakeside jetty & glowing cavern',
    src: resolveAssetUrl('assets/aistudio/ChatGPT_Image_Nov_17__2026__03_53_25_PM_036eb1d0.png'),
  },
  {
    id: 'lineup',
    title: 'Evolution & Class Lineup',
    subtitle: '11 level milestones from Lv.1 fry to Lv.100 Keli King',
    src: resolveAssetUrl('assets/aistudio/ChatGPT_Image_Nov_17__2026__03_53_55_PM_8cc3d559.png'),
  },
  {
    id: 'systems',
    title: 'Core Systems & Evolution Rules',
    subtitle: 'Mass conservation, combat loop, and shore exposure thresholds',
    src: resolveAssetUrl('assets/aistudio/ChatGPT_Image_Nov_17__2026__03_54_02_PM_3be55285.png'),
  },
  {
    id: 'bestiary-1',
    title: 'Bestiary: Levels 1–39',
    subtitle: 'Early Aquatic Form · Limbless catfish & early Echo Sonar',
    src: resolveAssetUrl('assets/aistudio/ChatGPT_Image_Nov_17__2026__03_54_10_PM_bc6f2c88.png'),
  },
  {
    id: 'bestiary-2',
    title: 'Bestiary: Levels 40–79',
    subtitle: 'Crawling Form · Two arms, fish tail & 10-second shore raids',
    src: resolveAssetUrl('assets/aistudio/ChatGPT_Image_Nov_17__2026__03_54_14_PM_8aa20377.png'),
  },
  {
    id: 'bestiary-3',
    title: 'Bestiary: Levels 80–100',
    subtitle: 'Keli King Ascension · Fully amphibious biped & Hunter Sonar',
    src: resolveAssetUrl('assets/aistudio/ChatGPT_Image_Nov_17__2026__03_54_18_PM_341b30a9.png'),
  },
];

interface DesignCodexModalProps {
  open: boolean;
  initialPlateId?: string;
  onClose: () => void;
}

export const DesignCodexModal: React.FC<DesignCodexModalProps> = ({
  open,
  initialPlateId = 'overview',
  onClose,
}) => {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (open) {
      const found = DESIGN_PLATES.findIndex((p) => p.id === initialPlateId);
      setIdx(Math.max(0, found));
    }
  }, [open, initialPlateId]);

  if (!open) return null;
  const plate = DESIGN_PLATES[idx] ?? DESIGN_PLATES[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bestiary & Visual Design Codex"
    >
      <div className="flex flex-col w-full max-w-5xl max-h-[92vh] rounded-lg border-2 border-[#c99c4a] bg-[#101920] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-[#5b4724] bg-[#0b1218]">
          <div className="min-w-0">
            <div className="text-[11px] font-medium tracking-wider text-[#d9b25f] truncate">
              FIELD BESTIARY & VISUAL CODEX · {idx + 1} / {DESIGN_PLATES.length}
            </div>
            <h2 className="font-display text-xl font-semibold text-[#f7f2e7] truncate">
              {plate.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Bestiary Codex"
            className="p-1.5 rounded border border-[#5b4724] text-[#c7d1cd] hover:text-white hover:border-[#c99c4a] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Plate Tabs */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-[#1d2b35] bg-[#0e161d] overflow-x-auto">
          {DESIGN_PLATES.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setIdx(i)}
              className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                i === idx
                  ? 'border-[#c99c4a] bg-[#c99c4a] text-[#0b1218] font-semibold'
                  : 'border-[#253642] bg-[#131f28] text-[#a9b9c2] hover:text-white'
              }`}
            >
              {p.title}
            </button>
          ))}
        </div>

        {/* Plate Image */}
        <div className="flex-1 overflow-y-auto bg-[#090f14] p-4 flex flex-col items-center justify-center">
          <img
            src={plate.src}
            alt={plate.title}
            referrerPolicy="no-referrer"
            className="max-h-[64vh] w-auto object-contain rounded border border-[#3a3222] shadow-xl"
          />
          <p className="text-xs text-[#b8c4bf] mt-3 text-center">{plate.subtitle}</p>
        </div>

        {/* Footer Nav */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#5b4724] bg-[#0b1218]">
          <button
            type="button"
            disabled={idx === 0}
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[#5b4724] text-[#e6dfd0] disabled:opacity-40 hover:border-[#c99c4a]"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous Plate
          </button>
          <button
            type="button"
            disabled={idx === DESIGN_PLATES.length - 1}
            onClick={() => setIdx((i) => Math.min(DESIGN_PLATES.length - 1, i + 1))}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[#5b4724] text-[#e6dfd0] disabled:opacity-40 hover:border-[#c99c4a]"
          >
            Next Plate
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
