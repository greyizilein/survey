export const BRAND_LIME = "#b6de48";
const BRAND_LIME_SHADE = "#93b93a";

/** The app's mark: a folded-corner square — a document, finished and sealed. */
export function Logo({ className, fold = true }: { className?: string; fold?: boolean }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <path
        d="M26 14 H94 A12 12 0 0 1 106 26 V70 L70 106 H26 A12 12 0 0 1 14 94 V26 A12 12 0 0 1 26 14 Z"
        fill={BRAND_LIME}
      />
      {fold && <polygon points="106,70 70,106 70,70" fill={BRAND_LIME_SHADE} />}
    </svg>
  );
}

/** Standalone SVG markup (explicit colors, no currentColor) for use outside React — e.g. the favicon data URI. */
export const LOGO_SVG_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M26 14 H94 A12 12 0 0 1 106 26 V70 L70 106 H26 A12 12 0 0 1 14 94 V26 A12 12 0 0 1 26 14 Z" fill="${BRAND_LIME}"/><polygon points="106,70 70,106 70,70" fill="${BRAND_LIME_SHADE}"/></svg>`;
