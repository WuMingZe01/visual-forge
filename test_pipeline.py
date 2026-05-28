"""
Visual Forge 完整跑图测试
- 单图测试：BM26A050CM 白底 + 模特参考 → 4K 3:4
- 批量测试：2款白底 + 模特参考 → 4K 3:4
- Yunwu (gpt-image-2) + Grsai (gpt-image-2-vip) 双引擎
- 测试完成后用 Kimi 多模态分析结果
"""
import base64, json, time, os, sys
import urllib.request, urllib.error
from pathlib import Path

# ===== Config =====
YUNWU_KEYS = ['sk-nK9OjOknKFbD9DloL', 'sk-pYZtWx4v6qxCvsC8y', 'sk-c8fivuNCM1y98HAOJ']
GRSAI_KEYS = ['sk-c5e5113d4cf54de09', 'sk-d6925f10df0445d1b', 'sk-126a55e539f04b05a']
YUNWU_URL = 'https://yunwu.ai/v1/images/generations'
GRSAI_URL = 'https://grsai.dakka.com.cn/v1/api/generate'
KIMI_KEY = 'sk-xndF1xoeppH5tPert2EHypy5pbo2Gzpmd5i3gV3tMFv9A64T'
KIMI_URL = 'https://api.moonshot.cn/v1/chat/completions'

OUTPUT_DIR = Path('D:/Trae/项目/visual-forge-main/test-output')
SINGLE_DIR = Path('D:/Trae/项目/visual-forge-main/测试图片/1')
BATCH_WHITE_DIR = Path('D:/桌面/AI-平铺整理/白底图')
BATCH_MODEL_DIR = Path('D:/桌面/AI-平铺整理/参考图')

RESOLUTION_W, RESOLUTION_H = 2448, 3264  # 3:4 4K

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def image_to_base64(path, max_size=2048):
    """Load image, resize to max_size, return base64 data URL"""
    from PIL import Image
    import io
    img = Image.open(path).convert('RGB')
    w, h = img.size
    scale = min(max_size / w, max_size / h, 1.0)
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=90)
    return base64.b64encode(buf.getvalue()).decode()

def call_yunwu(api_key, prompt, ref_b64, w, h):
    """Call Yunwu gpt-image-2 API"""
    body = {
        'model': 'gpt-image-2',
        'prompt': prompt,
        'size': f'{w}x{h}',
        'quality': 'hd',
        'n': 1,
        'image': ref_b64,
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(YUNWU_URL, data=data, headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {api_key}',
    })
    try:
        resp = urllib.request.urlopen(req, timeout=180)
        result = json.loads(resp.read())
        arr = result.get('data', [])
        if arr and isinstance(arr[0], dict):
            url = arr[0].get('url') or arr[0].get('b64_json')
            if url and not url.startswith('http') and not url.startswith('data:'):
                url = f'data:image/png;base64,{url}'
            return url
        return None
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        return f'ERROR: HTTP {e.code} - {body}'
    except Exception as e:
        return f'ERROR: {str(e)[:200]}'

def call_grsai(api_key, prompt, model_b64, product_b64, w, h):
    """Call Grsai gpt-image-2-vip API"""
    images = []
    if model_b64:
        images.append(model_b64)
    if product_b64:
        images.append(product_b64)
    body = {
        'model': 'gpt-image-2-vip',
        'prompt': prompt,
        'aspectRatio': f'{w}x{h}',
        'replyType': 'json',
        'images': images,
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(GRSAI_URL, data=data, headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {api_key}',
    })
    try:
        resp = urllib.request.urlopen(req, timeout=180)
        result = json.loads(resp.read())
        if result.get('status') == 'violation':
            return 'ERROR: policy violation'
        if result.get('status') == 'failed':
            return f"ERROR: {json.dumps(result.get('error', ''))[:200]}"
        results = result.get('results', [])
        if results and results[0].get('url'):
            return results[0]['url']
        # Deep search
        def dig(obj, depth=0):
            if depth > 5: return None
            if isinstance(obj, dict):
                for k in ['url', 'image_url', 'imageUrl']:
                    v = obj.get(k)
                    if isinstance(v, str) and v.startswith('http'):
                        return v
                for v in obj.values():
                    r = dig(v, depth+1)
                    if r: return r
            elif isinstance(obj, list):
                for item in obj:
                    r = dig(item, depth+1)
                    if r: return r
            return None
        found = dig(result)
        return found or f'ERROR: no URL in {json.dumps(result)[:300]}'
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        return f'ERROR: HTTP {e.code} - {body}'
    except Exception as e:
        return f'ERROR: {str(e)[:200]}'

def download_image(url, path):
    """Download image from URL to file"""
    if not url or url.startswith('ERROR'):
        return False
    try:
        if url.startswith('data:'):
            header, b64data = url.split(',', 1)
            with open(path, 'wb') as f:
                f.write(base64.b64decode(b64data))
        else:
            urllib.request.urlretrieve(url, path)
        return True
    except Exception as e:
        print(f'  Download failed: {e}')
        return False

