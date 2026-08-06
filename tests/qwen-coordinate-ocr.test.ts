import { describe, expect, it } from 'vitest';
import { TranslationError } from '../core/messaging/errors';
import {
  parseQwenCoordinateOcr,
  qwenCoordinateOcrEndpoint,
  qwenCoordinateOcrModel,
} from '../core/pdf/qwen-coordinate-ocr';

function nativeResponse(location: number[] = [100, 200, 500, 200, 500, 260, 100, 260]) {
  return {
    output: {
      choices: [{
        message: {
          content: [{
            ocr_result: {
              words_info: [{ text: 'Single-pixel imaging.', location }],
            },
          }],
        },
      }],
    },
  };
}

describe('Qwen native coordinate OCR adapter', () => {
  it('derives the native OCR endpoint only from official compatible Qwen origins', () => {
    expect(qwenCoordinateOcrEndpoint(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    )).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect(qwenCoordinateOcrEndpoint(
      'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    )).toBe(
      'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect(qwenCoordinateOcrEndpoint(
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    )).toBe(
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect(qwenCoordinateOcrEndpoint('https://api.example.com/v1')).toBeUndefined();
  });

  it('uses a configured OCR model or the current recommended dedicated model', () => {
    expect(qwenCoordinateOcrModel('qwen3.7-plus')).toBe('qwen3.5-ocr');
    expect(qwenCoordinateOcrModel('qwen-vl-ocr-latest')).toBe('qwen-vl-ocr-latest');
  });

  it('normalizes official absolute line coordinates and marks their trust source', () => {
    const page = parseQwenCoordinateOcr(nativeResponse(), 3, 1000, 1000);
    expect(page).toMatchObject({
      pageNumber: 3,
      coordinateSystem: 'normalized-page',
      source: 'qwen-advanced-recognition',
    });
    expect(page.blocks[0]).toMatchObject({
      text: 'Single-pixel imaging.',
      confidence: 0.9,
      confidenceSource: 'trusted-adapter',
      kind: 'text',
      rotationDegrees: 0,
      box: { left: 0.1, top: 0.2, width: 0.4, height: 0.06 },
    });
  });

  it('classifies formula lines and records visible line rotation', () => {
    const response = nativeResponse([100, 100, 100, 500, 140, 500, 140, 100]);
    const content = response.output.choices[0]!.message.content[0]!.ocr_result.words_info[0]!;
    content.text = 'x = A y + \\lambda R(x)';
    const page = parseQwenCoordinateOcr(response, 1, 1000, 1000);
    expect(page.blocks[0]).toMatchObject({ kind: 'formula', rotationDegrees: 90 });
  });

  it('rejects missing native layout data and out-of-image coordinates', () => {
    expect(() => parseQwenCoordinateOcr({}, 1, 1000, 1000)).toThrow(TranslationError);
    expect(() => parseQwenCoordinateOcr(
      nativeResponse([900, 200, 1100, 200, 1100, 260, 900, 260]),
      1,
      1000,
      1000,
    )).toThrow('OCR 坐标越界');
  });
});
