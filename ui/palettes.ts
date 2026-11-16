import type {PageTheme} from '../core/theme/page-theme';

export type PalettePreference = 'neutral' | 'blue' | 'graphite' | 'paper' | 'sage' | 'teal' | 'violet' | 'rose';
const keys = ['canvas','surface','subtle','hover','text','muted','faint','line','primary','primary-hover','primary-text','focus'] as const;
const colors = {
  neutral: {
    light: ['#f6f6f5','#ffffff','#f1f1f0','#e9e9e8','#202020','#666666','#707070','#e1e1e0','#262626','#404040','#ffffff','#2563eb'],
    dark: ['#191919','#222222','#2c2c2c','#383838','#ededed','#b1b1b1','#959595','#383838','#ededed','#d5d5d5','#202020','#2563eb'],
  },
  blue: {
    light: ['#f5f7fa','#ffffff','#edf2fa','#e1eaf7','#1b2838','#526377','#5d6d80','#d5deeb','#155bb5','#0e4892','#ffffff','#155bb5'],
    dark: ['#131c28','#1b2736','#243447','#30435a','#edf3fc','#b3c2d6','#9bafc8','#3c5069','#a3c9ff','#c1daff','#13243b','#a3c9ff'],
  },
  graphite: {
    light: ['#f3f4f5','#ffffff','#eceef1','#dfe3e8','#24292f','#57606a','#626b76','#d0d7de','#344b67','#263b54','#ffffff','#235fb3'],
    dark: ['#181b20','#22262c','#2c323b','#383f4b','#e6ebf2','#b3becd','#9cacc1','#444e5e','#bbcadf','#d5e0ef','#1c2838','#a4c8ff'],
  },
  paper: {
    light: ['#f3eee4','#fcf9f2','#eee8dc','#e4dbc9','#352f27','#695d50','#756959','#d7cdbd','#6b5034','#543c25','#ffffff','#8a5a26'],
    dark: ['#211d19','#2b2520','#362e26','#443a30','#f3e9dc','#c6b8a7','#b4a492','#584a3b','#e2c59e','#f0d9bb','#2c2117','#e2c59e'],
  },
  sage: {
    light: ['#f1f5f0','#fcfdfb','#eaf0e7','#dce7d8','#27352b','#566758','#657362','#cdd9ca','#3d6547','#305339','#ffffff','#3d6547'],
    dark: ['#171e19','#202a23','#2a372e','#36463a','#e7eee5','#b2c2b0','#9faf9b','#435648','#b4d0a7','#cde2c4','#1c2b1d','#b4d0a7'],
  },
  teal: {
    light: ['#eff6f5','#fbfdfd','#e5f1ef','#d5e7e4','#203634','#506965','#5e7571','#c7dcd8','#216c67','#195852','#ffffff','#216c67'],
    dark: ['#141f20','#1c2b2c','#253a3b','#304b4c','#e5f1ee','#adc8c2','#96b5ae','#3b5b58','#9dd7cc','#bce8df','#142d2a','#9dd7cc'],
  },
  violet: {
    light: ['#f5f2f8','#fdfcfe','#eee8f4','#e3d9ed','#342c40','#685d77','#746980','#d9cfe4','#70528e','#5b4075','#ffffff','#70528e'],
    dark: ['#1d1923','#282230','#342c3e','#43394f','#eee8f5','#c4b6d4','#ad9cc0','#554660','#d0b8ed','#e2cff7','#2c1e3b','#d0b8ed'],
  },
  rose: {
    light: ['#f8f2f2','#fffcfb','#f5e9e8','#ecdada','#402d32','#735960','#856e74','#e5d0d2','#945965','#7c4652','#ffffff','#945965'],
    dark: ['#241a1d','#302428','#3e2e34','#503b42','#f5e8e9','#d3b7bf','#be9da6','#624951','#e6b4c0','#f2ced6','#3a202a','#e6b4c0'],
  },
} satisfies Record<string, Record<PageTheme, string[]>>;

const shadows = {
  blue: {light:'0 12px 32px #203e6610, 0 2px 5px #203e6608',dark:'0 14px 36px #080f1b40, 0 2px 6px #080f1b20'},
  graphite: {light:'0 12px 32px #252d3810, 0 2px 5px #252d3808',dark:'0 14px 36px #080a0e40, 0 2px 6px #080a0e20'},
  paper: {light:'0 12px 32px #634c2c12, 0 2px 5px #634c2c08',dark:'0 14px 36px #110d0940, 0 2px 6px #110d0920'},
  sage: {light:'0 12px 32px #29452c10, 0 2px 5px #29452c08',dark:'0 14px 36px #0a110b40, 0 2px 6px #0a110b20'},
  teal: {light:'0 12px 32px #204b4610, 0 2px 5px #204b4608',dark:'0 14px 36px #07121240, 0 2px 6px #07121220'},
  violet: {light:'0 12px 32px #49325e10, 0 2px 5px #49325e08',dark:'0 14px 36px #110b1840, 0 2px 6px #110b1820'},
  rose: {light:'0 12px 32px #683c4710, 0 2px 5px #683c4708',dark:'0 14px 36px #180b1040, 0 2px 6px #180b1020'},
};

export function normalizePalette(value: unknown): PalettePreference {
  return typeof value === 'string' && Object.hasOwn(colors,value) ? value as PalettePreference : 'neutral';
}

export function applyPalettePreview(button: HTMLElement, palette: PalettePreference, scheme: PageTheme): void {
  for (const [index,key] of keys.entries()) button.style.setProperty('--sample-'+key,colors[palette][scheme][index]!);
}

export function applyPalette(host: HTMLElement, palette: PalettePreference, scheme: PageTheme): void {
  host.dataset.piPalette = palette;
  if (palette === 'neutral') {
    host.style.removeProperty('--pi-shadow');
    host.style.removeProperty('--control-border-hover');
    host.style.removeProperty('--focus-ring');
  } else {
    host.style.setProperty('--pi-shadow',shadows[palette][scheme]);
    host.style.setProperty('--control-border-hover','var(--pi-muted)');
    host.style.setProperty('--focus-ring','color-mix(in srgb,var(--pi-focus) 16%,transparent)');
  }
  for (const [index, key] of keys.entries()) {
    const name = '--pi-' + key;
    if (palette === 'neutral') host.style.removeProperty(name);
    else host.style.setProperty(name, colors[palette][scheme][index]!);
  }
}
