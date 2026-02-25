import type { SimpleIcon } from 'simple-icons';
import {
  siBehance,
  siBluesky,
  siDiscord,
  siDribbble,
  siFacebook,
  siFlickr,
  siInstagram,
  siKakaotalk,
  siLine,
  siMastodon,
  siMedium,
  siOdnoklassniki,
  siPinterest,
  siReddit,
  siSignal,
  siSinaweibo,
  siSnapchat,
  siTelegram,
  siThreads,
  siTiktok,
  siTumblr,
  siViber,
  siVk,
  siWechat,
  siWhatsapp,
  siX,
  siXing,
  siYoutube,
} from 'simple-icons';

export type LogoSource = 'system' | 'custom';

export interface LogoLibraryItem {
  id: string;
  name: string;
  image: string;
  background: string;
  source: LogoSource;
  keywords: string[];
}

interface SystemLogoConfig {
  icon: SimpleIcon;
  name: string;
  aliases: string[];
}

const CUSTOM_LOGOS_STORAGE_KEY = 'synapse12.logoLibrary.custom.v1';

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function uniqueTokens(tokens: string[]) {
  return Array.from(new Set(tokens.map(normalizeToken).filter(Boolean)));
}

function toSearchTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[\s,.;:!?/\\|()[\]{}"'`<>+=_-]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function encodeSvgDataUri(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function isLightHexColor(hex: string) {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return false;

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.64;
}

function toSimpleIconDataUri(icon: SimpleIcon, fillColor: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="${icon.title}"><path fill="${fillColor}" d="${icon.path}"/></svg>`;
  return encodeSvgDataUri(svg);
}

function createSystemLogo(config: SystemLogoConfig): LogoLibraryItem {
  const baseKeywords = [
    config.name,
    config.icon.title,
    config.icon.slug,
    ...config.aliases,
    ...toSearchTokens(config.name),
    ...toSearchTokens(config.icon.title),
  ];

  return {
    id: `system:${config.icon.slug}`,
    name: config.name,
    image: toSimpleIconDataUri(config.icon, isLightHexColor(config.icon.hex) ? '#0f172a' : '#ffffff'),
    background: `#${config.icon.hex}`,
    source: 'system',
    keywords: uniqueTokens(baseKeywords),
  };
}

const SYSTEM_SOCIAL_LOGO_CONFIG: SystemLogoConfig[] = [
  { icon: siFacebook, name: 'Facebook', aliases: ['фейсбук', 'fb'] },
  { icon: siInstagram, name: 'Instagram', aliases: ['инстаграм', 'insta'] },
  { icon: siX, name: 'X (Twitter)', aliases: ['x', 'twitter', 'твиттер'] },
  { icon: siTelegram, name: 'Telegram', aliases: ['телеграм', 'тг'] },
  { icon: siWhatsapp, name: 'WhatsApp', aliases: ['ватсап', 'вотсап'] },
  { icon: siYoutube, name: 'YouTube', aliases: ['ютуб', 'youtube'] },
  { icon: siTiktok, name: 'TikTok', aliases: ['тикток', 'тикток'] },
  { icon: siSnapchat, name: 'Snapchat', aliases: ['снапчат'] },
  { icon: siPinterest, name: 'Pinterest', aliases: ['пинтерест'] },
  { icon: siReddit, name: 'Reddit', aliases: ['реддит'] },
  { icon: siDiscord, name: 'Discord', aliases: ['дискорд'] },
  { icon: siThreads, name: 'Threads', aliases: ['тредс', 'threads'] },
  { icon: siMastodon, name: 'Mastodon', aliases: ['мастодон'] },
  { icon: siBluesky, name: 'Bluesky', aliases: ['блюскай', 'blue sky'] },
  { icon: siVk, name: 'VK', aliases: ['вк', 'вконтакте', 'vk'] },
  { icon: siOdnoklassniki, name: 'Odnoklassniki', aliases: ['одноклассники', 'ок'] },
  { icon: siSinaweibo, name: 'Sina Weibo', aliases: ['вейбо', 'weibo'] },
  { icon: siWechat, name: 'WeChat', aliases: ['вичат', 'wechat'] },
  { icon: siLine, name: 'LINE', aliases: ['лайн', 'line'] },
  { icon: siKakaotalk, name: 'KakaoTalk', aliases: ['какао', 'какаоток'] },
  { icon: siViber, name: 'Viber', aliases: ['вайбер'] },
  { icon: siSignal, name: 'Signal', aliases: ['сигнал'] },
  { icon: siTumblr, name: 'Tumblr', aliases: ['тамблер'] },
  { icon: siFlickr, name: 'Flickr', aliases: ['фликр'] },
  { icon: siMedium, name: 'Medium', aliases: ['медиум'] },
  { icon: siBehance, name: 'Behance', aliases: ['беханс'] },
  { icon: siDribbble, name: 'Dribbble', aliases: ['дрибббл'] },
  { icon: siXing, name: 'Xing', aliases: ['ксинг'] },
];