# ===== Test 1: 单图 — Yunwu =====
print('=' * 60)
print('TEST 1: Yunwu (gpt-image-2) single image')
print('=' * 60)

model_img = SINGLE_DIR / 'model.jpg'
product_img = SINGLE_DIR / 'BM26A050CM-正面.png'

model_b64 = image_to_base64(str(model_img))
product_b64 = image_to_base64(str(product_img))

# 生成英文 prompt（保持人物姿势/面部/构图+服装细节）
prompt_single = (
    'Fashion e-commerce product showcase: a model wearing the garment shown in the product reference. '
    'Maintain identical model pose, facial expression, lighting, background, and composition from the model reference. '
    'The garment should be worn naturally by the model, replacing only the clothing item. '
    'Professional e-commerce fashion photography, soft diffused studio lighting 5500K, '
    'clean seamless white background, 8K quality, sharp details. '
    'IMPORTANT: The model, pose, face, lighting, and background must match the model reference image exactly. '
    'Only the clothing changes to match the product image.'
)

r1 = call_yunwu(YUNWU_KEYS[0], prompt_single, model_b64, RESOLUTION_W, RESOLUTION_H)
print(f'Yunwu result: {str(r1)[:120]}')
if r1 and not str(r1).startswith('ERROR'):
    download_image(r1, OUTPUT_DIR / 'test1_yunwu_single.png')
    print('  -> Saved: test1_yunwu_single.png')
else:
    print(f'  -> FAILED: {r1}')

# ===== Test 2: 单图 — Grsai =====
print()
print('=' * 60)
print('TEST 2: Grsai (gpt-image-2-vip) single image')
print('=' * 60)

r2 = call_grsai(GRSAI_KEYS[0], prompt_single, model_b64, product_b64, RESOLUTION_W, RESOLUTION_H)
print(f'Grsai result: {str(r2)[:120]}')
if r2 and not str(r2).startswith('ERROR'):
    download_image(r2, OUTPUT_DIR / 'test2_grsai_single.png')
    print('  -> Saved: test2_grsai_single.png')
else:
    print(f'  -> FAILED: {r2}')

# ===== Test 3: 批量 — 选2个SKU各用Yunwu和Grsai同时跑 =====
print()
print('=' * 60)
print('TEST 3: Batch — 2 SKUs x 2 engines (4 images)')
print('=' * 60)

batch_model = BATCH_MODEL_DIR / '3.jpg'
batch_model_b64 = image_to_base64(str(batch_model))

# 选前2个白底图
batch_products = sorted(BATCH_WHITE_DIR.glob('*.png'))[:2]

for i, prod_path in enumerate(batch_products):
    sku = prod_path.stem.replace('_正面', '').replace('_反面', '')
    prod_b64 = image_to_base64(str(prod_path))

    prompt_batch = (
        f'Fashion e-commerce product showcase: a model wearing the {sku} garment. '
        'Maintain identical model pose, facial expression, lighting, background, and composition from the reference. '
        'The garment should be worn naturally by the model, replacing only the clothing item. '
        'Professional e-commerce fashion photography, soft diffused studio lighting 5500K, '
        'clean seamless white background, 8K quality, sharp details. '
        'IMPORTANT: The model, pose, face, lighting, and background must match the reference image exactly. '
        'Only the clothing changes to match the product.'
    )

    # Grsai
    r_grsai = call_grsai(GRSAI_KEYS[i % 3], prompt_batch, batch_model_b64, prod_b64, RESOLUTION_W, RESOLUTION_H)
    status_g = 'OK' if r_grsai and not str(r_grsai).startswith('ERROR') else 'FAIL'
    print(f'  [{sku}] Grsai: {status_g} {str(r_grsai)[:80]}')
    if status_g == 'OK':
        download_image(r_grsai, OUTPUT_DIR / f'test3_{sku}_grsai.png')

    # Yunwu (different key)
    r_yunwu = call_yunwu(YUNWU_KEYS[i % 3], prompt_batch, batch_model_b64, RESOLUTION_W, RESOLUTION_H)
    status_y = 'OK' if r_yunwu and not str(r_yunwu).startswith('ERROR') else 'FAIL'
    print(f'  [{sku}] Yunwu: {status_y} {str(r_yunwu)[:80]}')
    if status_y == 'OK':
        download_image(r_yunwu, OUTPUT_DIR / f'test3_{sku}_yunwu.png')

# ===== Test 4: 4路并发 —— 同一SKU跑2个Yunwu+2个Grsai =====
print()
print('=' * 60)
print('TEST 4: 4-way concurrent — same SKU, 2 Yunwu + 2 Grsai')
print('=' * 60)

import concurrent.futures

prod_path = batch_products[0]
sku = prod_path.stem.replace('_正面', '').replace('_反面', '')
prod_b64 = image_to_base64(str(prod_path))

def yw_task(key_idx):
    return ('Yunwu', key_idx, call_yunwu(YUNWU_KEYS[key_idx], prompt_batch, batch_model_b64, RESOLUTION_W, RESOLUTION_H))

