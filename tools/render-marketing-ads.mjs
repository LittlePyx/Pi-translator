import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.');
const adsDirectory = path.join(root, 'store-assets', 'ads');
const screenshotPath = path.join(
  root,
  'store-assets',
  'ads',
  'pi-translator-real-use-redacted.png',
);
const backgroundPath = path.join(adsDirectory, 'pi-academic-background.png');
const piLogoPath = path.join(root, 'public', 'brand', 'pi_logo.png');
const teamLogoPath = path.join(root, 'public', 'brand', 'team_logo.png');

async function dataUri(filePath) {
  const extension = path.extname(filePath).slice(1);
  const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/png';
  const contents = await readFile(filePath);
  return `data:${mime};base64,${contents.toString('base64')}`;
}

const [background, screenshot, piLogo, teamLogo] = await Promise.all([
  dataUri(backgroundPath),
  dataUri(screenshotPath),
  dataUri(piLogoPath),
  dataUri(teamLogoPath),
]);

const sharedStyle = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body {
    font-family: "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif;
    color: white;
    background: #15113c;
  }
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-image:
      linear-gradient(90deg, rgba(8,10,38,.18), rgba(21,15,72,.04)),
      url("${background}");
    background-size: cover;
    background-position: center;
  }
  .canvas::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(circle at 73% 44%, rgba(118, 216, 255, .12), transparent 28%),
      linear-gradient(180deg, rgba(3,6,25,.04), rgba(3,6,25,.28));
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .pi-mark {
    display: grid;
    place-items: center;
    background: rgba(255,255,255,.96);
    border: 1px solid rgba(255,255,255,.78);
    box-shadow: 0 14px 34px rgba(8,10,41,.28);
  }
  .pi-mark img { width: 66%; height: 66%; object-fit: contain; }
  .brand-name { font-weight: 800; letter-spacing: -.03em; }
  .eyebrow {
    color: #a9caff;
    font-weight: 700;
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  h1 { margin: 0; letter-spacing: -.045em; line-height: 1.08; }
  .subtitle { color: #dce5ff; line-height: 1.65; }
  .chips { display: flex; flex-wrap: wrap; gap: 9px; }
  .chip {
    padding: 8px 12px;
    border: 1px solid rgba(167, 190, 255, .34);
    border-radius: 999px;
    color: #edf2ff;
    background: rgba(37, 31, 105, .5);
    backdrop-filter: blur(8px);
    font-size: 14px;
    white-space: nowrap;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    border-radius: 12px;
    background: linear-gradient(135deg, #f2f6ff, #d9e6ff);
    color: #201a62;
    font-weight: 800;
    box-shadow: 0 14px 32px rgba(0,0,0,.22);
  }
  .shot-shell {
    position: absolute;
    z-index: 2;
    overflow: hidden;
    border: 7px solid rgba(255,255,255,.96);
    background: white;
    box-shadow: 0 30px 80px rgba(2,6,34,.48), 0 3px 16px rgba(2,6,34,.2);
  }
  .shot-shell::before {
    content: "";
    position: absolute;
    z-index: 3;
    top: 0;
    left: 0;
    right: 0;
    height: 24px;
    background: linear-gradient(180deg, rgba(255,255,255,.16), transparent);
    pointer-events: none;
  }
  .shot-shell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .team { object-fit: contain; filter: drop-shadow(0 5px 12px rgba(0,0,0,.2)); }
  .micro { color: #b8c4e9; }
`;

const landscape = `
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${sharedStyle}</style></head>
<body>
  <main class="canvas">
    <section style="position:absolute;z-index:3;left:52px;top:45px;width:455px;">
      <div class="brand">
        <span class="pi-mark" style="width:58px;height:58px;border-radius:17px;"><img src="${piLogo}"></span>
        <div>
          <div class="brand-name" style="font-size:27px;">Pi Translator</div>
          <div class="eyebrow" style="font-size:11px;margin-top:4px;">Microsoft Edge 扩展</div>
        </div>
      </div>
      <h1 style="font-size:52px;margin-top:42px;">划词即译，<br>就在当前页。</h1>
      <p class="subtitle" style="font-size:19px;margin:19px 0 18px;">Overleaf 与普通网站都能使用的<br>轻量网页翻译工具。</p>
      <div class="chips">
        <span class="chip">Overleaf</span>
        <span class="chip">普通网站</span>
        <span class="chip">自备 API Key</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:33px;">
        <span class="micro" style="font-size:12px;">Developed by</span>
        <img class="team" src="${teamLogo}" style="width:116px;height:31px;">
      </div>
    </section>
    <div class="shot-shell" style="right:8px;top:82px;width:662px;height:434px;border-radius:20px;transform:rotate(-1deg);">
      <img src="${screenshot}" style="object-fit:contain;object-position:center;">
    </div>
    <div style="position:absolute;z-index:4;right:45px;bottom:39px;padding:9px 13px;border-radius:10px;background:rgba(13,13,54,.72);border:1px solid rgba(255,255,255,.16);font-size:12px;color:#dce5ff;">
      选中原文 · 一键翻译 · 结果卡片可拖动
    </div>
  </main>
</body>
</html>`;

const square = `
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><style>${sharedStyle}</style></head>
<body>
  <main class="canvas">
    <section style="position:absolute;z-index:3;left:68px;right:68px;top:58px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div class="brand">
          <span class="pi-mark" style="width:64px;height:64px;border-radius:18px;"><img src="${piLogo}"></span>
          <div>
            <div class="brand-name" style="font-size:29px;">Pi Translator</div>
            <div class="eyebrow" style="font-size:11px;margin-top:4px;">Microsoft Edge 扩展</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:11px;">
          <span class="micro" style="font-size:12px;">Developed by</span>
          <img class="team" src="${teamLogo}" style="width:126px;height:34px;">
        </div>
      </div>
      <h1 style="font-size:66px;margin-top:48px;">网页划词，<br>一下就翻译。</h1>
      <p class="subtitle" style="font-size:21px;margin:22px 0 20px;">Overleaf 和普通网站都能使用。</p>
      <div class="chips">
        <span class="chip">选中即翻译</span>
        <span class="chip">目标语言快速切换</span>
        <span class="chip">自备 API Key</span>
      </div>
    </section>
    <div class="shot-shell" style="left:130px;right:130px;top:445px;height:538px;border-radius:22px;">
      <img src="${screenshot}" style="object-fit:contain;object-position:center;">
    </div>
  </main>
</body>
</html>`;

await mkdir(adsDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function render(html, width, height, filename) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map(
        (image) =>
          image.complete
            ? Promise.resolve()
            : new Promise((resolve, reject) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', reject, { once: true });
              }),
      ),
    );
  });
  await page.screenshot({
    path: path.join(adsDirectory, filename),
    type: 'png',
  });
  await page.close();
}

await render(landscape, 1200, 628, 'pi-translator-ad-landscape-1200x628.png');
await render(square, 1080, 1080, 'pi-translator-ad-square-1080x1080.png');
await browser.close();
