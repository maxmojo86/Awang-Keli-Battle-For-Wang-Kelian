import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  DEFAULT_HUD_VISIBILITY,
  HUD_VISIBILITY_ITEMS,
  MINIMAL_HUD_VISIBILITY,
} from '../game/settings';
import { HudVisibilitySettings } from '../game/types';

interface HudVisibilityControlsProps {
  hudVisibility: HudVisibilitySettings;
  onChange: (next: HudVisibilitySettings) => void;
  compact?: boolean;
}

export const HudVisibilityControls: React.FC<HudVisibilityControlsProps> = ({
  hudVisibility,
  onChange,
  compact = false,
}) => {
  const visibleCount = HUD_VISIBILITY_ITEMS.reduce(
    (acc, item) => acc + (hudVisibility[item.key] ? 1 : 0),
    0
  );
  const allVisible = visibleCount === HUD_VISIBILITY_ITEMS.length;
  const isMinimalPreset = HUD_VISIBILITY_ITEMS.every(
    (item) => hudVisibility[item.key] === MINIMAL_HUD_VISIBILITY[item.key]
  );

  const toggleItem = (key: keyof HudVisibilitySettings, checked: boolean) => {
    onChange({
      ...hudVisibility,
      [key]: checked,
    });
  };

  return (
    <div className="space-y-2.5" data-testid="hud-visibility-controls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          <Eye className="w-3.5 h-3.5 text-[#f3d285] shrink-0" aria-hidden="true" />
          <span className="font-medium text-[#f3e6c8]">HUD Element Visibility</span>
          <span className="font-mono-num text-[11px] text-[#9cb0ba]">
            ({visibleCount}/{HUD_VISIBILITY_ITEMS.length})
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-pressed={isMinimalPreset}
            onClick={() => onChange({ ...MINIMAL_HUD_VISIBILITY })}
            className={`px-2 py-0.5 text-[11px] rounded-[2px] border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] whitespace-nowrap ${
              isMinimalPreset
                ? 'border-[#f3d285]/60 bg-[#c99c4a] text-[#0b1218] font-semibold'
                : 'border-[#4a3c22] bg-[#0b1218] text-[#cbd5e1] hover:border-[#c99c4a] hover:text-white'
            }`}
          >
            Minimal HUD
          </button>
          <button
            type="button"
            aria-pressed={allVisible}
            onClick={() => onChange({ ...DEFAULT_HUD_VISIBILITY })}
            className={`px-2 py-0.5 text-[11px] rounded-[2px] border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3d285] whitespace-nowrap ${
              allVisible
                ? 'border-[#f3d285]/60 bg-[#c99c4a] text-[#0b1218] font-semibold'
                : 'border-[#4a3c22] bg-[#0b1218] text-[#cbd5e1] hover:border-[#c99c4a] hover:text-white'
            }`}
          >
            Show All
          </button>
        </div>
      </div>

      <div
        className={
          compact
            ? 'grid grid-cols-1 sm:grid-cols-2 gap-1.5'
            : 'space-y-2'
        }
      >
        {HUD_VISIBILITY_ITEMS.map((item) => {
          const checked = hudVisibility[item.key];
          return (
            <label
              key={item.key}
              className={`flex items-center justify-between gap-2.5 cursor-pointer rounded-[2px] border transition-colors ${
                compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
              } ${
                checked
                  ? 'border-[#2d404d] bg-[#0d171f]/85 hover:border-[#6e5629]'
                  : 'border-[#1f2c36] bg-[#081016]/75 opacity-80 hover:border-[#4a3c22]'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-[#e6e4dd]">
                  {!checked && (
                    <EyeOff className="w-3 h-3 text-[#9cb0ba] shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{item.label}</span>
                </div>
                {!compact && (
                  <p className="text-[11px] text-[#9cb0ba] leading-snug mt-0.5">
                    {item.description}
                  </p>
                )}
              </div>
              <input
                type="checkbox"
                data-hud-toggle={item.key}
                checked={checked}
                aria-label={`Show ${item.label}`}
                onChange={(e) => toggleItem(item.key, e.target.checked)}
                className="accent-[#c99c4a] w-4 h-4 shrink-0 cursor-pointer"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
};