def gr_task(key_idx):
    return ('Grsai', key_idx, call_grsai(GRSAI_KEYS[key_idx], prompt_batch, batch_model_b64, prod_b64, RESOLUTION_W, RESOLUTION_H))

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    futures = [
        executor.submit(yw_task, 0),
        executor.submit(yw_task, 1),
        executor.submit(gr_task, 0),
        executor.submit(gr_task, 1),
    ]
    for f in concurrent.futures.as_completed(futures):
        engine, kidx, result = f.result()
        status = 'OK' if result and not str(result).startswith('ERROR') else 'FAIL'
        print(f'  [{engine} KEY{kidx}]: {status} {str(result)[:80]}')
        if status == 'OK':
            download_image(result, OUTPUT_DIR / f'test4_{sku}_{engine}_k{kidx}.png')

print()
print('=' * 60)
print('All tests complete. Results in:', OUTPUT_DIR)
print('=' * 60)

# ===== Kimi Analysis =====
print()
print('=' * 60)
print('KIMI MULTIMODAL ANALYSIS')
print('=' * 60)

# Collect successful results for analysis
results_to_analyze = []
for f in sorted(OUTPUT_DIR.glob('test*.png')):
    if f.stat().st_size > 1000:  # not empty
        results_to_analyze.append(f)

if not results_to_analyze:
    print('No successful results to analyze!')
    sys.exit(1)

print(f'Analyzing {len(results_to_analyze)} result images...')

# Prepare multimodal message
content_parts = [
    {'type': 'text', 'text': (
        '你是一位资深的服装电商视觉质量审核专家。请逐一分析以下AI生图结果，'
        '严格对照原始参考图（模特图model.jpg + 白底产品图），评估：\n\n'
        '评分标准（每项1-5分，5=完美）：\n'
        '1. 服装还原度：生成图中的衣服是否与白底图一致？面料纹理、颜色、印花、logo、缝线、纽扣等细节是否保留？\n'
        '2. 人物一致性：模特的面部、姿势、体型、肤色是否与参考模特图一致？是否有变形？\n'
        '3. 光照/背景一致性：光线方向、色温、背景是否与参考图一致？\n'
        '4. 整体自然度：衣服是否自然"穿着"而非PS贴图？褶皱、垂坠、阴影是否合理？\n'
        '5. 电商可用性：这张图能否直接用于淘宝/拼多多商品主图？\n\n'
        '请输出格式：\n'
        '【图片X: testX_engine】\n'
        '服装还原度: X/5 — 说明\n'
        '人物一致性: X/5 — 说明\n'
        '光照/背景: X/5 — 说明\n'
        '自然度: X/5 — 说明\n'
        '电商可用性: X/5 — 说明\n'
        '总结: 一句话评价\n\n'
        '最后给出总体排名和改善建议。'
    )}
]

for rf in results_to_analyze[:4]:  # Max 4 for analysis
    b64 = base64.b64encode(rf.read_bytes()).decode()
    content_parts.append({
        'type': 'image_url',
        'image_url': {'url': f'data:image/png;base64,{b64}'}
    })

# Also include reference images
ref_model_b64 = base64.b64encode(model_img.read_bytes()).decode()
ref_product_b64 = base64.b64encode(product_img.read_bytes()).decode()
content_parts.insert(1, {
    'type': 'text',
    'text': '\n【参考图1: 模特参考图 (model.jpg)】\n'
})
content_parts.insert(2, {
    'type': 'image_url',
    'image_url': {'url': f'data:image/jpeg;base64,{ref_model_b64}'}
})
content_parts.insert(3, {
    'type': 'text',
    'text': '\n【参考图2: 白底产品图 (BM26A050CM-正面.png)】\n'
})
content_parts.insert(4, {
    'type': 'image_url',
    'image_url': {'url': f'data:image/png;base64,{ref_product_b64}'}
})

kimi_body = {
    'model': 'kimi-k2.6',
    'messages': [
        {
            'role': 'system',
            'content': '你是电商视觉质量审核专家。直接给出评分和分析，不要客套话。'
        },
        {
            'role': 'user',
            'content': content_parts,
        }
    ],
    'max_tokens': 4096,
}

kimi_data = json.dumps(kimi_body).encode()
kimi_req = urllib.request.Request(KIMI_URL, data=kimi_data, headers={
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {KIMI_KEY}',
})

try:
    kimi_resp = urllib.request.urlopen(kimi_req, timeout=120)
    kimi_result = json.loads(kimi_resp.read())
    analysis = kimi_result['choices'][0]['message']['content']
    print(analysis)

    with open(OUTPUT_DIR / 'kimi_analysis.txt', 'w', encoding='utf-8') as f:
        f.write(analysis)
    print(f'\nAnalysis saved to: {OUTPUT_DIR / "kimi_analysis.txt"}')
except Exception as e:
    print(f'Kimi analysis failed: {e}')
    import traceback
    traceback.print_exc()