export const SYSTEM_SOCIAL_LOGOS: LogoLibraryItem[] = SYSTEM_SOCIAL_LOGO_CONFIG.map(createSystemLogo);

function isLogoLibraryItem(value: unknown): value is LogoLibraryItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const record = value as Partial<LogoLibraryItem>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.image === 'string' &&
    typeof record.background === 'string' &&
    (record.source === 'system' || record.source === 'custom') &&
    Array.isArray(record.keywords)
  );
}

function normalizeCustomLogo(item: LogoLibraryItem) {
  return {
    ...item,
    source: 'custom' as const,
    background:
      typeof item.background === 'string' && item.background.trim()
        ? item.background
        : '#ffffff',
    keywords: uniqueTokens([...item.keywords, ...toSearchTokens(item.name)]),
  };
}

export function createLogoKeywords(name: string, extra: string[] = []) {
  return uniqueTokens([name, ...extra, ...toSearchTokens(name)]);
}

export function readCustomLogos() {
  if (typeof window === 'undefined') return [] as LogoLibraryItem[];

  try {
    const raw = window.localStorage.getItem(CUSTOM_LOGOS_STORAGE_KEY);
    if (!raw) return [] as LogoLibraryItem[];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as LogoLibraryItem[];

    return parsed
      .filter(isLogoLibraryItem)
      .map((item) => normalizeCustomLogo(item))
      .filter((item) => item.image.trim().length > 0 && item.name.trim().length > 0);
  } catch {
    return [] as LogoLibraryItem[];
  }
}

export function writeCustomLogos(items: LogoLibraryItem[]) {
  if (typeof window === 'undefined') return;

  const payload = items
    .filter((item) => item.source === 'custom')
    .map((item) => ({
      id: item.id,
      name: item.name,
      image: item.image,
      background: item.background,
      source: 'custom' as const,
      keywords: createLogoKeywords(item.name, item.keywords),
    }));

  window.localStorage.setItem(CUSTOM_LOGOS_STORAGE_KEY, JSON.stringify(payload));
}

export function addCustomLogo(payload: {
  name: string;
  image: string;
  background?: string;
  keywords?: string[];
}) {
  const name = payload.name.trim();
  const image = payload.image.trim();
  if (!name || !image) return readCustomLogos();

  const current = readCustomLogos();
  const createdAt = Date.now();
  const id = `custom:${createdAt}:${Math.random().toString(36).slice(2, 8)}`;
  const item: LogoLibraryItem = {
    id,
    name,
    image,
    background:
      typeof payload.background === 'string' && payload.background.trim()
        ? payload.background.trim()
        : '#ffffff',
    source: 'custom',
    keywords: createLogoKeywords(name, payload.keywords || []),
  };

  const next = [item, ...current];
  writeCustomLogos(next);
  return next;
}
