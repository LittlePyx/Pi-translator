import {
  isEdgeNativePdfContext,
  isExtensionPdfReaderUrl,
} from '../pdf/source';
import { isInjectableWebUrl, isOverleafProjectUrl } from './site-access';

export const FEATURE_DISCOVERY_STORAGE_PREFIX = 'featureDiscoveryV1';

export type FeatureDiscoveryScene = 'web' | 'overleaf' | 'pdf';

export type FeatureDiscoveryFeature =
  | 'web-selection'
  | 'web-sidebar'
  | 'web-region'
  | 'overleaf-selection'
  | 'overleaf-region'
  | 'overleaf-pdf'
  | 'pdf-reader'
  | 'pdf-selection'
  | 'pdf-region';

export interface FeatureDiscoveryProgress {
  completed: Partial<Record<FeatureDiscoveryFeature, true>>;
  dismissed: Partial<Record<FeatureDiscoveryScene, true>>;
}

export interface FeatureDiscoveryStep {
  id: FeatureDiscoveryFeature;
  label: string;
  detail: string;
  completed: boolean;
}

export interface FeatureDiscoveryModel {
  scene: FeatureDiscoveryScene;
  eyebrow: string;
  title: string;
  description: string;
  steps: FeatureDiscoveryStep[];
  completedCount: number;
  shouldShow: boolean;
}

const FEATURES: readonly FeatureDiscoveryFeature[] = [
  'web-selection',
  'web-sidebar',
  'web-region',
  'overleaf-selection',
  'overleaf-region',
  'overleaf-pdf',
  'pdf-reader',
  'pdf-selection',
  'pdf-region',
];

const SCENES: readonly FeatureDiscoveryScene[] = ['web', 'overleaf', 'pdf'];
const completedFeatureCache = new Set<FeatureDiscoveryFeature>();
const completionTasks = new Map<FeatureDiscoveryFeature, Promise<void>>();

const EMPTY_PROGRESS: FeatureDiscoveryProgress = {
  completed: {},
  dismissed: {},
};

const SCENE_COPY: Record<FeatureDiscoveryScene, Omit<FeatureDiscoveryModel,
  'scene' | 'steps' | 'completedCount' | 'shouldShow'>> = {
  web: {
    eyebrow: '当前页面 · 普通网页',
    title: '从一次划词开始',
    description: '按自己的阅读方式选一种；用过后，这里会自动收起。',
  },
  overleaf: {
    eyebrow: '当前页面 · Overleaf',
    title: '编辑区和预览区，分别这样用',
    description: '文字直接划选，公式、图表和编译稿使用对应入口。',
  },
  pdf: {
    eyebrow: '当前页面 · PDF',
    title: '按文档内容选择方式',
    description: '可选正文直接划选，扫描页和复杂内容使用框选。',
  },
};

const SCENE_STEPS: Record<FeatureDiscoveryScene, readonly Omit<FeatureDiscoveryStep,
  'completed'>[]> = {
  web: [
    {
      id: 'web-selection',
      label: '划选一段正文',
      detail: '松开鼠标后点一下 π，即可翻译。',
    },
    {
      id: 'web-sidebar',
      label: '需要连续查阅时打开侧栏',
      detail: '后续选区的译文会集中显示在侧栏中。',
    },
    {
      id: 'web-region',
      label: '图片或不可选内容用框选',
      detail: '适合图表、网页图片和复杂排版。',
    },
  ],
  overleaf: [
    {
      id: 'overleaf-selection',
      label: '编辑区文字直接划选',
      detail: '保留 LaTeX 结构后再显示译文。',
    },
    {
      id: 'overleaf-region',
      label: '预览中的复杂内容用框选',
      detail: '适合公式、图表和不可选的 PDF 内容。',
    },
    {
      id: 'overleaf-pdf',
      label: '通读编译稿时使用 Pi PDF',
      detail: '从当前项目的 PDF 继续阅读和翻译。',
    },
  ],
  pdf: [
    {
      id: 'pdf-reader',
      label: '用 Pi PDF 打开文档',
      detail: '获得更完整的划词、框选和阅读体验。',
    },
    {
      id: 'pdf-selection',
      label: '可选正文直接划选',
      detail: '适合论文正文和跨行段落。',
    },
    {
      id: 'pdf-region',
      label: '扫描页、公式或图表用框选',
      detail: '拖动选区后识别并翻译其中内容。',
    },
  ],
};

