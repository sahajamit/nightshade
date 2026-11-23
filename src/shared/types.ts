/**
 * Nightshade configuration model.
 *
 * One JSON document (the "config") holds global defaults, named palettes and
 * an ordered list of site rules. The same document lives in the extension's
 * storage and, when the agent bridge is installed, in ~/.nightshade/config.json.
 */

export type Mode = 'off' | 'native' | 'dynamic' | 'filter' | 'bespoke';
export const MODES: readonly Mode[] = ['off', 'native', 'dynamic', 'filter', 'bespoke'];

/** What to do on a site that has no rule. */
export type UnlistedBehaviour =
    /** Recolour light sites; leave sites that are already dark in their own theme (boosts still run). */
    | 'skip-already-dark'
    /** Recolour every site, even ones that are already dark. */
    | 'always'
    /** Do nothing unless the site has a rule. */
    | 'only-listed';
export const UNLISTED: readonly UnlistedBehaviour[] = ['skip-already-dark', 'always', 'only-listed'];

/** Minimum contrast ratio enforced on text, icons and control borders. 0 = off. */
export type ContrastFloor = 0 | 3 | 4.5 | 7;
export const CONTRAST_FLOORS: readonly ContrastFloor[] = [0, 3, 4.5, 7];

export type FixAction =
    | 'make-visible'
    | 'invert'
    | 'set-colour'
    | 'strengthen-border'
    | 'leave-untouched'
    | 'hide'
    /** Find large light panels inside the element (on an otherwise dark page) and invert them, photos restored. */
    | 'darken';
export const FIX_ACTIONS: readonly FixAction[] = [
    'make-visible', 'invert', 'set-colour', 'strengthen-border', 'leave-untouched', 'hide', 'darken',
];

export interface Fix {
    /** CSS selector. Prefer roles and aria-labels over generated class names. */
    selector: string;
    action: FixAction;
    /** Required for set-colour, optional for strengthen-border. */
    colour?: string;
    note?: string;
}

export interface Palette {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    link: string;
    border: string;
    icon: string;
    selection: string;
}
export const PALETTE_KEYS: readonly (keyof Palette)[] = [
    'bg', 'surface', 'text', 'muted', 'link', 'border', 'icon', 'selection',
];

/** Look-and-feel settings. Every field is optional on a site rule (inherits global). */
export interface Look {
    /** 50-150, percent. */
    brightness?: number;
    /** 50-150, percent. */
    contrast?: number;
    /** 0-100, percent. "Warmth" in the UI. */
    sepia?: number;
    /** 0-100, percent. */
    grayscale?: number;
    contrastFloor?: ContrastFloor;
    /** Lighten small dark icons (inside buttons, checkboxes, menus). */
    iconRescue?: boolean;
    /** 50-100, percent brightness applied to large images and video. 100 = off. */
    imageDim?: number;
    /** Name of a palette in config.palettes. Used by bespoke mode. */
    palette?: string;
    /** Font family override. Empty = site's own fonts. */
    fontFamily?: string;
    /** 0-1 px text stroke, for thin fonts. */
    textStroke?: number;
    /** Extra CSS. In bespoke mode the palette is exposed as var(--ns-bg), var(--ns-text) and so on. */
    css?: string;
}

export interface SiteRule extends Look {
    /**
     * URL patterns, without protocol. "example.com" matches the domain and all
     * subdomains. "app.example.com/inbox" matches that path prefix.
     * "*.example.com" matches subdomains only.
     */
    match: string[];
    mode: Mode;
    fixes?: Fix[];
    note?: string;
}

export interface GlobalSettings extends Required<Omit<Look, 'palette' | 'css'>> {
    /** Master switch. */
    enabled: boolean;
    /** Mode used on light sites without a rule. */
    mode: 'dynamic' | 'filter' | 'bespoke';
    unlisted: UnlistedBehaviour;
    palette: string;
    /** Use Dark Reader's community site fixes in dynamic and bespoke modes. */
    useBuiltInFixes: boolean;
}

export interface Config {
    version: 1;
    /** ISO timestamp of the last change. Used to reconcile the extension and the config file. */
    updatedAt: string;
    global: GlobalSettings;
    palettes: Record<string, Palette>;
    sites: SiteRule[];
}

/** Everything a page needs to render, after resolving the rule for its URL. */
export interface Resolved {
    /** The rule that matched, or null for an unlisted site. */
    rule: SiteRule | null;
    /** The pattern that matched, for display. */
    matchedPattern: string | null;
    mode: Mode;
    /** True when an unlisted site should be checked for an existing dark theme first. */
    detectDark: boolean;
    look: Required<Omit<Look, 'css' | 'palette'>> & {palette: Palette; paletteName: string; css: string};
    fixes: Fix[];
    paused: boolean;
    /** Why this mode was chosen, for the popup. */
    reason: 'rule' | 'unlisted' | 'known-dark' | 'disabled' | 'paused' | 'only-listed';
}
