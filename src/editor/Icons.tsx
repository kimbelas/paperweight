/**
 * Icons.
 *
 * Hand-written inline SVG rather than an icon package: there are fifteen of
 * them, they need to inherit `currentColor` and stroke width from their
 * button, and a dependency for that would be larger than the icons.
 *
 * All are drawn on a 24-unit grid with a 1.75 stroke, so they sit together at
 * any size without one looking heavier than its neighbours.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: every icon here sits inside a button that carries its own
      // accessible name, so announcing the graphic too would just repeat it.
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export const IconSelect = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 3l7.5 17 2.2-6.3L20 11.5z" />
  </Svg>
);

export const IconEditText = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M9 6v13M15 6v6" />
    <path d="M13 20l7-7 2.5 2.5-7 7H13z" opacity="0.55" />
  </Svg>
);

export const IconAddText = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h12M9 6v13" />
    <path d="M18 10v8M14 14h8" />
  </Svg>
);

export const IconCover = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="10" rx="1.5" />
    <path d="M6 12h12" opacity="0.5" />
  </Svg>
);

export const IconSignature = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17c3.5 0 4-11 7-11s1.5 9 4 9 2.5-4 4-4" />
    <path d="M3 21h18" opacity="0.5" />
  </Svg>
);

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.75" />
    <path d="M21 16l-5-5-6.5 9" />
  </Svg>
);

export const IconScanText = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8V6a2 2 0 012-2h2M20 8V6a2 2 0 00-2-2h-2M4 16v2a2 2 0 002 2h2M20 16v2a2 2 0 01-2 2h-2" />
    <path d="M8 10h8M8 14h5" />
  </Svg>
);

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 010 12h-4" />
  </Svg>
);

export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 000 12h4" />
  </Svg>
);

export const IconRotate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 5v5h-5" />
    <path d="M20 10a8 8 0 10-2.5 7.5" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" opacity="0.5" />
  </Svg>
);

export const IconPrint = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 9V4h10v5" />
    <rect x="4" y="9" width="16" height="7" rx="1.5" />
    <path d="M7 14h10v6H7z" />
  </Svg>
);

export const IconSave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3h11l3 3v15H5z" />
    <path d="M9 3v6h6V3" />
    <path d="M9 14h6v7H9z" opacity="0.6" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v11" />
    <path d="M8 11l4 4 4-4" />
    <path d="M4 19h16" />
  </Svg>
);

export const IconOpen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7V5h5l2 2h9v12H4z" />
    <path d="M4 10h16" opacity="0.5" />
  </Svg>
);

export const IconPanel = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Svg>
);

export const IconZoomIn = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M11 8.5v5M8.5 11h5M20 20l-4.4-4.4" />
  </Svg>
);

export const IconZoomOut = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M8.5 11h5M20 20l-4.4-4.4" />
  </Svg>
);

export const IconKeyboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
  </Svg>
);

export const IconWarning = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l9 16H3z" />
    <path d="M12 9v5M12 17h.01" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 13l4 4L19 7" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

export const IconPages = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="11" height="14" rx="1.5" />
    <path d="M9 21h9a1.5 1.5 0 001.5-1.5V8" opacity="0.55" />
  </Svg>
);

export const IconShape = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5l6 6-6 6" opacity="0.55" />
    <path d="M13 6l7 6-7 6z" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="12" rx="1.5" />
    <path d="M15 6V4.5A1.5 1.5 0 0013.5 3H5.5A1.5 1.5 0 004 4.5v9A1.5 1.5 0 005.5 15H6" opacity="0.6" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconTick = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <path d="M8 12.5l2.8 2.8L16 9.5" />
  </Svg>
);

export const IconUntick = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
  </Svg>
);

export const IconField = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="10" rx="2" />
    <path d="M7 10v4" />
  </Svg>
);

export const IconWiden = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6v12M21 6v12" opacity="0.55" />
    <path d="M7 12h10M9 9.5L6.5 12 9 14.5M15 9.5l2.5 2.5-2.5 2.5" />
  </Svg>
);

export const IconEraser = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 20l-4-4 9-9 4 4-9 9z" />
    <path d="M11 20h9" opacity="0.55" />
  </Svg>
);

export const IconTools = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </Svg>
);

export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.25" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
  </Svg>
);

export const IconMark = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2.5" opacity="0.45" />
    <path d="M8 8l8 8M16 8l-8 8" />
  </Svg>
);

export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20V5M6 11l6-6 6 6" />
  </Svg>
);

export const IconArrowDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v15M6 13l6 6 6-6" />
  </Svg>
);