function completedStorageKey(feature: FeatureDiscoveryFeature): string {
  return `${FEATURE_DISCOVERY_STORAGE_PREFIX}:completed:${feature}`;
}

function dismissedStorageKey(scene: FeatureDiscoveryScene): string {
  return `${FEATURE_DISCOVERY_STORAGE_PREFIX}:dismissed:${scene}`;
}

export function featureDiscoverySceneForPage(input: {
  url?: string;
  pdfContext?: 'native' | 'overleaf';
  pdfReaderUrl: string;
}): FeatureDiscoveryScene | undefined {
  if (input.pdfContext === 'native') return 'pdf';
  if (input.pdfContext === 'overleaf') return 'overleaf';
  if (isExtensionPdfReaderUrl(input.url, input.pdfReaderUrl)) return 'pdf';
  if (input.url && isOverleafProjectUrl(input.url)) return 'overleaf';
  if (input.url && isInjectableWebUrl(input.url)) return 'web';
  return undefined;
}

export function featureDiscoveryModel(
  scene: FeatureDiscoveryScene,
  progress: FeatureDiscoveryProgress = EMPTY_PROGRESS,
  reveal = false,
): FeatureDiscoveryModel {
  const steps = SCENE_STEPS[scene].map((step) => ({
    ...step,
    completed: progress.completed[step.id] === true,
  }));
  const completedCount = steps.filter((step) => step.completed).length;
  return {
    scene,
    ...SCENE_COPY[scene],
    steps,
    completedCount,
    shouldShow: reveal || (
      progress.dismissed[scene] !== true && completedCount < steps.length
    ),
  };
}

export function featureDiscoveryFeatureForTranslation(input: {
  pageUrl: string;
  kind: 'text' | 'image';
  sourceLocation?: unknown;
  pdfReaderUrl: string;
}): FeatureDiscoveryFeature {
  if (isOverleafProjectUrl(input.pageUrl)) {
    return input.kind === 'image' ? 'overleaf-region' : 'overleaf-selection';
  }
  if (
    input.sourceLocation !== undefined ||
    isExtensionPdfReaderUrl(input.pageUrl, input.pdfReaderUrl) ||
    isEdgeNativePdfContext({ tabUrl: input.pageUrl })
  ) {
    return input.kind === 'image' ? 'pdf-region' : 'pdf-selection';
  }
  return input.kind === 'image' ? 'web-region' : 'web-selection';
}

export async function getFeatureDiscoveryProgress(): Promise<FeatureDiscoveryProgress> {
  const featureEntries = FEATURES.map((feature) => [feature, completedStorageKey(feature)] as const);
  const sceneEntries = SCENES.map((scene) => [scene, dismissedStorageKey(scene)] as const);
  const stored = await browser.storage.local.get([
    ...featureEntries.map(([, key]) => key),
    ...sceneEntries.map(([, key]) => key),
  ]);
  const completed = Object.fromEntries(
    featureEntries
      .filter(([, key]) => stored[key] === true)
      .map(([feature]) => [feature, true]),
  ) as FeatureDiscoveryProgress['completed'];
  for (const feature of FEATURES) {
    if (completed[feature]) completedFeatureCache.add(feature);
  }
  return {
    completed,
    dismissed: Object.fromEntries(
      sceneEntries
        .filter(([, key]) => stored[key] === true)
        .map(([scene]) => [scene, true]),
    ),
  };
}

export async function completeFeatureDiscovery(
  feature: FeatureDiscoveryFeature,
): Promise<void> {
  if (completedFeatureCache.has(feature)) return;
  const pending = completionTasks.get(feature);
  if (pending) return pending;
  const task = (async () => {
    const key = completedStorageKey(feature);
    const stored = await browser.storage.local.get(key);
    if (stored[key] !== true) {
      await browser.storage.local.set({ [key]: true });
    }
    completedFeatureCache.add(feature);
  })().finally(() => completionTasks.delete(feature));
  completionTasks.set(feature, task);
  return task;
}

export async function dismissFeatureDiscovery(
  scene: FeatureDiscoveryScene,
): Promise<void> {
  await browser.storage.local.set({ [dismissedStorageKey(scene)]: true });
}
