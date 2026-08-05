export type OcrBlockKind = 'text' | 'formula' | 'table';

export interface NormalizedOcrBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CoordinateOcrBlock {
  id: string;
  order: number;
  text: string;
  confidence: number;
  confidenceSource?: 'provider' | 'trusted-adapter';
  kind: OcrBlockKind;
  box: NormalizedOcrBox;
}

export interface CoordinateOcrPage {
  pageNumber: number;
  coordinateSystem: 'normalized-page';
  source?: 'qwen-advanced-recognition';
  blocks: CoordinateOcrBlock[];
}

export interface RecognizePdfPageRequest {
  requestId: string;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  pageNumber: number;
}

export type CoordinateOcrValidation =
  | { ok: true; page: CoordinateOcrPage }
  | { ok: false; reason: string };

const MAX_OCR_BLOCKS = 600;
const MAX_OCR_BLOCK_TEXT = 4_000;
const MAX_OCR_PAGE_TEXT = 120_000;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizedBox(value: unknown): NormalizedOcrBox | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const box = value as Record<string, unknown>;
  if (![box.left, box.top, box.width, box.height].every(finiteNumber)) return undefined;
  const left = box.left as number;
  const top = box.top as number;
  const width = box.width as number;
  const height = box.height as number;
  if (
    left < 0 || top < 0 || width <= 0 || height <= 0 ||
    left + width > 1.000_001 || top + height > 1.000_001
  ) return undefined;
  return { left, top, width, height };
}

export function validateCoordinateOcrPage(value: unknown): CoordinateOcrValidation {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'OCR 结果不是对象。' };
  const page = value as Record<string, unknown>;
  if (!Number.isInteger(page.pageNumber) || (page.pageNumber as number) < 1) {
    return { ok: false, reason: 'OCR 页码无效。' };
  }
  if (page.coordinateSystem !== 'normalized-page') {
    return { ok: false, reason: 'OCR 坐标系必须是 normalized-page。' };
  }
  if (!Array.isArray(page.blocks) || page.blocks.length === 0) {
    return { ok: false, reason: 'OCR 结果没有文字块。' };
  }
  if (page.blocks.length > MAX_OCR_BLOCKS) {
    return { ok: false, reason: `OCR 文字块超过 ${MAX_OCR_BLOCKS} 个。` };
  }

  const blocks:CoordinateOcrBlock[]=[];
  const ids=new Set<string>();
  const orders=new Set<number>();
  let totalText=0;
  for(const [index,item] of page.blocks.entries()){
    if(!item||typeof item!=='object')return {ok:false,reason:`第 ${index+1} 个 OCR 文字块无效。`};
    const block=item as Record<string,unknown>;
    const id=typeof block.id==='string'?block.id.trim():'';
    const text=typeof block.text==='string'?block.text.trim():'';
    const order=block.order;
    const confidence=block.confidence;
    const confidenceSource=block.confidenceSource;
    const kind=block.kind;
    const box=normalizedBox(block.box);
    if(!id||id.length>80||ids.has(id))return {ok:false,reason:`第 ${index+1} 个 OCR 文字块 ID 无效或重复。`};
    if(!Number.isInteger(order)||(order as number)<0||orders.has(order as number))return {ok:false,reason:`第 ${index+1} 个 OCR 阅读顺序无效或重复。`};
    if(!text||text.length>MAX_OCR_BLOCK_TEXT)return {ok:false,reason:`第 ${index+1} 个 OCR 文字块为空或过长。`};
    if(!finiteNumber(confidence)||confidence<0||confidence>1)return {ok:false,reason:`第 ${index+1} 个 OCR 置信度无效。`};
    if(confidenceSource!==undefined&&!['provider','trusted-adapter'].includes(String(confidenceSource)))return {ok:false,reason:`第 ${index+1} 个 OCR 置信度来源无效。`};
    const normalizedConfidenceSource = confidenceSource === 'provider' ||
      confidenceSource === 'trusted-adapter'
      ? confidenceSource
      : undefined;
    if(!['text','formula','table'].includes(String(kind)))return {ok:false,reason:`第 ${index+1} 个 OCR 类型无效。`};
    if(!box)return {ok:false,reason:`第 ${index+1} 个 OCR 坐标越界。`};
    totalText+=text.length;
    if(totalText>MAX_OCR_PAGE_TEXT)return {ok:false,reason:'OCR 单页文字总量过大。'};
    ids.add(id);orders.add(order as number);
    blocks.push({
      id,
      order:order as number,
      text,
      confidence,
      ...(normalizedConfidenceSource?{confidenceSource:normalizedConfidenceSource}:{}),
      kind:kind as OcrBlockKind,
      box,
    });
  }

  blocks.sort((left,right)=>left.order-right.order);
  return {
    ok:true,
    page:{
      pageNumber:page.pageNumber as number,
      coordinateSystem:'normalized-page',
      ...(page.source==='qwen-advanced-recognition'?{source:page.source}:{}),
      blocks,
    },
  };
}

export function selectableOcrBlocks(
  page: CoordinateOcrPage,
  minimumConfidence = 0.82,
): CoordinateOcrBlock[] {
  return page.blocks.filter((block) => block.kind !== 'table' && block.confidence >= minimumConfidence);
}

export function mapCoordinateOcrPageToRegion(
  page: CoordinateOcrPage,
  region: NormalizedOcrBox,
): CoordinateOcrValidation {
  const normalizedRegion = normalizedBox(region);
  if (!normalizedRegion) return { ok: false, reason: 'OCR 识别区域坐标无效。' };
  return validateCoordinateOcrPage({
    ...page,
    blocks: page.blocks.map((block) => ({
      ...block,
      box: {
        left: normalizedRegion.left + block.box.left * normalizedRegion.width,
        top: normalizedRegion.top + block.box.top * normalizedRegion.height,
        width: block.box.width * normalizedRegion.width,
        height: block.box.height * normalizedRegion.height,
      },
    })),
  });
}
